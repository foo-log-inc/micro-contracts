import fs from "fs";
import path from "path";
import yaml from "yaml";
import { loadConfig, loadOpenAPISpec, lintSpec, formatLintResults } from "../generator/index.js";
import type { MultiModuleConfig, OpenAPISpec } from "../types.js";
import { isMultiModuleConfig } from "../types.js";
import { loadGuardrailsConfigWithPath } from "../guardrails/index.js";

interface ModuleEntry {
  name: string;
  spec: OpenAPISpec;
  specPath: string;
}

function findConfigFile(): string | null {
  const candidates = [
    "micro-contracts.config.yaml",
    "micro-contracts.config.yml",
    "api-framework.config.yaml",
    "api-framework.config.yml",
  ];
  for (const c of candidates) {
    const p = path.resolve(c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadModules(
  configPath: string | undefined,
  moduleName: string | undefined,
): { config: MultiModuleConfig; configPath: string; modules: ModuleEntry[] } {
  const resolved = configPath ? path.resolve(configPath) : findConfigFile();
  if (!resolved || !fs.existsSync(resolved)) {
    throw Object.assign(
      new Error(`Config file not found: ${resolved ?? "micro-contracts.config.yaml"}`),
      { exitCode: 3 },
    );
  }

  const config = loadConfig(resolved);
  if (!isMultiModuleConfig(config)) {
    throw Object.assign(
      new Error("Config must be a multi-module config with modules defined."),
      { exitCode: 3 },
    );
  }

  const modules: ModuleEntry[] = [];
  for (const [name, modConfig] of Object.entries(config.modules)) {
    if (moduleName && name !== moduleName) continue;
    const specPath = path.resolve(path.dirname(resolved), modConfig.openapi);
    if (!fs.existsSync(specPath)) continue;
    const spec = loadOpenAPISpec(specPath);
    modules.push({ name, spec, specPath });
  }

  return { config, configPath: resolved, modules };
}

function formatSpec(spec: OpenAPISpec, specPath: string): string {
  const raw = fs.readFileSync(specPath, "utf-8");
  const maxLen = 24000;
  if (raw.length > maxLen) {
    return raw.slice(0, maxLen) + "\n# (truncated)";
  }
  return raw;
}

function collectOverlays(config: MultiModuleConfig, configPath: string): string[] {
  const overlays: string[] = [];
  const baseDir = path.dirname(configPath);

  const sharedOverlays = config.defaults?.overlays?.shared ?? [];
  for (const o of sharedOverlays) {
    const p = path.resolve(baseDir, o);
    if (fs.existsSync(p)) {
      overlays.push(`### ${o}\n\n\`\`\`yaml\n${fs.readFileSync(p, "utf-8")}\n\`\`\``);
    }
  }

  for (const [, modConfig] of Object.entries(config.modules)) {
    const modOverlays = modConfig.overlays ?? [];
    for (const o of modOverlays) {
      const p = path.resolve(baseDir, o);
      if (fs.existsSync(p)) {
        overlays.push(`### ${o}\n\n\`\`\`yaml\n${fs.readFileSync(p, "utf-8")}\n\`\`\``);
      }
    }
  }

  return overlays;
}

function buildDepsSection(config: MultiModuleConfig, configPath: string): string | null {
  const lines: string[] = [];

  for (const [name, modConfig] of Object.entries(config.modules)) {
    const specPath = path.resolve(path.dirname(configPath), modConfig.openapi);
    if (!fs.existsSync(specPath)) continue;
    const spec = loadOpenAPISpec(specPath);
    const deps = spec.info["x-micro-contracts-depend-on"] ?? [];
    const configDeps = modConfig.dependsOn ?? [];
    const allDeps = [...new Set([...deps, ...configDeps])];
    if (allDeps.length > 0) {
      lines.push(`- ${name} → ${allDeps.join(", ")}`);
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

export async function buildAuditOpenapiContext(
  configPath: string | undefined,
  moduleName: string | undefined,
): Promise<string> {
  const { config, configPath: resolved, modules } = loadModules(configPath, moduleName);
  const sections: string[] = [];

  sections.push("# OpenAPI Design Audit Request");

  sections.push(
    `## Project Configuration\n\n` +
    `\`\`\`yaml\n${fs.readFileSync(resolved, "utf-8")}\n\`\`\``,
  );

  for (const mod of modules) {
    sections.push(
      `## Module: ${mod.name}\n\n` +
      `### OpenAPI Specification (${path.basename(mod.specPath)})\n\n` +
      `\`\`\`yaml\n${formatSpec(mod.spec, mod.specPath)}\n\`\`\``,
    );

    const lintResult = lintSpec(mod.spec, { strict: false });
    if (!lintResult.valid || lintResult.warnings.length > 0) {
      sections.push(`### Lint Results\n\n${formatLintResults(lintResult)}`);
    }
  }

  const overlays = collectOverlays(config, resolved);
  if (overlays.length > 0) {
    sections.push(`## Existing Overlays\n\n${overlays.join("\n\n")}`);
  }

  const deps = buildDepsSection(config, resolved);
  if (deps) {
    sections.push(`## Module Dependency Graph\n\n${deps}`);
  }

  return sections.join("\n\n");
}

export async function buildReviewPublishedContext(
  configPath: string | undefined,
  moduleName: string | undefined,
): Promise<string> {
  const { config, configPath: resolved, modules } = loadModules(configPath, moduleName);
  const sections: string[] = [];

  sections.push("# Published API Review Request");

  for (const mod of modules) {
    sections.push(
      `## Module: ${mod.name}\n\n` +
      `### Master Specification (${path.basename(mod.specPath)})\n\n` +
      `\`\`\`yaml\n${formatSpec(mod.spec, mod.specPath)}\n\`\`\``,
    );

    const publishedDir = config.defaults?.contractPublic?.output?.replace("{module}", mod.name)
      ?? `packages/contract-published/${mod.name}`;
    if (fs.existsSync(publishedDir)) {
      const files = fs.readdirSync(publishedDir, { recursive: true })
        .filter((f) => String(f).endsWith(".ts"))
        .slice(0, 10);
      if (files.length > 0) {
        const excerpts = files.map((f) => {
          const content = fs.readFileSync(path.join(publishedDir, String(f)), "utf-8");
          const truncated = content.length > 4000
            ? content.slice(0, 4000) + "\n// (truncated)"
            : content;
          return `#### ${f}\n\n\`\`\`typescript\n${truncated}\n\`\`\``;
        });
        sections.push(`### Published Contracts\n\n${excerpts.join("\n\n")}`);
      }
    }

    const nonExportable = extractNonExportable(mod.spec);
    if (nonExportable.length > 0) {
      sections.push(
        `### x-micro-contracts-non-exportable Schemas\n\n` +
        nonExportable.map((s) => `- ${s}`).join("\n"),
      );
    }
  }

  const deps = buildDepsSection(config, resolved);
  if (deps) {
    sections.push(`## Module Dependency Graph\n\n${deps}`);
  }

  return sections.join("\n\n");
}

function extractNonExportable(spec: OpenAPISpec): string[] {
  const result: string[] = [];
  const schemas = spec.components?.schemas ?? {};
  for (const [name, schema] of Object.entries(schemas)) {
    if (schema && typeof schema === "object" && (schema as Record<string, unknown>)["x-micro-contracts-non-exportable"]) {
      result.push(name);
    }
  }

  if (spec.paths) {
    for (const [, pathItem] of Object.entries(spec.paths)) {
      if (!pathItem || typeof pathItem !== "object") continue;
      for (const method of ["get", "post", "put", "patch", "delete"]) {
        const op = (pathItem as Record<string, unknown>)[method];
        if (op && typeof op === "object" && (op as Record<string, unknown>)["x-micro-contracts-non-exportable"]) {
          const opId = (op as Record<string, unknown>).operationId ?? `${method} ${Object.keys(spec.paths!).find((k) => spec.paths![k] === pathItem)}`;
          result.push(String(opId));
        }
      }
    }
  }

  return result;
}

export async function buildProposeOverlaysContext(
  configPath: string | undefined,
  moduleName: string | undefined,
): Promise<string> {
  const { config, configPath: resolved, modules } = loadModules(configPath, moduleName);
  const sections: string[] = [];

  sections.push("# Overlay Proposal Request");

  for (const mod of modules) {
    sections.push(
      `## Module: ${mod.name}\n\n` +
      `### OpenAPI Specification (${path.basename(mod.specPath)})\n\n` +
      `\`\`\`yaml\n${formatSpec(mod.spec, mod.specPath)}\n\`\`\``,
    );
  }

  const overlays = collectOverlays(config, resolved);
  if (overlays.length > 0) {
    sections.push(`## Existing Overlays\n\n${overlays.join("\n\n")}`);
  } else {
    sections.push("## Existing Overlays\n\nNo existing overlays found.");
  }

  sections.push(
    `## Project Configuration\n\n` +
    `\`\`\`yaml\n${fs.readFileSync(resolved, "utf-8")}\n\`\`\``,
  );

  return sections.join("\n\n");
}

export async function buildAuditGuardrailsContext(
  configPath: string | undefined,
  guardrailsPath: string | undefined,
): Promise<string> {
  const resolved = configPath ? path.resolve(configPath) : findConfigFile();
  if (!resolved || !fs.existsSync(resolved)) {
    throw Object.assign(
      new Error(`Config file not found: ${resolved ?? "micro-contracts.config.yaml"}`),
      { exitCode: 3 },
    );
  }

  const config = loadConfig(resolved);
  const sections: string[] = [];

  sections.push("# Guardrails Coverage Audit Request");

  const loaded = loadGuardrailsConfigWithPath(guardrailsPath);
  if (!loaded.config) {
    throw Object.assign(
      new Error(`guardrails.yaml not found${guardrailsPath ? `: ${guardrailsPath}` : ""}`),
      { exitCode: 3 },
    );
  }

  if (loaded.configPath) {
    sections.push(
      `## Guardrails Configuration (${loaded.configPath})\n\n` +
      `\`\`\`yaml\n${fs.readFileSync(loaded.configPath, "utf-8")}\n\`\`\``,
    );
  }

  sections.push(
    `## Project Configuration\n\n` +
    `\`\`\`yaml\n${fs.readFileSync(resolved, "utf-8")}\n\`\`\``,
  );

  if (isMultiModuleConfig(config)) {
    const outputDirs: string[] = [];
    for (const [name, modConfig] of Object.entries(config.modules)) {
      const contractDir = config.defaults?.contract?.output?.replace("{module}", name)
        ?? `packages/contract/${name}`;
      outputDirs.push(contractDir);

      if (config.defaults?.contractPublic) {
        const pubDir = config.defaults.contractPublic.output?.replace("{module}", name)
          ?? `packages/contract-published/${name}`;
        outputDirs.push(pubDir);
      }

      if (modConfig.outputs) {
        for (const [, outConfig] of Object.entries(modConfig.outputs)) {
          if (outConfig.output) {
            outputDirs.push(outConfig.output.replace("{module}", name));
          }
        }
      }
    }

    sections.push(
      `## Configured Output Directories\n\n` +
      outputDirs.map((d) => `- ${d}`).join("\n"),
    );

    for (const [name, modConfig] of Object.entries(config.modules)) {
      const specPath = path.resolve(path.dirname(resolved), modConfig.openapi);
      if (fs.existsSync(specPath)) {
        sections.push(`## Module Spec: ${name}\n\nPath: ${modConfig.openapi}`);
      }
    }
  }

  return sections.join("\n\n");
}
