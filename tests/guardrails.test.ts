/**
 * Tests for guardrails module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  matchGlob,
  matchWithNegation,
  verifyAllowlist,
  loadGuardrailsConfig,
  DEFAULT_GUARDRAILS,
  hashFile,
  generateManifest,
  writeManifest,
  loadManifest,
  verifyManifest,
  runAllChecks,
  getAvailableChecks,
  checkUncommittedChanges,
  formatCheckResults,
  formatSingleCheckResult,
  findOpenAPISpecs,
  getChangedFiles,
  runAllowlistCheck,
  generateGuardrailsTemplate,
} from '../src/guardrails/index.js';
import { execFileSync } from 'child_process';

describe('matchGlob', () => {
  it('should match simple patterns', () => {
    expect(matchGlob('file.ts', '*.ts')).toBe(true);
    expect(matchGlob('file.ts', '*.js')).toBe(false);
    expect(matchGlob('dir/file.ts', '*.ts')).toBe(false); // * does not match /
  });
  
  it('should match ** (globstar) patterns', () => {
    expect(matchGlob('dir/file.ts', '**/*.ts')).toBe(true);
    expect(matchGlob('a/b/c/file.ts', '**/*.ts')).toBe(true);
    expect(matchGlob('file.ts', '**/*.ts')).toBe(true);
  });
  
  it('should match directory patterns', () => {
    expect(matchGlob('packages/contract/core/index.ts', 'packages/**')).toBe(true);
    expect(matchGlob('packages/index.ts', 'packages/**')).toBe(true);
    expect(matchGlob('src/packages/index.ts', 'packages/**')).toBe(false);
  });
  
  it('should match path segments', () => {
    expect(matchGlob('server/src/core/services/User.ts', 'server/src/**/services/**/*.ts')).toBe(true);
    expect(matchGlob('server/src/billing/services/index.ts', 'server/src/**/services/**/*.ts')).toBe(true);
    expect(matchGlob('server/src/core/routes.ts', 'server/src/**/services/**/*.ts')).toBe(false);
  });
  
  it('should match generated file patterns', () => {
    expect(matchGlob('server/src/routes.generated.ts', '**/*.generated.ts')).toBe(true);
    expect(matchGlob('routes.generated.ts', '**/*.generated.ts')).toBe(true);
    expect(matchGlob('server/routes.ts', '**/*.generated.ts')).toBe(false);
  });
});

describe('matchWithNegation', () => {
  it('should return false for empty patterns', () => {
    expect(matchWithNegation([], 'file.ts')).toBe(false);
    expect(matchWithNegation(undefined, 'file.ts')).toBe(false);
  });
  
  it('should match positive patterns', () => {
    expect(matchWithNegation(['*.ts'], 'file.ts')).toBe(true);
    expect(matchWithNegation(['*.ts'], 'file.js')).toBe(false);
  });
  
  it('should handle negation patterns', () => {
    const patterns = [
      'server/src/**/overlays/**/*.ts',
      '!server/src/_shared/overlays/**',
    ];
    
    // Should match module-specific overlays
    expect(matchWithNegation(patterns, 'server/src/core/overlays/auth.ts')).toBe(true);
    
    // Should NOT match shared overlays (negated)
    expect(matchWithNegation(patterns, 'server/src/_shared/overlays/index.ts')).toBe(false);
  });
  
  it('should use last match wins', () => {
    const patterns = [
      '**/*.ts',      // Include all .ts
      '!**/test/**',  // Exclude test files
      '**/test/important.ts',  // But include this specific test
    ];
    
    expect(matchWithNegation(patterns, 'src/index.ts')).toBe(true);
    expect(matchWithNegation(patterns, 'src/test/helper.ts')).toBe(false);
    expect(matchWithNegation(patterns, 'src/test/important.ts')).toBe(true);
  });
});

