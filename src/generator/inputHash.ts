/**
 * Input hash computation for generation skip logic.
 *
 * Computes a deterministic SHA-256 hash over all files that affect
 * generation output (config, OpenAPI specs, templates, overlays)
 * plus the package version.  When the hash matches the value stored
 * in the manifest, generation can safely be skipped.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import YAML from 'yaml';
import type { MultiModuleConfig } from '../types.js';
import { resolveModuleConfig } from '../types.js';

/**
 * Recursively walk a parsed YAML/JSON structure and collect absolute
 * paths of files referenced by external `$ref` values (e.g.
 * `../../_shared/openapi/problem-details.yaml#/components/...`).
 * Follows transitive references so that indirectly referenced files
 * are also included.
 */
function collectExternalRefs(
  value: unknown,
  baseDir: string,
  visited: Set<string>,
): void {
  if (value === null || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) collectExternalRefs(item, baseDir, visited);
    return;
  }

  const obj = value as Record<string, unknown>;
  if (typeof obj['$ref'] === 'string') {
    const ref = obj['$ref'];
    const filePart = ref.split('#')[0];
    if (filePart) {
      const absPath = path.resolve(baseDir, filePart);
      if (!visited.has(absPath) && fs.existsSync(absPath)) {
        visited.add(absPath);
        try {
          const raw = fs.readFileSync(absPath, 'utf8');
          const parsed = YAML.parse(raw);
          collectExternalRefs(parsed, path.dirname(absPath), visited);
        } catch {
          // unparseable — file is still tracked by its content hash
        }
      }
    }
  }

  for (const v of Object.values(obj)) {
    collectExternalRefs(v, baseDir, visited);
  }
}

/**
 * Parse a YAML/JSON file and collect all externally-referenced file
 * paths (via `$ref`) transitively.
 */
function collectRefsFromFile(filePath: string): string[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = YAML.parse(raw);
    const refFiles = new Set<string>();
    collectExternalRefs(parsed, path.dirname(filePath), refFiles);
    return [...refFiles];
  } catch {
    return [];
  }
}

/**
 * Collect every input file path that can affect generation output.
 *
 * Returns absolute paths, sorted and deduplicated.
 */
export function collectInputFiles(
  config: MultiModuleConfig,
  configPath: string,
): string[] {
  const files = new Set<string>();

  files.add(path.resolve(configPath));

  for (const [moduleName, moduleConfig] of Object.entries(config.modules)) {
    const resolved = resolveModuleConfig(moduleName, moduleConfig, config.defaults);

    // OpenAPI spec + transitive $ref targets
    const openapiPath = path.resolve(resolved.openapi);
    if (fs.existsSync(openapiPath)) {
      files.add(openapiPath);
      for (const ref of collectRefsFromFile(openapiPath)) files.add(ref);
    }

    // Overlays + their transitive $ref targets
    for (const overlay of resolved.overlays) {
      const overlayPath = path.resolve(overlay);
      if (fs.existsSync(overlayPath)) {
        files.add(overlayPath);
        for (const ref of collectRefsFromFile(overlayPath)) files.add(ref);
      }
    }

    // Templates from outputs (new system)
    for (const output of resolved.outputs) {
      if (!output.enabled) continue;

      const absTemplate = path.resolve(output.template);
      if (fs.existsSync(absTemplate)) {
        files.add(absTemplate);
      }
    }

    // Legacy server/frontend templates
    if (resolved.server?.template) {
      const t = path.resolve(resolved.server.template);
      if (fs.existsSync(t)) files.add(t);
    }
    if (resolved.frontend?.template) {
      const t = path.resolve(resolved.frontend.template);
      if (fs.existsSync(t)) files.add(t);
    }
  }

  return [...files].sort();
}

/**
 * Compute a deterministic SHA-256 hash from input files + package version.
 *
 * The hash is stable across machines because file paths are expressed
 * relative to the config file's directory.
 */
export function computeInputHash(
  config: MultiModuleConfig,
  configPath: string,
  packageVersion: string,
): string {
  const inputFiles = collectInputFiles(config, configPath);
  const configDir = path.dirname(path.resolve(configPath));
  const hash = crypto.createHash('sha256');

  for (const filePath of inputFiles) {
    const relativePath = path.relative(configDir, filePath);
    hash.update(relativePath + '\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }

  hash.update('version:' + packageVersion);

  return hash.digest('hex');
}
