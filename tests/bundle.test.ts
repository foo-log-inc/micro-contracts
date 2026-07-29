/**
 * Bundle tests
 *
 * The published CLI is the single-file bundle, and it only ever runs from
 * node_modules/micro-contracts/dist/. These tests execute it from exactly that
 * layout: relative runtime lookups that happen to resolve inside this monorepo
 * (or a syntax error masked by minification) fail here instead of on install.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '..');
const BUNDLE = path.join(REPO_ROOT, 'dist/micro-contracts.bundle.mjs');
const PKG_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')
).version as string;

function buildBundle(minify: boolean): void {
  execFileSync(
    process.execPath,
    ['esbuild.bundle.mjs', ...(minify ? ['--minify'] : [])],
    { cwd: REPO_ROOT, stdio: 'pipe' }
  );
}

describe('published bundle', () => {
  let installDir: string;
  let packageDir: string;

  beforeAll(() => {
    // node_modules/micro-contracts/dist/<bundle>: the depth the bundle ships at.
    installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-test-'));
    packageDir = path.join(installDir, 'node_modules', 'micro-contracts');
    fs.mkdirSync(path.join(packageDir, 'dist'), { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, 'package.json'),
      path.join(packageDir, 'package.json')
    );
  });

  afterAll(() => {
    fs.rmSync(installDir, { recursive: true, force: true });
  });

  function runInstalledBundle(): string {
    const installedBundle = path.join(packageDir, 'dist', 'micro-contracts.bundle.mjs');
    fs.copyFileSync(BUNDLE, installedBundle);
    return execFileSync(process.execPath, [installedBundle, '--version'], {
      cwd: installDir,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
  }

  it('reports its version when run from an install layout (unminified)', () => {
    buildBundle(false);
    expect(runInstalledBundle()).toBe(PKG_VERSION);
  });

  it('reports its version when run from an install layout (minified)', () => {
    buildBundle(true);
    expect(runInstalledBundle()).toBe(PKG_VERSION);
  });
});