describe('verifyAllowlist', () => {
  const config = {
    allowed: [
      'spec/**/*.yaml',
      'server/src/**/services/**/*.ts',
      'docs/**/*.md',
    ],
    protected: [
      'spec/spectral.yaml',
      'guardrails.yaml',
      '.github/**',
    ],
    generated: [
      'packages/**',
      '**/*.generated.ts',
    ],
  };
  
  it('should allow files in allowed list', () => {
    const result = verifyAllowlist(['spec/core/openapi/core.yaml'], config);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
  
  it('should reject protected files', () => {
    const result = verifyAllowlist(['guardrails.yaml'], config);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].reason).toBe('protected');
  });
  
  it('should allow generated files (pass to drift check)', () => {
    const result = verifyAllowlist(['packages/contract/core/index.ts'], config);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
  
  it('should reject files not in any list', () => {
    const result = verifyAllowlist(['random/file.ts'], config);
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].reason).toBe('not-in-allowlist');
  });
  
  it('lets an approval through a protected path, and names what it let through', () => {
    // `protected` means "requires special approval". Without a way to record one, a pull
    // request touching such a path failed a gate it had no way to satisfy.
    const result = verifyAllowlist(['guardrails.yaml'], config, 'the label on pull request #1');

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.waived).toEqual(['guardrails.yaml']);
  });

  it('does not let an approval through a path no pattern describes', () => {
    // An approval says "yes, touch that protected path", not "yes, touch anything".
    const result = verifyAllowlist(['random/file.ts'], config, 'the label on pull request #1');

    expect(result.valid).toBe(false);
    expect(result.violations).toEqual([{ file: 'random/file.ts', reason: 'not-in-allowlist' }]);
    expect(result.waived).toEqual([]);
  });

  it('waives nothing when no protected path was touched', () => {
    const result = verifyAllowlist(
      ['spec/core/openapi/core.yaml'],
      config,
      'the label on pull request #1',
    );

    expect(result.waived).toEqual([]);
  });

  it('should handle multiple files', () => {
    const result = verifyAllowlist([
      'spec/core/openapi/core.yaml',  // allowed
      'guardrails.yaml',               // protected
      'packages/contract/index.ts',    // generated (ok)
      'unknown/file.ts',               // not allowed
    ], config);
    
    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations.map(v => v.reason)).toContain('protected');
    expect(result.violations.map(v => v.reason)).toContain('not-in-allowlist');
  });
});

describe('the shipped default allowlist', () => {
  it('protects the guardrails config under every name the loader accepts', () => {
    // The default protected only the legacy `guardrails.yaml` while `guardrails-init` wrote
    // `micro-contracts.guardrails.yaml`: the file that says what may change was itself
    // changeable by any pull request.
    for (const file of [
      'micro-contracts.guardrails.yaml',
      'micro-contracts.guardrails.yml',
      'guardrails.yaml',
      'guardrails.yml',
    ]) {
      const result = verifyAllowlist([file], DEFAULT_GUARDRAILS);
      expect(result.valid).toBe(false);
      expect(result.violations[0].reason).toBe('protected');
    }
  });

  it('allows a lockfile wherever it allows the manifest beside it', () => {
    // A dependency change moves both; allowing only one describes a change nobody can make.
    for (const file of [
      'package.json',
      'package-lock.json',
      'server/package.json',
      'server/package-lock.json',
    ]) {
      expect(verifyAllowlist([file], DEFAULT_GUARDRAILS).valid).toBe(true);
    }
  });
});

describe('loadGuardrailsConfig', () => {
  it('should return default config when no file exists', () => {
    const config = loadGuardrailsConfig('/nonexistent/guardrails.yaml');
    expect(config.allowed).toEqual(DEFAULT_GUARDRAILS.allowed);
    expect(config.protected).toEqual(DEFAULT_GUARDRAILS.protected);
    expect(config.generated).toEqual(DEFAULT_GUARDRAILS.generated);
  });
});

