#!/usr/bin/env node
/**
 * Type-checks the hand-written sources and tests, including unused imports,
 * locals and parameters.
 *
 * Tests are outside the build project (they are not shipped) and vitest only
 * transpiles them, so this is the only thing that type-checks them at all.
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
  console.error(`\n${diagnostics.length} problem(s) in src/ and tests/.`);
  process.exit(1);
}

console.log('src/ and tests/ type-check clean.');
