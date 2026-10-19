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
import type { MultiModuleConfig } from '../types.js';
import { resolveModuleConfig } from '../types.js';
import { referencedFiles } from './specLoader.js';

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
      for (const ref of referencedFiles(openapiPath)) files.add(ref);
    }

    // Overlays + their transitive $ref targets
    for (const overlay of resolved.overlays) {
      const overlayPath = path.resolve(overlay);
      if (fs.existsSync(overlayPath)) {
        files.add(overlayPath);
        for (const ref of referencedFiles(overlayPath)) files.add(ref);
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

    // Every template generation reads: leaving one out means editing it does not
    // invalidate the hash, and the run skips with the old output in place.
    for (const template of [
      resolved.serviceTemplate,
      resolved.server?.template,
      resolved.frontend?.template,
    ]) {
      if (!template) continue;
      const absTemplate = path.resolve(template);
      if (fs.existsSync(absTemplate)) files.add(absTemplate);
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