describe('manifest', () => {
  let tempDir: string;
  
  beforeEach(() => {
    // Create temp directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrails-test-'));
  });
  
  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  
  it('should hash files correctly', () => {
    const filePath = path.join(tempDir, 'test.txt');
    fs.writeFileSync(filePath, 'hello world');
    
    const hash = hashFile(filePath);
    expect(hash).toHaveLength(64); // SHA-256 = 64 hex chars
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });
  
  it('should generate and verify manifest', async () => {
    // Create some test files
    fs.writeFileSync(path.join(tempDir, 'file1.ts'), 'const a = 1;');
    fs.writeFileSync(path.join(tempDir, 'file2.ts'), 'const b = 2;');
    fs.mkdirSync(path.join(tempDir, 'sub'));
    fs.writeFileSync(path.join(tempDir, 'sub', 'file3.ts'), 'const c = 3;');
    
    // Generate manifest
    const { manifest, changed } = await generateManifest(tempDir, {
      generatorVersion: '1.0.0',
    });
    
    expect(changed).toBe(true); // First generation should be marked as changed
    expect(manifest.version).toBe('1.0');
    expect(manifest.generatorVersion).toBe('1.0.0');
    expect(Object.keys(manifest.files)).toHaveLength(3);
    expect(manifest.files['file1.ts']).toBeDefined();
    expect(manifest.files['file2.ts']).toBeDefined();
    expect(manifest.files['sub/file3.ts']).toBeDefined();
    
    // Write manifest
    const manifestPath = writeManifest(manifest, tempDir);
    expect(fs.existsSync(manifestPath)).toBe(true);
    
    // Load manifest
    const loaded = loadManifest(tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.files['file1.ts'].sha256).toBe(manifest.files['file1.ts'].sha256);
    
    // Verify manifest (should pass)
    const result = await verifyManifest(tempDir);
    expect(result.valid).toBe(true);
    expect(result.mismatches).toHaveLength(0);
    
    // Generate again without changes - should not be marked as changed
    const { changed: changedAgain } = await generateManifest(tempDir, {
      generatorVersion: '1.0.0',
    });
    expect(changedAgain).toBe(false);
  });
  
  it('should detect modified files', async () => {
    // Create files and manifest
    const filePath = path.join(tempDir, 'file.ts');
    fs.writeFileSync(filePath, 'original content');
    
    const { manifest } = await generateManifest(tempDir, {
      generatorVersion: '1.0.0',
    });
    writeManifest(manifest, tempDir);
    
    // Modify file
    fs.writeFileSync(filePath, 'modified content');
    
    // Verify (should fail)
    const result = await verifyManifest(tempDir);
    expect(result.valid).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].reason).toBe('hash-mismatch');
  });
  
  it('should detect missing files', async () => {
    // Create files and manifest
    const filePath = path.join(tempDir, 'file.ts');
    fs.writeFileSync(filePath, 'content');
    
    const { manifest } = await generateManifest(tempDir, {
      generatorVersion: '1.0.0',
    });
    writeManifest(manifest, tempDir);
    
    // Delete file
    fs.unlinkSync(filePath);
    
    // Verify (should fail)
    const result = await verifyManifest(tempDir);
    expect(result.valid).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].reason).toBe('missing');
  });
  
  it('should detect extra files', async () => {
    // Create files and manifest
    fs.writeFileSync(path.join(tempDir, 'file.ts'), 'content');
    
    const { manifest } = await generateManifest(tempDir, {
      generatorVersion: '1.0.0',
    });
    writeManifest(manifest, tempDir);
    
    // Add extra file
    fs.writeFileSync(path.join(tempDir, 'extra.ts'), 'extra content');
    
    // Verify (should fail)
    const result = await verifyManifest(tempDir);
    expect(result.valid).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].reason).toBe('extra');
    expect(result.mismatches[0].file).toBe('extra.ts');
  });
});

describe('checkUncommittedChanges', () => {
  let repo: string;

  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: 'pipe' });

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-test-'));
    fs.mkdirSync(path.join(repo, 'packages'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'packages/types.ts'), 'export interface A { id: string }\n');
    git('init', '-q', '.');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('add', '-A');
    git('commit', '-qm', 'init');
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  /** The check runs git in the process cwd. */
  function inRepo<T>(run: () => T): T {
    const previous = process.cwd();
    process.chdir(repo);
    try {
      return run();
    } finally {
      process.chdir(previous);
    }
  }

  it('reports a clean generated directory as valid', () => {
    const result = inRepo(() => checkUncommittedChanges('packages/'));

    expect(result.valid).toBe(true);
    expect(result.changedFiles).toEqual([]);
  });

  it('detects an unstaged edit to a generated file', () => {
    fs.appendFileSync(path.join(repo, 'packages/types.ts'), '// hand edit\n');

    const result = inRepo(() => checkUncommittedChanges('packages/'));

    expect(result.valid).toBe(false);
    expect(result.changedFiles).toContain('packages/types.ts');
  });

  it('detects a staged edit to a generated file', () => {
    // A pre-commit run stages first: comparing the worktree to the index would
    // report nothing here.
    fs.appendFileSync(path.join(repo, 'packages/types.ts'), '// hand edit\n');
    git('add', '-A');

    const result = inRepo(() => checkUncommittedChanges('packages/'));

    expect(result.valid).toBe(false);
    expect(result.changedFiles).toContain('packages/types.ts');
  });

  it('detects an untracked generated file', () => {
    fs.writeFileSync(path.join(repo, 'packages/new.generated.ts'), 'export const x = 1;\n');

    const result = inRepo(() => checkUncommittedChanges('packages/'));

    expect(result.valid).toBe(false);
    expect(result.changedFiles).toContain('packages/new.generated.ts');
  });

  it('reports each changed file once', () => {
    fs.appendFileSync(path.join(repo, 'packages/types.ts'), '// hand edit\n');
    git('add', '-A');
    fs.appendFileSync(path.join(repo, 'packages/types.ts'), '// more\n');

    const result = inRepo(() => checkUncommittedChanges('packages/'));

    expect(result.changedFiles.filter(f => f === 'packages/types.ts')).toHaveLength(1);
  });
});

