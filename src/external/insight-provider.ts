/**
 * External Insight Provider for agent-contracts-analyzer (Issue #24).
 * Exposes x-micro-contracts-depend-on as ExternalInsight edges and anchor mappings.
 */

import fs from "fs";
import path from "path";
import type {
  AnchorMapping,
  ExternalEdge,
  ExternalEvidence,
  ExternalInsight,
  InsightProvider,
  InsightQuery,
  SymbolAnchor,
} from "agent-contracts-analyzer";
import { loadConfig, loadOpenAPISpec } from "../generator/index.js";
import { extractDependencies } from "../types.js";
import type {
  DependencyRef,
  OpenAPISpec,
  ResolvedModuleConfig,
} from "../types.js";
import { isMultiModuleConfig, resolveModuleConfig } from "../types.js";
import { VERSION } from "../version.js";

export const MICRO_CONTRACTS_INSIGHT_SOURCE = "micro-contracts";

const EVIDENCE_KIND = "api_contract_declaration";
const EDGE_WEIGHT = 0.9;

export interface BuildInsightOptions {
  configPath?: string;
}

interface ModuleContext {
  name: string;
  openapiRel: string;
  resolved: ResolvedModuleConfig;
  spec: OpenAPISpec;
}

function findConfigFile(projectRoot: string): string | null {
  const candidates = [
    "micro-contracts.config.yaml",
    "micro-contracts.config.yml",
    "api-framework.config.yaml",
    "api-framework.config.yml",
  ];
  for (const candidate of candidates) {
    const configPath = path.join(projectRoot, candidate);
    if (fs.existsSync(configPath)) return configPath;
  }
  return null;
}

function toProjectRelative(projectRoot: string, absolutePath: string): string {
  const rel = path.relative(projectRoot, absolutePath);
  return rel.startsWith("..") ? absolutePath : rel.split(path.sep).join("/");
}

function dependencyDomainId(dep: DependencyRef): string {
  return dep.raw;
}

function serviceApiSymbolId(
  contractOutputRel: string,
  service: string,
  method: string,
): string {
  return `${contractOutputRel}/services/${service}ServiceApi.ts#${method}`;
}

function findDeclarationLine(fileContent: string, needle: string): number | undefined {
  const lines = fileContent.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(needle)) {
      return i + 1;
    }
  }
  return undefined;
}

function buildEvidence(
  detail: string,
  openapiRel: string,
  openapiContent: string,
  needle?: string,
  symbolId?: string,
): ExternalEvidence {
  const line = needle ? findDeclarationLine(openapiContent, needle) : undefined;
  return {
    kind: EVIDENCE_KIND,
    detail,
    filePath: openapiRel,
    ...(line !== undefined ? { line } : {}),
    ...(symbolId !== undefined ? { symbolId } : {}),
  };
}

function collectOperationIndex(
  spec: OpenAPISpec,
): Map<string, { service: string; method: string }> {
  const index = new Map<string, { service: string; method: string }>();
  const httpMethods = ["get", "post", "put", "patch", "delete"] as const;

  for (const pathItem of Object.values(spec.paths)) {
    for (const httpMethod of httpMethods) {
      const operation = pathItem[httpMethod];
      if (!operation?.operationId) continue;

      const service = operation["x-micro-contracts-service"];
      const method = operation["x-micro-contracts-method"];
      if (typeof service === "string" && typeof method === "string") {
        index.set(operation.operationId, { service, method });
      }
    }
  }

  return index;
}

function operationDomainId(
  moduleName: string,
  service: string,
  method: string,
): string {
  return `${moduleName}.${service}.${method}`;
}

function edgeKey(from: string, to: string, kind: string): string {
  return `${from}\0${to}\0${kind}`;
}

