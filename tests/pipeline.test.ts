/**
 * Tests for pipeline command
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, ExecSyncOptionsWithStringEncoding } from 'child_process';

// Path to the CLI
const CLI_PATH = path.resolve(__dirname, '../dist/cli.js');

// Check if built CLI exists
const isBuilt = fs.existsSync(CLI_PATH);

describe('pipeline command', () => {
  let tempDir: string;
  
  beforeEach(() => {
    // Create temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));

    // The guardrails are git-based: the allowlist check reports what changed
    // against the commit, and fails when it cannot ask git at all.
    const git = (...args: string[]) =>
      execSync(`git ${args.join(' ')}`, { cwd: tempDir, encoding: 'utf-8', stdio: 'pipe' });
    git('init', '-q', '.');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('commit', '-q', '--allow-empty', '-m', 'init');
  });
  
  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  
  // Helper to run CLI command
  function runCli(args: string, options: { cwd?: string } = {}): { stdout: string; exitCode: number } {
    const execOptions: ExecSyncOptionsWithStringEncoding = {
      cwd: options.cwd || tempDir,
      encoding: 'utf-8',
      env: { ...process.env, NO_COLOR: '1' },
    };
    
    try {
      const stdout = execSync(`node ${CLI_PATH} ${args}`, execOptions);
      return { stdout, exitCode: 0 };
    } catch (error: unknown) {
      const execError = error as { status?: number; stdout?: string; stderr?: string };
      return {
        stdout: execError.stdout || execError.stderr || '',
        exitCode: execError.status || 1,
      };
    }
  }
  
  // Helper to create minimal config
  function createMinimalConfig(): void {
    const configContent = `
# Minimal config for testing
defaults:
  contract:
    output: packages/contract/{module}

modules:
  test:
    openapi: spec/test/openapi/test.yaml
`;
    fs.writeFileSync(path.join(tempDir, 'micro-contracts.config.yaml'), configContent);
  }
  
  // Helper to create minimal OpenAPI spec
  function createMinimalSpec(): void {
    fs.mkdirSync(path.join(tempDir, 'spec/test/openapi'), { recursive: true });
    const specContent = `
openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths:
  /health:
    get:
      operationId: getHealth
      x-micro-contracts-service: Health
      x-micro-contracts-method: getHealth
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
`;
    fs.writeFileSync(path.join(tempDir, 'spec/test/openapi/test.yaml'), specContent);
  }
  
  // Helper to create guardrails config
  function createGuardrailsConfig(): void {
    const guardrailsContent = `
allowed:
  - spec/**
  - "*.yaml"
  - "*.md"

protected:
  - .github/**

generated:
  - packages/**
`;
    fs.writeFileSync(path.join(tempDir, 'micro-contracts.guardrails.yaml'), guardrailsContent);
  }
  
  describe.skipIf(!isBuilt)('CLI integration tests', () => {
    it('a partial generate does not let a later full run skip', () => {
      // The input hash means "these inputs have been generated from". Stamping
      // it after generating a subset would leave the rest permanently missing.
      createGuardrailsConfig();
      fs.mkdirSync(path.join(tempDir, 'spec/core/openapi'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'packages'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'spec/core/openapi/core.yaml'),
        [
          'openapi: 3.0.3',
          'info:',
          '  title: Core',
          '  version: 1.0.0',
          'paths:',
          '  /items:',
          '    get:',
          '      operationId: getItems',
          '      x-micro-contracts-service: Item',
          '      x-micro-contracts-method: getItems',
          '      responses:',
          "        '200':",
          '          description: ok',
          'components:',
          '  schemas: {}',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(path.join(tempDir, 'first.hbs'), 'first');
      fs.writeFileSync(path.join(tempDir, 'second.hbs'), 'second');
      fs.writeFileSync(
        path.join(tempDir, 'micro-contracts.config.yaml'),
        [
          'defaults:',
          '  contract:',
          '    output: packages/contract/{module}',
          '  outputs:',
          '    first:',
          '      output: packages/out/first.generated.ts',
          '      template: first.hbs',
          '    second:',
          '      output: packages/out/second.generated.ts',
          '      template: second.hbs',
          'modules:',
          '  core:',
          '    openapi: spec/core/openapi/core.yaml',
          '',
        ].join('\n'),
      );

      const partial = runCli('generate --output first');
      expect(partial.exitCode).toBe(0);
      expect(fs.existsSync(path.join(tempDir, 'packages/out/first.generated.ts'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'packages/out/second.generated.ts'))).toBe(false);

      const manifest = JSON.parse(
        fs.readFileSync(path.join(tempDir, 'packages/.generated-manifest.json'), 'utf-8'),
      );
      expect(manifest.inputHash).toBeUndefined();

      const full = runCli('generate');
      expect(full.exitCode).toBe(0);
      expect(full.stdout).not.toContain('No input changes detected');
      expect(fs.existsSync(path.join(tempDir, 'packages/out/second.generated.ts'))).toBe(true);
    });

    it('deps fails instead of reporting an incomplete graph', () => {
      // A module whose spec is missing would silently drop out of the graph,
      // impact analysis and validation output.
      fs.writeFileSync(
        path.join(tempDir, 'micro-contracts.config.yaml'),
        [
          'modules:',
          '  core:',
          '    openapi: spec/core/openapi/does-not-exist.yaml',
          '',
        ].join('\n'),
      );

      const { stdout, exitCode } = runCli('deps --graph');

      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/OpenAPI spec not found for module 'core'/);
    });

    it('should show help for pipeline command', () => {
      const { stdout, exitCode } = runCli('pipeline --help');
      
      expect(exitCode).toBe(0);
      expect(stdout).toContain('Run full guardrails pipeline');
      expect(stdout).toContain('--verbose');
      expect(stdout).toContain('--continue-on-error');
      expect(stdout).toContain('--skip');
    });
    
    it('should run pipeline without config (skips generation)', () => {
      // Create only guardrails config, no micro-contracts.config.yaml
      createGuardrailsConfig();
      
      const { stdout } = runCli('pipeline --skip drift,manifest');
      
      // Pipeline should run but skip generation due to missing config
      expect(stdout).toContain('Running AI Guardrails Pipeline');
      expect(stdout).toContain('allowlist');
      expect(stdout).toContain('Generate');
      expect(stdout).toContain('SKIP');
      expect(stdout).toContain('Pipeline Summary');
    });
    
    it('should support --verbose option', () => {
      createGuardrailsConfig();
      
      const { stdout } = runCli('pipeline --verbose');
      
      expect(stdout).toContain('Running AI Guardrails Pipeline');
    });
    
    it('should support --skip option', () => {
      createGuardrailsConfig();
      
      const { stdout } = runCli('pipeline --skip drift,manifest');
      
      expect(stdout).toContain('Running AI Guardrails Pipeline');
      // Should have skipped checks
      expect(stdout).toContain('SKIP');
    });
    
    it('should run full pipeline with config and spec', () => {
      createMinimalConfig();
      createMinimalSpec();
      createGuardrailsConfig();
      
      // Use --contracts-only to skip server/frontend generation (no templates configured)
      // Use --skip drift,manifest to avoid failures due to test setup (no git repo)
      const { stdout } = runCli('pipeline --contracts-only --skip drift,manifest');
      
      expect(stdout).toContain('Running AI Guardrails Pipeline');
      expect(stdout).toContain('allowlist');
      expect(stdout).toContain('Generate');
      expect(stdout).toContain('Pipeline Summary');
    });
    
    it('should run full pipeline with verbose mode', () => {
      createMinimalConfig();
      createMinimalSpec();
      createGuardrailsConfig();
      
      // Verbose mode shows step headers
      const { stdout } = runCli('pipeline --contracts-only --skip drift,manifest -v');
      
      expect(stdout).toContain('Running AI Guardrails Pipeline');
      expect(stdout).toContain('Step 1: Pre-generation checks');
      expect(stdout).toContain('Step 3: Post-generation checks');
      expect(stdout).toContain('Pipeline Summary');
    });
    
    it('should continue on error with --continue-on-error', () => {
      createGuardrailsConfig();
      
      // Pipeline without config will skip generation but continue with checks
      // Some checks may fail in a non-git directory, but --continue-on-error should continue
      const { stdout } = runCli('pipeline --continue-on-error --skip drift');
      
      expect(stdout).toContain('Running AI Guardrails Pipeline');
      // With --continue-on-error, pipeline should run all steps and show summary
      expect(stdout).toContain('Pipeline Summary');
    });
  });
  
  describe('unit tests (no build required)', () => {
    it('should create test fixtures correctly', () => {
      createMinimalConfig();
      createMinimalSpec();
      createGuardrailsConfig();
      
      expect(fs.existsSync(path.join(tempDir, 'micro-contracts.config.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'spec/test/openapi/test.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'micro-contracts.guardrails.yaml'))).toBe(true);
    });
  });
});