describe('manifest with nothing recorded', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-manifest-'));
    fs.mkdirSync(path.join(tmpDir, 'packages'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails rather than verifying integrity over zero files', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'packages/.generated-manifest.json'),
      JSON.stringify({ generatorVersion: '0.0.0', files: {} }),
    );

    const summary = await runAllChecks({
      only: ['manifest'],
      generatedDir: path.join(tmpDir, 'packages'),
    });

    const manifest = summary.results.find(r => r.name === 'manifest');
    expect(manifest?.status).toBe('fail');
    expect(manifest?.message).toMatch(/records no files/);
  });
});

describe('gate 3 against a missing generated directory', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate3-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails drift instead of reading an absent path as unchanged', async () => {
    const results = await runAllChecks({
      only: ['drift'],
      generatedDir: path.join(tmpDir, 'nosuchdir'),
    });

    const drift = results.results.find(r => r.name === 'drift');
    expect(drift?.status).toBe('fail');
    expect(drift?.message).toMatch(/Generated directory not found/);
  });

  it('fails manifest instead of skipping', async () => {
    const results = await runAllChecks({
      only: ['manifest'],
      generatedDir: path.join(tmpDir, 'nosuchdir'),
    });

    const manifest = results.results.find(r => r.name === 'manifest');
    expect(manifest?.status).toBe('fail');
    expect(manifest?.message).toMatch(/Generated directory not found/);
  });

  it('does not report success when every check skipped', () => {
    const output = formatCheckResults({
      passed: 0,
      failed: 0,
      skipped: 2,
      results: [
        { name: 'a', status: 'skip', duration: 0 },
        { name: 'b', status: 'skip', duration: 0 },
      ],
    });

    expect(output).toContain('No checks ran');
    expect(output).not.toContain('All checks passed');
  });
});

describe('findOpenAPISpecs', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-discovery-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  /** Awaits inside the chdir: restoring cwd first would move the glob's base. */
  async function inProject<T>(run: () => T | Promise<T>): Promise<T> {
    const previous = process.cwd();
    process.chdir(projectDir);
    try {
      return await run();
    } finally {
      process.chdir(previous);
    }
  }

  function writeConfig(openapi: string): void {
    fs.writeFileSync(
      path.join(projectDir, 'micro-contracts.config.yaml'),
      ['modules:', '  bff:', `    openapi: ${openapi}`, ''].join('\n'),
    );
  }

  it('resolves the specs the config declares, whatever the layout or format', async () => {
    // A JSON spec outside spec/**: globbing a fixed directory found nothing here.
    fs.mkdirSync(path.join(projectDir, 'contracts/openapi'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'contracts/openapi/bff.openapi.json'),
      JSON.stringify({ openapi: '3.0.3', info: { title: 'B', version: '1.0.0' }, paths: {} }),
    );
    writeConfig('contracts/openapi/bff.openapi.json');

    const specs = await inProject(() => findOpenAPISpecs({}));

    expect(specs).toEqual(['contracts/openapi/bff.openapi.json']);
  });

  it('fails when a declared spec does not exist', async () => {
    writeConfig('contracts/openapi/missing.json');

    await expect(inProject(() => findOpenAPISpecs({}))).rejects.toThrow(
      /OpenAPI spec not found for 'bff'/,
    );
  });

  it('falls back to the conventional layout without a project config', async () => {
    fs.mkdirSync(path.join(projectDir, 'spec/core/openapi'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, 'spec/core/openapi/core.yaml'),
      'openapi: 3.0.3\ninfo:\n  title: C\n  version: 1.0.0\npaths: {}\n',
    );

    const specs = await inProject(() => findOpenAPISpecs({}));

    expect(specs).toEqual(['spec/core/openapi/core.yaml']);
  });
});