function buildApiRefSymbolAnchor(
  contractOutputRel: string,
  dep: DependencyRef,
): SymbolAnchor {
  const symbolId = serviceApiSymbolId(contractOutputRel, dep.service, dep.method);
  return {
    symbolId,
    filePath: `${contractOutputRel}/services/${dep.service}ServiceApi.ts`,
    startLine: 1,
    endLine: 1,
  };
}

export function buildExternalInsight(
  projectRoot: string,
  options: BuildInsightOptions = {},
): ExternalInsight {
  const resolvedRoot = path.resolve(projectRoot);
  const configPath = options.configPath
    ? path.resolve(options.configPath)
    : findConfigFile(resolvedRoot);

  if (!configPath) {
    throw new Error(
      "micro-contracts.config.yaml not found. Run from project root or pass --config.",
    );
  }

  const config = loadConfig(configPath);
  if (!isMultiModuleConfig(config)) {
    throw new Error("Insight provider requires multi-module config with modules.");
  }

  const configDir = path.dirname(configPath);
  const defaults = config.defaults ?? {};
  const moduleContexts: ModuleContext[] = [];
  const contractOutputByModule = new Map<string, string>();

  for (const [moduleName, moduleConfig] of Object.entries(config.modules)) {
    const resolved = resolveModuleConfig(moduleName, moduleConfig, defaults);
    const openapiAbs = path.resolve(configDir, resolved.openapi);
    if (!fs.existsSync(openapiAbs)) {
      continue;
    }

    const spec = loadOpenAPISpec(openapiAbs);
    const openapiRel = toProjectRelative(resolvedRoot, openapiAbs);
    const contractRel = toProjectRelative(
      resolvedRoot,
      path.resolve(resolvedRoot, resolved.contractOutput),
    );

    contractOutputByModule.set(moduleName, contractRel);
    moduleContexts.push({
      name: moduleName,
      openapiRel,
      resolved,
      spec,
    });
  }

  const edges: ExternalEdge[] = [];
  const edgeSeen = new Set<string>();
  const anchorByDomain = new Map<string, AnchorMapping>();

  const ensureModuleAnchor = (ctx: ModuleContext): void => {
    if (anchorByDomain.has(ctx.name)) return;
    anchorByDomain.set(ctx.name, {
      domainId: ctx.name,
      filePaths: [ctx.openapiRel, ctx.resolved.contractOutput],
    });
  };

  const ensureApiRefAnchor = (dep: DependencyRef): void => {
    const domainId = dependencyDomainId(dep);
    if (anchorByDomain.has(domainId)) return;

    const contractRel = contractOutputByModule.get(dep.module);
    if (!contractRel) return;

    const targetOpenapi = moduleContexts.find((m) => m.name === dep.module);
    const filePaths = targetOpenapi
      ? [targetOpenapi.openapiRel, contractRel]
      : [contractRel];

    anchorByDomain.set(domainId, {
      domainId,
      filePaths,
      symbolIds: [serviceApiSymbolId(contractRel, dep.service, dep.method)],
      symbols: [buildApiRefSymbolAnchor(contractRel, dep)],
    });
  };

  const ensureOperationAnchor = (
    moduleName: string,
    service: string,
    method: string,
    contractRel: string,
    openapiRel: string,
  ): void => {
    const domainId = operationDomainId(moduleName, service, method);
    if (anchorByDomain.has(domainId)) return;

    const symbolId = serviceApiSymbolId(contractRel, service, method);
    anchorByDomain.set(domainId, {
      domainId,
      filePaths: [openapiRel, contractRel],
      symbolIds: [symbolId],
      symbols: [
        {
          symbolId,
          filePath: `${contractRel}/services/${service}ServiceApi.ts`,
          startLine: 1,
          endLine: 1,
        },
      ],
    });
  };

  for (const ctx of moduleContexts) {
    ensureModuleAnchor(ctx);
    const openapiContent = fs.readFileSync(
      path.resolve(resolvedRoot, ctx.openapiRel),
      "utf-8",
    );
    const deps = extractDependencies(ctx.spec);
    const contractRel = contractOutputByModule.get(ctx.name)!;
    const opIndex = collectOperationIndex(ctx.spec);

    for (const dep of deps.moduleLevelDeps) {
      const from = ctx.name;
      const to = dependencyDomainId(dep);
      const kind = "api_dependency";
      const key = edgeKey(from, to, kind);
      if (edgeSeen.has(key)) continue;
      edgeSeen.add(key);

      ensureApiRefAnchor(dep);
      edges.push({
        from,
        to,
        kind,
        propagation: "forward",
        weight: EDGE_WEIGHT,
        evidence: [
          buildEvidence(
            `module declares dependency on ${dep.raw}`,
            ctx.openapiRel,
            openapiContent,
            dep.raw,
          ),
        ],
      });
    }

    for (const [operationId, opDeps] of deps.operationLevelDeps) {
      const opMeta = opIndex.get(operationId);
      if (!opMeta) continue;

      const from = operationDomainId(
        ctx.name,
        opMeta.service,
        opMeta.method,
      );
      ensureOperationAnchor(
        ctx.name,
        opMeta.service,
        opMeta.method,
        contractRel,
        ctx.openapiRel,
      );

      for (const dep of opDeps) {
        const to = dependencyDomainId(dep);
        const kind = "api_operation_dependency";
        const key = edgeKey(from, to, kind);
        if (edgeSeen.has(key)) continue;
        edgeSeen.add(key);

        ensureApiRefAnchor(dep);
        const fromSymbolId = serviceApiSymbolId(
          contractRel,
          opMeta.service,
          opMeta.method,
        );
        edges.push({
          from,
          to,
          kind,
          propagation: "forward",
          weight: EDGE_WEIGHT,
          evidence: [
            buildEvidence(
              `operation ${from} declares dependency on ${dep.raw}`,
              ctx.openapiRel,
              openapiContent,
              dep.raw,
              fromSymbolId,
            ),
          ],
        });
      }
    }
  }

  return {
    source: MICRO_CONTRACTS_INSIGHT_SOURCE,
    sourceVersion: VERSION,
    generatedAt: new Date().toISOString(),
    edges,
    anchorMapping: [...anchorByDomain.values()],
  };
}

