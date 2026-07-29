/**
 * Package version — single source of truth.
 *
 * Resolved by walking up from this module's own location to the nearest
 * package.json. Hard-coded relative paths cannot be used here: this module is
 * shipped both as `dist/*.js` (tsc), `dist/external/*.js` (tsc) and inlined
 * into `dist/micro-contracts.bundle.mjs` (esbuild), each at a different depth.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function readVersion(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));

  for (;;) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as { version?: string };
      if (!parsed.version) {
        throw new Error(`package.json without a version field: ${candidate}`);
      }
      return parsed.version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('package.json not found above ' + fileURLToPath(import.meta.url));
    }
    dir = parent;
  }
}

export const VERSION = readVersion();