describe('custom command checks', () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-check-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it('fails instead of running a command with an unexpanded {files}', async () => {
    // No project config and no specs under spec/**: the command used to receive
    // the literal "{files}" and could report success having inspected nothing.
    fs.writeFileSync(
      path.join(projectDir, 'micro-contracts.guardrails.yaml'),
      [
        'allowed:',
        '  - "**"',
        'checks:',
        '  spec-lint:',
        '    command: "node -e \\"process.exit(0)\\" {files}"',
        '    gate: 2',
        '',
      ].join('\n'),
    );

    const previous = process.cwd();
    process.chdir(projectDir);
    try {
      const summary = await runAllChecks({ only: ['spec-lint'] });
      const result = summary.results.find(r => r.name === 'spec-lint');
      expect(result?.status).toBe('fail');
      expect(result?.message).toMatch(/Cannot expand \{files\}/);
    } finally {
      process.chdir(previous);
    }
  });
});

describe('getChangedFiles', () => {
  let repo: string;
  let baseRefEnv: string | undefined;

  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: 'pipe' });

  beforeEach(() => {
    // The runner exports GITHUB_BASE_REF on every pull request, and each test below states
    // for itself whether it is a working copy or a pull request.
    baseRefEnv = process.env.GITHUB_BASE_REF;
    delete process.env.GITHUB_BASE_REF;
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'changed-files-'));
    fs.mkdirSync(path.join(repo, 'spec'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'spec/a.yaml'), 'a: 1\n');
    fs.writeFileSync(path.join(repo, '.github/workflow.yml'), 'name: ci\n');
    git('init', '-q', '.');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('add', '-A');
    git('commit', '-qm', 'init');
  });

  afterEach(() => {
    if (baseRefEnv === undefined) {
      delete process.env.GITHUB_BASE_REF;
    } else {
      process.env.GITHUB_BASE_REF = baseRefEnv;
    }
    fs.rmSync(repo, { recursive: true, force: true });
  });

  function inRepo<T>(run: () => T): T {
    const previous = process.cwd();
    process.chdir(repo);
    try {
      return run();
    } finally {
      process.chdir(previous);
    }
  }

  it('reports staged and unstaged changes together', () => {
    // Taking staged files and only falling back to unstaged ones left the
    // protected-path edit below unseen.
    fs.appendFileSync(path.join(repo, 'spec/a.yaml'), 'b: 2\n');
    git('add', 'spec/a.yaml');
    fs.appendFileSync(path.join(repo, '.github/workflow.yml'), '# tampered\n');

    const files = inRepo(() => getChangedFiles({}));

    expect(files).toContain('spec/a.yaml');
    expect(files).toContain('.github/workflow.yml');
  });

  it('reports untracked files', () => {
    fs.writeFileSync(path.join(repo, 'spec/new.yaml'), 'c: 3\n');

    expect(inRepo(() => getChangedFiles({}))).toContain('spec/new.yaml');
  });

  it('reports nothing for a clean tree', () => {
    expect(inRepo(() => getChangedFiles({}))).toEqual([]);
  });

  it('reports what a pull request changed, from a checkout with nothing uncommitted', () => {
    // A CI checkout is clean, so asking the working tree what changed reads no file at all
    // and calls that a pass. The base branch is what the pull request is proposed against.
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    fs.appendFileSync(path.join(repo, '.github/workflow.yml'), '# tampered\n');
    git('add', '-A');
    git('commit', '-qm', 'edit a protected path');
    process.env.GITHUB_BASE_REF = 'main';

    expect(inRepo(() => getChangedFiles({}))).toEqual(['.github/workflow.yml']);
  });

  it('fails instead of passing when the base branch is missing from the checkout', () => {
    // A shallow checkout has no origin/main. Reading that as "nothing to compare against,
    // so nothing changed" is the pass that inspected nothing.
    process.env.GITHUB_BASE_REF = 'main';

    expect(() => inRepo(() => getChangedFiles({}))).toThrow(
      /origin\/main is not in this checkout/,
    );
  });

  it('fails instead of reporting no changes when git cannot run', () => {
    const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), 'not-a-repo-'));
    const previous = process.cwd();
    process.chdir(notARepo);
    try {
      expect(() => getChangedFiles({})).toThrow(/Cannot determine changed files/);
    } finally {
      process.chdir(previous);
      fs.rmSync(notARepo, { recursive: true, force: true });
    }
  });
});

