/**
 * Tests for pipeline command
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, ExecSyncOptionsWithStringEncoding } from 'child_process';

// Each test spawns the CLI several times, generating as it goes.
// Real work, not a hang: the default 30s trips on a loaded machine.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });


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
      // These fixtures are a working copy, and the allowlist asks about the working tree.
      // On a pull request the runner exports GITHUB_BASE_REF, which would make the check ask
      // a scratch repo what it changed against a branch it has never heard of.
      env: { ...process.env, NO_COLOR: '1', GITHUB_BASE_REF: '' },
    };
    
    try {
      const stdout = execSync(`node ${CLI_PATH} ${args}`, execOptions);
      return { stdout, exitCode: 0 };
    } catch (error: unknown) {
      const execError = error as { status?: number; stdout?: string; stderr?: string };
      return {
        // Both: a failing run often prints progress before the error.
        stdout: `${execError.stdout ?? ''}${execError.stderr ?? ''}`,
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

    it('keeps hand-written packages out of the manifest and regenerates outputs it cannot vouch for', () => {
      fs.mkdirSync(path.join(tempDir, 'api/orders'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'api/orders/openapi.yaml'),
        [
          'openapi: 3.0.3',
          'info:',
          '  title: Orders',
          '  version: 1.0.0',
          'paths:',
          '  /orders:',
          '    get:',
          '      operationId: getOrders',
          '      x-micro-contracts-service: Order',
          '      x-micro-contracts-method: getOrders',
          '      responses:',
          "        '200':",
          '          description: ok',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(tempDir, 'micro-contracts.config.yaml'),
        ['defaults:', '  contract:', '    output: contracts/{module}', 'modules:', '  orders:', '    openapi: api/orders/openapi.yaml', ''].join('\n'),
      );
      fs.writeFileSync(path.join(tempDir, 'micro-contracts.guardrails.yaml'), 'generated:\n  - "contracts/**"\n');
      fs.mkdirSync(path.join(tempDir, 'packages/app/src'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'packages/app/src/index.ts'), 'export const handWritten = 1;\n');

      // The manifest lives where it can see every output: here, the project root.
      expect(runCli('generate').exitCode).toBe(0);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(tempDir, '.generated-manifest.json'), 'utf-8'),
      );
      expect(Object.keys(manifest.files)).toContain('contracts/orders/index.ts');
      expect(Object.keys(manifest.files)).not.toContain('packages/app/src/index.ts');

      fs.rmSync(path.join(tempDir, 'contracts'), { recursive: true, force: true });
      const again = runCli('generate');
      expect(again.exitCode).toBe(0);
      expect(again.stdout).not.toContain('No input changes detected');
      expect(fs.existsSync(path.join(tempDir, 'contracts/orders/index.ts'))).toBe(true);

      fs.writeFileSync(path.join(tempDir, 'packages/app/src/index.ts'), 'export const handWritten = 2;\n');
      const check = runCli('check --only manifest');
      expect(check.stdout).not.toContain('app/src/index.ts');
      expect(check.exitCode).toBe(0);

      // A directory given explicitly that the outputs lie outside: generating
      // again cannot help, and the failure says so.
      expect(runCli('generate --manifest-dir packages/').exitCode).toBe(0);
      const explicit = runCli('check --only manifest --generated-dir packages/');
      expect(explicit.exitCode).toBe(1);
      expect(explicit.stdout).not.toContain('Run generate before verifying');
      expect(explicit.stdout).toContain('contracts/orders');
      expect(explicit.stdout).toContain('--manifest-dir');
    });

    it('caches a project generating both into packages/ and next to its server code', () => {
      fs.mkdirSync(path.join(tempDir, 'api'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'api/core.yaml'),
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
          '',
        ].join('\n'),
      );
      fs.writeFileSync(path.join(tempDir, 'routes.hbs'), '{{#each routes}}{{operationId}}\n{{/each}}');
      fs.writeFileSync(
        path.join(tempDir, 'micro-contracts.config.yaml'),
        [
          'defaults:',
          '  contract:',
          '    output: packages/contract/{module}',
          '  outputs:',
          '    routes:',
          '      output: server/src/{module}/routes.generated.ts',
          '      template: routes.hbs',
          'modules:',
          '  core:',
          '    openapi: api/core.yaml',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(tempDir, 'micro-contracts.guardrails.yaml'),
        'generated:\n  - "packages/**"\n  - "**/*.generated.ts"\n',
      );

      expect(runCli('generate').exitCode).toBe(0);
      expect(runCli('generate').stdout).toContain('No input changes detected');

      fs.rmSync(path.join(tempDir, 'server/src/core/routes.generated.ts'));
      const again = runCli('generate');
      expect(again.stdout).not.toContain('No input changes detected');
      expect(fs.existsSync(path.join(tempDir, 'server/src/core/routes.generated.ts'))).toBe(true);

      expect(runCli('check --only manifest').exitCode).toBe(0);
    });

    it('regenerates an output in the manifest directory that the generated patterns leave out', () => {
      fs.mkdirSync(path.join(tempDir, 'api/orders'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'api/orders/openapi.yaml'),
        [
          'openapi: 3.0.3',
          'info:',
          '  title: Orders',
          '  version: 1.0.0',
          'paths:',
          '  /orders:',
          '    get:',
          '      operationId: getOrders',
          '      x-micro-contracts-service: Order',
          '      x-micro-contracts-method: getOrders',
          '      responses:',
          "        '200':",
          '          description: ok',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(path.join(tempDir, 'dump.hbs'), '{{#each routes}}{{operationId}}\n{{/each}}');
      fs.writeFileSync(
        path.join(tempDir, 'micro-contracts.config.yaml'),
        [
          'defaults:',
          '  contract:',
          '    output: packages/contract/{module}',
          '  outputs:',
          '    dump:',
          '      output: packages/server/{module}/routes.ts',
          '      template: dump.hbs',
          'modules:',
          '  orders:',
          '    openapi: api/orders/openapi.yaml',
          '',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(tempDir, 'micro-contracts.guardrails.yaml'),
        'generated:\n  - "packages/contract/**"\n  - "**/*.generated.ts"\n',
      );

      expect(runCli('generate').exitCode).toBe(0);
      fs.rmSync(path.join(tempDir, 'packages/server'), { recursive: true, force: true });

      const again = runCli('generate');
      expect(again.exitCode).toBe(0);
      expect(again.stdout).not.toContain('No input changes detected');
      expect(fs.existsSync(path.join(tempDir, 'packages/server/orders/routes.ts'))).toBe(true);
    });

    it('places the manifest by the config passed with --config, not the one in the working directory', () => {
      fs.mkdirSync(path.join(tempDir, 'api'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'conf'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'api/core.yaml'),
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
          '',
        ].join('\n'),
      );
      const configFor = (dir: string) => [
        'defaults:',
        '  contract:',
        `    output: ${dir}/contract/{module}`,
        '  contractPublic:',
        `    output: ${dir}/published/{module}`,
        'modules:',
        '  core:',
        '    openapi: api/core.yaml',
        '',
      ].join('\n');
      // The working directory's own config generates elsewhere.
      fs.writeFileSync(path.join(tempDir, 'micro-contracts.config.yaml'), configFor('other'));
      fs.writeFileSync(path.join(tempDir, 'conf/real.yaml'), configFor('gen'));
      fs.writeFileSync(
        path.join(tempDir, 'micro-contracts.guardrails.yaml'),
        'generated:\n  - "gen/**"\n  - "other/**"\n',
      );

      expect(runCli('generate --config conf/real.yaml').exitCode).toBe(0);
      expect(fs.existsSync(path.join(tempDir, 'gen/.generated-manifest.json'))).toBe(true);
      expect(runCli('generate --config conf/real.yaml').stdout).toContain('No input changes detected');
    });

    it('generate --no-manifest writes no manifest, and --no-cache neither reads nor writes the cache', () => {
      createMinimalConfig();
      createMinimalSpec();
      createGuardrailsConfig();
      const manifestPath = path.join(tempDir, 'packages/.generated-manifest.json');

      const noManifest = runCli('generate --no-manifest');
      expect(noManifest.stdout).not.toMatch(/unknown option/);
      expect(noManifest.exitCode).toBe(0);
      expect(fs.existsSync(manifestPath)).toBe(false);

      expect(runCli('generate').exitCode).toBe(0);
      expect(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')).inputHash).toBeDefined();

      const noCache = runCli('generate --no-cache');
      expect(noCache.stdout).not.toMatch(/unknown option/);
      expect(noCache.exitCode).toBe(0);
      expect(noCache.stdout).not.toContain('No input changes detected');
      expect(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')).inputHash).toBeUndefined();
    });

    it('pipeline --no-manifest writes no manifest, and --no-cache neither reads nor writes the cache', () => {
      createMinimalConfig();
      createMinimalSpec();
      createGuardrailsConfig();
      const manifestPath = path.join(tempDir, 'packages/.generated-manifest.json');

      const noManifest = runCli('pipeline --no-manifest --skip drift,manifest');
      expect(noManifest.stdout).not.toMatch(/unknown option/);
      expect(noManifest.stdout).toMatch(/Generate\s+PASS/);
      expect(fs.existsSync(manifestPath)).toBe(false);

      runCli('pipeline --skip drift,manifest');
      expect(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')).inputHash).toBeDefined();

      const noCache = runCli('pipeline --no-cache --skip drift,manifest');
      expect(noCache.stdout).not.toMatch(/unknown option/);
      expect(noCache.stdout).toMatch(/Generate\s+PASS/);
      expect(JSON.parse(fs.readFileSync(manifestPath, 'utf-8')).inputHash).toBeUndefined();
    });

    it('does not call a pipeline that ran nothing successful', () => {
      // #77 fixed this verdict for `check`; the pipeline printed its own.
      createGuardrailsConfig();

      const { stdout, exitCode } = runCli('pipeline --skip allowlist,drift,manifest');

      expect(stdout).toContain('No checks ran');
      expect(stdout).not.toContain('Pipeline completed successfully');
      expect(exitCode).toBe(1);
    });

    /** The spec the quick start hands init */
    function writeQuickStartSpec(): void {
      fs.writeFileSync(
        path.join(tempDir, 'my-spec.json'),
        JSON.stringify({
          openapi: '3.0.0',
          info: { title: 'T', version: '1.0.0' },
          paths: {
            '/a': {
              get: {
                operationId: 'getA',
                'x-micro-contracts-service': 'A',
                'x-micro-contracts-method': 'get',
                responses: { '200': { description: 'ok' } },
              },
            },
          },
        }),
      );
    }

    it('runs the documented quick start end to end', () => {
      // init scaffolds a config, and the rules generate enforces have tightened
      // repeatedly; without this the two drift apart silently — a scaffolded
      // project referencing an overlay init never wrote, or a template path that
      // no longer resolves, only shows up when someone follows the README.
      writeQuickStartSpec();

      const init = runCli('init core --openapi my-spec.json');
      expect(init.exitCode).toBe(0);

      const generate = runCli('generate');
      expect(generate.stdout).toContain('Generation complete');
      expect(generate.exitCode).toBe(0);

      expect(fs.existsSync(path.join(tempDir, 'packages/contract/core/schemas/types.ts'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'server/src/core/routes.generated.ts'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'spec/default/templates/lambda-routes.hbs'))).toBe(false);
    });

    it('runs the quick start with --lambda end to end, generating the Lambda handler as the server', () => {
      writeQuickStartSpec();

      expect(runCli('init core --openapi my-spec.json --lambda').exitCode).toBe(0);
      expect(fs.existsSync(path.join(tempDir, 'spec/default/templates/lambda-routes.hbs'))).toBe(true);

      const generate = runCli('generate');
      expect(generate.stdout).toContain('Generation complete');
      expect(generate.exitCode).toBe(0);

      expect(fs.existsSync(path.join(tempDir, 'server/src/core/lambda.generated.ts'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'server/src/core/routes.generated.ts'))).toBe(false);
    });

    it('answers impact by module and by operation, and rejects unknown refs', () => {
      // "No modules depend on this API" is a conclusion someone acts on, so an
      // input that matches nothing declared must not produce it.
      const specs: Array<[string, string, string, string]> = [
        ['core', '', 'User', 'getUsers'],
        ['billing', '\n  x-micro-contracts-depend-on:\n    - core.User.getUsers', 'Invoice', 'getInvoices'],
      ];
      for (const [name, dependsOn, service, method] of specs) {
        fs.mkdirSync(path.join(tempDir, `spec/${name}/openapi`), { recursive: true });
        fs.writeFileSync(
          path.join(tempDir, `spec/${name}/openapi/${name}.yaml`),
          [
            'openapi: 3.0.3',
            'info:',
            `  title: ${name}`,
            `  version: 1.0.0${dependsOn}`,
            'paths:',
            `  /${name}:`,
            '    get:',
            `      operationId: get_${name}`,
            `      x-micro-contracts-service: ${service}`,
            `      x-micro-contracts-method: ${method}`,
            '      responses:',
            "        '200':",
            '          description: ok',
            'components:',
            '  schemas: {}',
            '',
          ].join('\n'),
        );
      }
      fs.writeFileSync(
        path.join(tempDir, 'micro-contracts.config.yaml'),
        [
          'modules:',
          '  core:',
          '    openapi: spec/core/openapi/core.yaml',
          '  billing:',
          '    openapi: spec/billing/openapi/billing.yaml',
          '',
        ].join('\n'),
      );

      expect(runCli('deps --impact core').stdout).toContain('- billing');
      expect(runCli('deps --impact core.User.getUsers').stdout).toContain('- billing');
      expect(runCli('deps --who-depends-on core').stdout).toContain('- billing');

      const unknownRef = runCli('deps --impact nosuch.Thing.method');
      expect(unknownRef.exitCode).toBe(1);
      expect(unknownRef.stdout).toMatch(/Unknown module or API reference/);

      const typo = runCli('deps --who-depends-on cor');
      expect(typo.exitCode).toBe(1);
      expect(typo.stdout).toMatch(/Unknown module or API reference/);
    });

    it('runs the documented setup through a passing check', () => {
      // Two scaffolders and three gates, none of which had ever been run
      // against each other's output.
      fs.writeFileSync(
        path.join(tempDir, 'my-spec.json'),
        JSON.stringify({
          openapi: '3.0.0',
          info: { title: 'T', version: '1.0.0' },
          paths: {
            '/a': {
              get: {
                operationId: 'getA',
                'x-micro-contracts-service': 'A',
                'x-micro-contracts-method': 'get',
                responses: { '200': { description: 'ok' } },
              },
            },
          },
        }),
      );

      expect(runCli('init core --openapi my-spec.json').exitCode).toBe(0);
      expect(runCli('guardrails-init').exitCode).toBe(0);
      expect(fs.existsSync(path.join(tempDir, 'micro-contracts.guardrails.yaml'))).toBe(true);
      expect(runCli('generate').exitCode).toBe(0);

      // drift compares against the commit, which is why the guidance says to
      // commit before checking.
      const git = (...args: string[]) =>
        execSync(`git ${args.join(' ')}`, { cwd: tempDir, encoding: 'utf-8', stdio: 'pipe' });
      git('add', '-A');
      git('commit', '-qm', 'scaffold');

      expect(runCli('check').exitCode).toBe(0);

      // Editing what init scaffolded must be allowed: the two scaffolders have
      // to agree on the layout. Committing first makes the allowlist see only
      // this edit, so the assertion is about the policy, not about an empty
      // changed-file list.
      fs.appendFileSync(path.join(tempDir, 'src/core/container.ts'), '// edit\n');

      const edited = runCli('check --only allowlist');
      expect(edited.stdout).not.toMatch(/not-in-allowlist|\(protected\)/);
      expect(edited.exitCode).toBe(0);

      // A hand-edited generated file must still be caught.
      fs.appendFileSync(path.join(tempDir, 'packages/contract/core/index.ts'), '// tampered\n');
      expect(runCli('check --only drift').exitCode).toBe(1);
    });

    it('runs the screen-spec quick start end to end', () => {
      // A second scaffolded config, edited by the same fixes as the first.
      expect(runCli('init home --screens').exitCode).toBe(0);

      const generate = runCli('generate');
      expect(generate.stdout).toContain('Generation complete');
      expect(generate.exitCode).toBe(0);

      expect(fs.existsSync(path.join(tempDir, 'frontend/src/screens/navigation.generated.ts'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'frontend/src/screens/events.generated.ts'))).toBe(true);
    });

    it('lints a screen spec on its own under the rules generate applies to it', () => {
      expect(runCli('init home --screens').exitCode).toBe(0);

      const lint = runCli('lint spec/home/openapi/home.yaml --strict');
      expect(lint.stdout).not.toContain('MISSING_X_SERVICE');
      expect(lint.exitCode).toBe(0);
    });

    it('honors lint --strict', () => {
      // The flag was declared and implemented, but the handler passed
      // strict: false unconditionally.
      fs.writeFileSync(
        path.join(tempDir, 'warned.yaml'),
        [
          'openapi: 3.0.3',
          'info:',
          '  title: T',
          '  version: 1.0.0',
          'paths:',
          '  /home:',
          '    get:',
          '      operationId: getHome',
          '      x-micro-contracts-service: Home',
          '      x-micro-contracts-method: get',
          '      x-events:',
          '        - name: home_view',
          '          type: screen_view',
          '      responses:',
          "        '200':",
          '          description: ok',
          'components:',
          '  schemas: {}',
          '',
        ].join('\n'),
      );

      expect(runCli('lint warned.yaml').exitCode).toBe(0);

      const strict = runCli('lint warned.yaml --strict');
      expect(strict.exitCode).toBe(1);
      expect(strict.stdout).toMatch(/warning\(s\) \(strict\)/);
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
