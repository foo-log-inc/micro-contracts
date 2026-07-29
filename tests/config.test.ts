/**
 * Config shape tests
 *
 * A config key that is mistyped or no longer supported must fail loudly:
 * silently ignoring it (as `server.template` was) looks like it was honored.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig } from '../src/generator/index.js';
import { resolveModuleConfig, validateConfigKeys } from '../src/types.js';
import { lintSpec } from '../src/generator/linter.js';
import type { OpenAPISpec } from '../src/types.js';

describe('validateConfigKeys', () => {
  it('accepts the documented config surface', () => {
    expect(() => validateConfigKeys({
      defaults: {
        contract: { output: 'contracts/{module}', serviceTemplate: 't.hbs' },
        contractPublic: { output: 'contracts-published/{module}' },
        server: { output: 'server/routes.ts', template: 's.hbs', servicesPath: 'fastify.services.{module}' },
        frontend: { output: 'frontend/{module}', template: 'f.hbs', client: 'api.ts', service: 'svc.ts' },
        outputs: { routes: { output: 'a.ts', template: 'b.hbs', config: { servicesPath: 'x' } } },
        overlays: { shared: ['o.yaml'], collision: 'error' },
        docs: { enabled: true },
        sharedModuleName: 'shared',
      },
      modules: {
        bff: {
          openapi: 'openapi/bff.yaml',
          screen: false,
          server: { template: 's.hbs', output: 'o.ts', enabled: true },
          outputs: { routes: { enabled: false } },
          overlays: ['x.yaml'],
          dependsOn: ['core.User.getUsers'],
          spectral: 'spectral.yaml',
        },
      },
      spec: { root: 'spec', shared: { openapi: 'a', templates: 'b', overlays: 'c', spectral: 'd' } },
    })).not.toThrow();
  });

  it('rejects an unknown module key', () => {
    expect(() => validateConfigKeys({
      modules: { bff: { openapi: 'a.yaml', serverr: { template: 't.hbs' } } },
    })).toThrow(/modules\.bff\.serverr/);
  });

  it('rejects an unknown nested key', () => {
    expect(() => validateConfigKeys({
      modules: { bff: { openapi: 'a.yaml', server: { tempalte: 't.hbs' } } },
    })).toThrow(/modules\.bff\.server\.tempalte/);
  });

  it('reports every unknown key at once', () => {
    try {
      validateConfigKeys({
        defaults: { contract: { outputt: 'x' } },
        modules: { bff: { openapi: 'a.yaml', frontendd: {} } },
      });
      throw new Error('expected validateConfigKeys to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('defaults.contract.outputt');
      expect(message).toContain('modules.bff.frontendd');
    }
  });

  it('points removed keys at their replacement', () => {
    expect(() => validateConfigKeys({
      defaults: { templates: { server: 't.hbs' } },
      modules: {},
    })).toThrow(/defaults\.templates \(use defaults\.server\.template/);

    expect(() => validateConfigKeys({
      modules: { bff: { openapi: 'a.yaml', server: { routes: 'routes.generated.ts' } } },
    })).toThrow(/server\.routes \(the file name is part of server\.output/);
  });

  it('does not constrain keys of freeform template config', () => {
    expect(() => validateConfigKeys({
      modules: {
        bff: {
          openapi: 'a.yaml',
          outputs: { routes: { output: 'a.ts', template: 'b.hbs', config: { anything: { nested: true } } } },
        },
      },
    })).not.toThrow();
  });
});

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects a config file with an unknown key', () => {
    const configPath = path.join(tmpDir, 'micro-contracts.config.yaml');
    fs.writeFileSync(configPath, `
modules:
  bff:
    openapi: openapi/bff.yaml
    server:
      tempalte: templates/routes.hbs
`);

    expect(() => loadConfig(configPath)).toThrow(/modules\.bff\.server\.tempalte/);
  });
});

describe('resolveModuleConfig', () => {
  it('resolves server.template from the module, then defaults', () => {
    expect(resolveModuleConfig('bff', { openapi: 'a.yaml', server: { template: 'module.hbs' } }, {
      server: { template: 'defaults.hbs' },
    }).server?.template).toBe('module.hbs');

    expect(resolveModuleConfig('bff', { openapi: 'a.yaml' }, {
      server: { template: 'defaults.hbs' },
    }).server?.template).toBe('defaults.hbs');
  });

  it('leaves legacy sections unresolved when undeclared', () => {
    const resolved = resolveModuleConfig('bff', { openapi: 'a.yaml' }, {});
    expect(resolved.server).toBeNull();
    expect(resolved.frontend).toBeNull();
  });

  it('honors enabled: false for a declared section', () => {
    const resolved = resolveModuleConfig('bff', { openapi: 'a.yaml', server: { enabled: false } }, {
      server: { template: 's.hbs', output: 'o.ts' },
    });
    expect(resolved.server).toBeNull();
  });

  it('defaults server.output to a routes file path', () => {
    const resolved = resolveModuleConfig('bff', { openapi: 'a.yaml', server: { template: 's.hbs' } }, {});
    expect(resolved.server?.output).toBe('server/src/bff/routes.generated.ts');
  });

  it('rejects an output entry that resolves without a template', () => {
    expect(() => resolveModuleConfig('bff', { openapi: 'a.yaml' }, {
      outputs: { routes: { output: 'routes.ts' } as never },
    })).toThrow(/outputs\.routes for module 'bff' is missing template/);
  });
});

describe('lintSpec identifier rules', () => {
  function specWith(extensions: Record<string, string>): OpenAPISpec {
    return {
      openapi: '3.0.3',
      info: { title: 'T', version: '1.0.0' },
      paths: {
        '/items': {
          get: {
            operationId: 'getItems',
            ...extensions,
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    } as unknown as OpenAPISpec;
  }

  it('rejects extension values that are not valid TypeScript identifiers', () => {
    const result = lintSpec(specWith({
      'x-micro-contracts-service': 'Item-Service',
      'x-micro-contracts-method': 'get items',
    }));

    expect(result.valid).toBe(false);
    expect(result.errors.map(e => e.code)).toEqual(
      expect.arrayContaining(['INVALID_X_SERVICE', 'INVALID_X_METHOD'])
    );
  });

  it('accepts identifier-shaped extension values', () => {
    const result = lintSpec(specWith({
      'x-micro-contracts-service': 'Item',
      'x-micro-contracts-method': 'getItems',
    }));

    expect(result.errors).toHaveLength(0);
  });
});