describe('the approval a pull request carries for its protected paths', () => {
  let repo: string;
  let saved: Record<string, string | undefined>;

  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: 'pipe' });

  const CI_VARS = ['GITHUB_BASE_REF', 'GITHUB_EVENT_NAME', 'GITHUB_EVENT_PATH'];

  /** The pull_request payload a runner writes to GITHUB_EVENT_PATH, carrying these labels. */
  function eventWithLabels(...names: string[]): string {
    const file = path.join(repo, 'event.json');
    fs.writeFileSync(
      file,
      JSON.stringify({
        action: 'labeled',
        number: 42,
        pull_request: { number: 42, labels: names.map(name => ({ name })) },
      }),
    );
    return file;
  }

  /** What a pull_request run sees: a clean checkout, a base branch, and an event payload. */
  function onPullRequest(labels: string[]) {
    process.env.GITHUB_BASE_REF = 'main';
    process.env.GITHUB_EVENT_NAME = 'pull_request';
    process.env.GITHUB_EVENT_PATH = eventWithLabels(...labels);
  }

  beforeEach(() => {
    saved = Object.fromEntries(CI_VARS.map(name => [name, process.env[name]]));
    for (const name of CI_VARS) delete process.env[name];

    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-'));
    fs.writeFileSync(
      path.join(repo, 'micro-contracts.guardrails.yaml'),
      ['allowed:', '  - docs/**/*.md', 'protected:', '  - .github/**', 'generated: []', ''].join('\n'),
    );
    fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.github/workflow.yml'), 'name: ci\n');
    fs.writeFileSync(path.join(repo, 'docs/readme.md'), 'hello\n');
    git('init', '-q', '.');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('add', '-A');
    git('commit', '-qm', 'init');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  });

  afterEach(() => {
    for (const name of CI_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name]!;
    }
    fs.rmSync(repo, { recursive: true, force: true });
  });

  async function checkInRepo() {
    const previous = process.cwd();
    process.chdir(repo);
    try {
      return await runAllowlistCheck({
        guardrailsPath: path.join(repo, 'micro-contracts.guardrails.yaml'),
      });
    } finally {
      process.chdir(previous);
    }
  }

  /** Commit a change to a path the config protects. */
  function changeProtectedPath() {
    fs.appendFileSync(path.join(repo, '.github/workflow.yml'), '# edited\n');
    git('add', '-A');
    git('commit', '-qm', 'edit a protected path');
  }

  it('fails a protected change that carries no approval', async () => {
    changeProtectedPath();
    onPullRequest([]);

    const result = await checkInRepo();

    expect(result.status).toBe('fail');
    expect(result.details?.join('\n')).toContain('.github/workflow.yml (protected)');
    expect(result.details?.join('\n')).toContain('guardrails-approved');
  });

  it('passes a protected change the label approves, and says what it let through', async () => {
    changeProtectedPath();
    onPullRequest(['guardrails-approved']);

    const result = await checkInRepo();

    expect(result.status).toBe('pass');
    expect(result.message).toContain('1 protected path(s) allowed by');
    expect(result.message).toContain('pull request #42');
    expect(result.details?.join('\n')).toContain('.github/workflow.yml (protected, approved)');
  });

  it('fails a protected change carrying some other label', async () => {
    changeProtectedPath();
    onPullRequest(['documentation', 'needs-review']);

    expect((await checkInRepo()).status).toBe('fail');
  });

  it('passes a change that touches nothing protected, and stays quiet about it', async () => {
    fs.appendFileSync(path.join(repo, 'docs/readme.md'), 'more\n');
    git('add', '-A');
    git('commit', '-qm', 'edit an allowed path');
    onPullRequest([]);

    const result = await checkInRepo();

    expect(result.status).toBe('pass');
    expect(result.message).not.toContain('protected');
    expect(result.details).toBeUndefined();
  });

  it('stays strict in a working copy, whatever an event payload lying around says', async () => {
    // The approval is a fact about a pull request. Outside one there is nothing to read, and
    // no local switch of ours says otherwise.
    fs.appendFileSync(path.join(repo, '.github/workflow.yml'), '# edited\n');
    process.env.GITHUB_EVENT_PATH = eventWithLabels('guardrails-approved');

    expect((await checkInRepo()).status).toBe('fail');
  });

  it('fails loudly when the pull request it must read is unreadable', async () => {
    // Reading an unreadable payload as "not approved" would leave an approved pull request
    // red with nothing to say why.
    changeProtectedPath();
    onPullRequest(['guardrails-approved']);
    fs.writeFileSync(process.env.GITHUB_EVENT_PATH!, 'not json');

    const result = await checkInRepo();

    expect(result.status).toBe('fail');
    expect(result.message).toContain('Cannot read the pull request under review');
  });

  it('shows the approval in ordinary, non-verbose output', async () => {
    // CI runs `check` without -v, and there a pass prints its message only when the check
    // reported something beyond the routine.
    changeProtectedPath();
    onPullRequest(['guardrails-approved']);
    const result = await checkInRepo();

    const line = formatSingleCheckResult(result, { name: 'allowlist', description: '', gate: 1, run: runAllowlistCheck });

    expect(line).toContain('protected path(s) allowed by');
  });
});

