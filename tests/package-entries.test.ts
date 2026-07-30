/**
 * Package entry tests
 *
 * What `exports` publishes has to be importable from an install, with the
 * dependencies an installed copy actually gets. The published entries were
 * unreachable three ways over — no "." condition, the modules they import left
 * out of `files`, and their runtime dependencies declared as devDependencies —
 * and none of it is visible from inside the repo, where every path resolves.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '..');

describe('published entries', () => {
  let consumerDir: string;

  beforeAll(() => {
    consumerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-test-'));

    execFileSync('npm', ['pack', '--pack-destination', consumerDir], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
    const tarball = fs.readdirSync(consumerDir).find(f => f.endsWith('.tgz'))!;

    fs.writeFileSync(
      path.join(consumerDir, 'package.json'),
      JSON.stringify({ name: 'entry-consumer', version: '1.0.0', type: 'module', private: true }),
    );
    execFileSync('npm', ['install', path.join(consumerDir, tarball)], {
      cwd: consumerDir,
      stdio: 'pipe',
    });
  }, 180_000);

  afterAll(() => {
    fs.rmSync(consumerDir, { recursive: true, force: true });
  });

  function importFrom(specifier: string): string {
    return execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import(${JSON.stringify(specifier)}).then(m => console.log(Object.keys(m).length))`,
      ],
      { cwd: consumerDir, encoding: 'utf-8', stdio: 'pipe' },
    ).trim();
  }

  it('exposes the library entry to an installed consumer', () => {
    expect(Number(importFrom('micro-contracts'))).toBeGreaterThan(0);
  });

  it('exposes the insight provider entry', () => {
    expect(Number(importFrom('micro-contracts/insight-provider'))).toBeGreaterThan(0);
  });

  it('publishes the names the library entry promises', async () => {
    const entry = await import(
      path.join(consumerDir, 'node_modules/micro-contracts/dist/index.js')
    );

    // Named individually: a consumer writing against the documented API breaks
    // when one disappears, and narrowing the surface is easy to overshoot.
    for (const name of [
      'generate',
      'loadConfig',
      'findConfigFile',
      'loadOpenAPISpec',
      'collectInputFiles',
      'computeInputHash',
      'lintSpec',
      'formatLintResults',
      'generateTypes',
      'generateSchemas',
      'generateServiceInterfaces',
      'buildTemplateContext',
      'renderTemplate',
      'processOverlays',
      'generateExtensionInterfaces',
      'isMultiModuleConfig',
      'resolveModuleConfig',
      'validateConfigKeys',
      'expandPlaceholders',
      'isReference',
      'getRefName',
      'extractDependencies',
    ]) {
      expect(typeof entry[name], name).toBe('function');
    }
  });
});
