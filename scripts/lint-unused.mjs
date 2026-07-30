#!/usr/bin/env node
/**
 * Reports unused imports, locals and parameters in the hand-written sources.
 *
 * `noUnusedLocals` is project-wide and cannot skip a directory, while files
 * under src/generated/ are produced by cli-contracts and can only be fixed
 * upstream — so their diagnostics are dropped here and everything else fails
 * the run. CI invokes this as `npm run lint`.
 */

import { spawnSync } from 'node:child_process';

const GENERATED_PREFIX = 'src/generated/';

const tsc = spawnSync(
  process.execPath,
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.lint.json', '--pretty', 'false'],
  { encoding: 'utf-8' },
);

const diagnostics = (tsc.stdout ?? '')
  .split('\n')
  .filter((line) => line.trim())
  .filter((line) => !line.startsWith(GENERATED_PREFIX));

if (tsc.stderr?.trim()) {
  console.error(tsc.stderr.trim());
}

if (diagnostics.length > 0) {
  console.error(diagnostics.join('\n'));
  console.error(`\n${diagnostics.length} unused declaration(s). Delete them.`);
  process.exit(1);
}

console.log('No unused declarations.');