describe('the scaffolded guardrails template', () => {
  it('does not list its own config as allowed as well as protected', () => {
    // protected is tested first, so the allowed entry never decided anything: it read as a
    // permission that was not one.
    const template = generateGuardrailsTemplate();
    const allowed = template.slice(template.indexOf('allowed:'), template.indexOf('protected:'));

    expect(allowed).not.toContain('micro-contracts.guardrails.yaml');
    expect(template.slice(template.indexOf('protected:'))).toContain('micro-contracts.guardrails.yaml');
  });
});

describe('check filters', () => {
  it('rejects a check name that matches nothing', async () => {
    // --only <typo> leaves nothing to run; --skip <typo> skips nothing while the
    // caller believes it did.
    await expect(runAllChecks({ only: ['nosuchcheck'] })).rejects.toThrow(
      /Unknown check in --only: 'nosuchcheck'/,
    );
    await expect(runAllChecks({ skip: ['nosuchcheck'] })).rejects.toThrow(
      /Unknown check in --skip: 'nosuchcheck'/,
    );
  });

  it('runs only the named check, reporting the rest as skipped', async () => {
    const summary = await runAllChecks({ only: ['manifest'], generatedDir: 'nosuchdir' });

    const ran = summary.results.filter(r => r.message !== 'Skipped by filter');
    expect(ran.map(r => r.name)).toEqual(['manifest']);
    expect(summary.passed).toBe(0);
  });
});

describe('runAllChecks', () => {
  it('should return available checks', () => {
    const checks = getAvailableChecks();
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.map(c => c.name)).toContain('allowlist');
    expect(checks.map(c => c.name)).toContain('drift');
    expect(checks.map(c => c.name)).toContain('manifest');
  });
  
  it('should support --only filter', async () => {
    const summary = await runAllChecks({
      only: ['allowlist'],
    });
    
    expect(summary.results.length).toBe(3); // All checks in results (allowlist, drift, manifest)
    
    // Only allowlist should be run
    const allowlistResult = summary.results.find(r => r.name === 'allowlist');
    const driftResult = summary.results.find(r => r.name === 'drift');
    
    expect(allowlistResult?.status).not.toBe('skip');
    expect(driftResult?.status).toBe('skip');
  });
  
  it('should support --skip filter', async () => {
    const summary = await runAllChecks({
      skip: ['manifest'],
    });
    
    const manifestResult = summary.results.find(r => r.name === 'manifest');
    expect(manifestResult?.status).toBe('skip');
    expect(manifestResult?.message).toBe('Skipped by filter');
  });
});