export function filterInsight(
  insight: ExternalInsight,
  query: InsightQuery,
): ExternalInsight {
  const { changedFiles, artifactIds } = query;
  if (!changedFiles?.length && !artifactIds?.length) return insight;

  const relevantIds = new Set<string>();

  if (changedFiles?.length) {
    const changedSet = new Set(changedFiles);
    for (const anchor of insight.anchorMapping ?? []) {
      if (anchor.filePaths.some((fp) => changedSet.has(fp))) {
        relevantIds.add(anchor.domainId);
      }
    }
  }

  if (artifactIds?.length) {
    for (const id of artifactIds) {
      relevantIds.add(id);
    }
  }

  const filteredEdges = insight.edges.filter(
    (e) => relevantIds.has(e.from) || relevantIds.has(e.to),
  );

  const referencedIds = new Set<string>();
  for (const edge of filteredEdges) {
    referencedIds.add(edge.from);
    referencedIds.add(edge.to);
  }
  const filteredAnchors = (insight.anchorMapping ?? []).filter((a) =>
    referencedIds.has(a.domainId),
  );

  return {
    ...insight,
    edges: filteredEdges,
    anchorMapping:
      filteredAnchors.length > 0 ? filteredAnchors : undefined,
  };
}

export class MicroContractsInsightProvider implements InsightProvider {
  readonly name = MICRO_CONTRACTS_INSIGHT_SOURCE;

  async provide(query: InsightQuery): Promise<ExternalInsight> {
    const insight = buildExternalInsight(query.projectRoot);
    return filterInsight(insight, query);
  }
}

export const microContractsInsightProvider = new MicroContractsInsightProvider();
