/**
 * Generator Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  loadOpenAPISpec,
  loadConfig,
  generate,
} from '../src/generator/index.js';
import type { MultiModuleConfig } from '../src/types.js';

describe('generator', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generator-test-'));
  });

  afterEach(() => {
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loadOpenAPISpec', () => {
    it('should load YAML spec', () => {
      const specPath = path.join(tmpDir, 'spec.yaml');
      fs.writeFileSync(specPath, `
openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths: {}
`);

      const spec = loadOpenAPISpec(specPath);
      expect(spec.info.title).toBe('Test API');
      expect(spec.info.version).toBe('1.0.0');
    });

    it('should load JSON spec', () => {
      const specPath = path.join(tmpDir, 'spec.json');
      fs.writeFileSync(specPath, JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {},
      }));

      const spec = loadOpenAPISpec(specPath);
      expect(spec.info.title).toBe('Test API');
    });

    it('should throw on unsupported format', () => {
      const specPath = path.join(tmpDir, 'spec.txt');
      fs.writeFileSync(specPath, 'not a spec');

      expect(() => loadOpenAPISpec(specPath)).toThrow(/unsupported/i);
    });
  });

  describe('loadConfig', () => {
    it('should load multi-module config', () => {
      const configPath = path.join(tmpDir, 'config.yaml');
      fs.writeFileSync(configPath, `
defaults:
  contract:
    output: packages/contract/{module}
modules:
  core:
    openapi: docs/openapi.yaml
`);

      const config = loadConfig(configPath) as MultiModuleConfig;
      expect(config.modules.core).toBeDefined();
      expect(config.modules.core.openapi).toBe('docs/openapi.yaml');
    });
  });

  describe('generate', () => {
    it('should generate contract package', async () => {
      // Create spec
      const specPath = path.join(tmpDir, 'spec.yaml');
      fs.writeFileSync(specPath, `
openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths:
  /api/users:
    get:
      operationId: getUsers
      x-micro-contracts-service: User
      x-micro-contracts-method: getUsers
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UserList'
components:
  schemas:
    UserList:
      type: object
      properties:
        users:
          type: array
          items:
            type: object
`);

      // Create config
      const config: MultiModuleConfig = {
        defaults: {
          contract: { output: path.join(tmpDir, 'packages/contract/{module}') },
          contractPublic: { output: path.join(tmpDir, 'packages/contract-published/{module}') },
        },
        modules: {
          core: {
            openapi: specPath,
          },
        },
      };

      // Generate
      await generate(config, { skipLint: true, contractsOnly: true });

      // Check outputs
      const contractDir = path.join(tmpDir, 'packages/contract/core');
      expect(fs.existsSync(path.join(contractDir, 'index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(contractDir, 'schemas', 'types.ts'))).toBe(true);
      expect(fs.existsSync(path.join(contractDir, 'schemas', 'validators.ts'))).toBe(true);
      expect(fs.existsSync(path.join(contractDir, 'services', 'index.ts'))).toBe(true);
    });

    it('should generate server routes', async () => {
      // Create spec
      const specPath = path.join(tmpDir, 'spec.yaml');
      fs.writeFileSync(specPath, `
openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths:
  /api/users:
    get:
      operationId: getUsers
      x-micro-contracts-service: User
      x-micro-contracts-method: getUsers
      responses:
        '200':
          description: Success
components:
  schemas: {}
`);

      // Create template
      const templatePath = path.join(tmpDir, 'fastify-routes.hbs');
      fs.writeFileSync(templatePath, `
// Auto-generated routes
import type { FastifyInstance } from 'fastify';

export async function registerRoutes(fastify: FastifyInstance, services: any) {
{{#each routes}}
  fastify.{{lowercase method}}('{{path}}', async (request, reply) => {
    return services.{{serviceKey}}.{{handler}}(request.body);
  });
{{/each}}
}
`);

      // Create config
      const config: MultiModuleConfig = {
        defaults: {
          contract: { output: path.join(tmpDir, 'packages/contract/{module}') },
          contractPublic: { output: path.join(tmpDir, 'packages/contract-published/{module}') },
          server: {
            output: path.join(tmpDir, 'server/src/{module}/routes.generated.ts'),
            template: templatePath,
          },
        },
        modules: {
          core: {
            openapi: specPath,
          },
        },
      };

      // Generate
      await generate(config, { skipLint: true, serverOnly: true });

      // Check outputs
      const routesPath = path.join(tmpDir, 'server/src/core/routes.generated.ts');
      expect(fs.existsSync(routesPath)).toBe(true);
      
      const routesContent = fs.readFileSync(routesPath, 'utf-8');
      expect(routesContent).toContain('registerRoutes');
      // Check basic structure from our test template
      expect(routesContent).toContain('fastify.get');
      expect(routesContent).toContain('/api/users');
    });

    it('should generate frontend client', async () => {
      // Create spec
      const specPath = path.join(tmpDir, 'spec.yaml');
      fs.writeFileSync(specPath, `
openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths:
  /api/users:
    get:
      operationId: getUsers
      x-micro-contracts-service: User
      x-micro-contracts-method: getUsers
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UserList'
components:
  schemas:
    UserList:
      type: object
`);

      // Create template
      const templatePath = path.join(tmpDir, 'fetch-client.hbs');
      fs.writeFileSync(templatePath, `
// Auto-generated API client
const BASE_URL = '';

{{#each services}}
export const {{camelCase name}}ServiceApi = {
{{#each operations}}
  async {{name}}(): Promise<any> {
    const response = await fetch(BASE_URL + '{{../path}}');
    return response.json();
  },
{{/each}}
};
{{/each}}

export function getUsers() { return userServiceApi.getUsers(); }
`);

      // Create config
      const config: MultiModuleConfig = {
        defaults: {
          contract: { output: path.join(tmpDir, 'packages/contract/{module}') },
          contractPublic: { output: path.join(tmpDir, 'packages/contract-published/{module}') },
          frontend: {
            output: path.join(tmpDir, 'frontend/src/{module}'),
            template: templatePath,
            client: 'api.generated.ts',
            service: 'service.generated.ts',
          },
        },
        modules: {
          core: {
            openapi: specPath,
          },
        },
      };

      // Generate
      await generate(config, { skipLint: true, frontendOnly: true });

      // Check outputs
      const clientPath = path.join(tmpDir, 'frontend/src/core/api.generated.ts');
      expect(fs.existsSync(clientPath)).toBe(true);
      
      const clientContent = fs.readFileSync(clientPath, 'utf-8');
      expect(clientContent).toContain('getUsers');
      // Check for service API export
      expect(clientContent).toContain('userServiceApi');
    });

    it('should apply overlays and generate extension interfaces', async () => {
      // Create spec
      const specPath = path.join(tmpDir, 'spec.yaml');
      fs.writeFileSync(specPath, `
openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths:
  /api/users:
    get:
      operationId: getUsers
      x-micro-contracts-service: User
      x-micro-contracts-method: getUsers
      x-middleware:
        - requireAuth
      responses:
        '200':
          description: Success
components:
  schemas: {}
`);

      // Create overlay
      const overlayPath = path.join(tmpDir, 'auth.overlay.yaml');
      fs.writeFileSync(overlayPath, `
overlay: 1.0.0
info:
  title: Auth Overlay
  version: 1.0.0
actions:
  - target: "$.paths[*][*][?(@.x-middleware contains 'requireAuth')]"
    update:
      responses:
        '401':
          description: Unauthorized
`);

      // Create config
      const config: MultiModuleConfig = {
        defaults: {
          contract: { output: path.join(tmpDir, 'packages/contract/{module}') },
          contractPublic: { output: path.join(tmpDir, 'packages/contract-published/{module}') },
          overlays: {
            shared: [overlayPath],
            collision: 'error',
          },
        },
        modules: {
          core: {
            openapi: specPath,
          },
        },
      };

      // Generate
      await generate(config, { skipLint: true, contractsOnly: true });

      // Check that overlay interfaces were generated
      const overlaysPath = path.join(tmpDir, 'packages/contract/core/overlays/index.ts');
      expect(fs.existsSync(overlaysPath)).toBe(true);
      
      const overlayContent = fs.readFileSync(overlaysPath, 'utf-8');
      expect(overlayContent).toContain('MiddlewareValue');
      expect(overlayContent).toContain('requireAuth');
      expect(overlayContent).toContain('MiddlewareRegistry');

      // Check that generated OpenAPI spec was written (with overlays applied)
      const generatedSpecPath = path.join(tmpDir, 'packages/contract/core/docs/openapi.generated.yaml');
      expect(fs.existsSync(generatedSpecPath)).toBe(true);
    });

    it('should filter to specific modules', async () => {
      // Create specs
      const coreSpecPath = path.join(tmpDir, 'core.yaml');
      fs.writeFileSync(coreSpecPath, `
openapi: 3.0.3
info:
  title: Core API
  version: 1.0.0
paths:
  /api/core:
    get:
      operationId: getCoreData
      x-micro-contracts-service: Core
      x-micro-contracts-method: getData
      responses:
        '200':
          description: Success
components:
  schemas: {}
`);

      const usersSpecPath = path.join(tmpDir, 'users.yaml');
      fs.writeFileSync(usersSpecPath, `
openapi: 3.0.3
info:
  title: Users API
  version: 1.0.0
paths:
  /api/users:
    get:
      operationId: getUsers
      x-micro-contracts-service: User
      x-micro-contracts-method: getUsers
      responses:
        '200':
          description: Success
components:
  schemas: {}
`);

      // Create config
      const config: MultiModuleConfig = {
        defaults: {
          contract: { output: path.join(tmpDir, 'packages/contract/{module}') },
          contractPublic: { output: path.join(tmpDir, 'packages/contract-published/{module}') },
        },
        modules: {
          core: { openapi: coreSpecPath },
          users: { openapi: usersSpecPath },
        },
      };

      // Generate only core module
      await generate(config, { skipLint: true, modules: 'core', contractsOnly: true });

      // Check that only core was generated
      expect(fs.existsSync(path.join(tmpDir, 'packages/contract/core/index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'packages/contract/users/index.ts'))).toBe(false);
    });

    it('should skip outputs with enabled: false', async () => {
      // Create spec
      const specPath = path.join(tmpDir, 'spec.yaml');
      fs.writeFileSync(specPath, `
openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths:
  /api/users:
    get:
      operationId: getUsers
      x-micro-contracts-service: User
      x-micro-contracts-method: getUsers
      responses:
        '200':
          description: Success
components:
  schemas: {}
`);

      // Create templates
      const serverTemplatePath = path.join(tmpDir, 'server.hbs');
      fs.writeFileSync(serverTemplatePath, `// Server routes for {{moduleName}}`);
      
      const frontendTemplatePath = path.join(tmpDir, 'frontend.hbs');
      fs.writeFileSync(frontendTemplatePath, `// Frontend client for {{moduleName}}`);

      // Create config with frontend disabled
      const config: MultiModuleConfig = {
        defaults: {
          contract: { output: path.join(tmpDir, 'packages/contract/{module}') },
          contractPublic: { output: path.join(tmpDir, 'packages/contract-published/{module}') },
          outputs: {
            'server-routes': {
              output: path.join(tmpDir, 'server/src/{module}/routes.generated.ts'),
              template: serverTemplatePath,
            },
            'frontend-api': {
              output: path.join(tmpDir, 'frontend/src/{module}/api.generated.ts'),
              template: frontendTemplatePath,
            },
          },
        },
        modules: {
          core: {
            openapi: specPath,
            outputs: {
              'frontend-api': {
                enabled: false,  // Disable frontend for this module
              },
            },
          },
        },
      };

      // Generate
      await generate(config, { skipLint: true });

      // Server routes should be generated
      const serverPath = path.join(tmpDir, 'server/src/core/routes.generated.ts');
      expect(fs.existsSync(serverPath)).toBe(true);
      
      // Frontend should NOT be generated (enabled: false)
      const frontendPath = path.join(tmpDir, 'frontend/src/core/api.generated.ts');
      expect(fs.existsSync(frontendPath)).toBe(false);
    });

    it('should skip legacy frontend with enabled: false', async () => {
      // Create spec
      const specPath = path.join(tmpDir, 'spec.yaml');
      fs.writeFileSync(specPath, `
openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths:
  /api/users:
    get:
      operationId: getUsers
      x-micro-contracts-service: User
      x-micro-contracts-method: getUsers
      responses:
        '200':
          description: Success
components:
  schemas: {}
`);

      // Create templates
      const serverTemplatePath = path.join(tmpDir, 'server.hbs');
      fs.writeFileSync(serverTemplatePath, `// Server routes`);
      
      const frontendTemplatePath = path.join(tmpDir, 'frontend.hbs');
      fs.writeFileSync(frontendTemplatePath, `// Frontend client`);

      // Create config with legacy frontend disabled
      const config: MultiModuleConfig = {
        defaults: {
          contract: { output: path.join(tmpDir, 'packages/contract/{module}') },
          contractPublic: { output: path.join(tmpDir, 'packages/contract-published/{module}') },
          server: {
            output: path.join(tmpDir, 'server/src/{module}/routes.generated.ts'),
            template: serverTemplatePath,
          },
          frontend: {
            output: path.join(tmpDir, 'frontend/src/{module}'),
            template: frontendTemplatePath,
            client: 'api.generated.ts',
            service: 'service.generated.ts',
          },
        },
        modules: {
          core: {
            openapi: specPath,
            frontend: {
              enabled: false,  // Disable frontend for this module
            },
          },
        },
      };

      // Generate
      await generate(config, { skipLint: true });

      // Server routes should be generated
      const serverPath = path.join(tmpDir, 'server/src/core/routes.generated.ts');
      expect(fs.existsSync(serverPath)).toBe(true);
      
      // Frontend should NOT be generated (enabled: false)
      const frontendPath = path.join(tmpDir, 'frontend/src/core/api.generated.ts');
      expect(fs.existsSync(frontendPath)).toBe(false);
    });

    it('should use custom service template when serviceTemplate is specified', async () => {
      const specPath = path.join(tmpDir, 'spec.yaml');
      fs.writeFileSync(specPath, `
openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths:
  /api/ai/chat/stream:
    post:
      operationId: postAiChatStream
      x-micro-contracts-service: Stream
      x-micro-contracts-method: postAiChatStream
      x-micro-contracts-sse: true
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ChatStreamRequest'
      responses:
        '204':
          description: SSE stream
  /api/users:
    get:
      operationId: getUsers
      x-micro-contracts-service: User
      x-micro-contracts-method: getUsers
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UserList'
components:
  schemas:
    ChatStreamRequest:
      type: object
      properties:
        message:
          type: string
    UserList:
      type: object
      properties:
        users:
          type: array
          items:
            type: object
`);

      const templatePath = path.join(tmpDir, 'service-interface-custom.hbs');
      fs.writeFileSync(templatePath, `/**
 * {{serviceName}} Service API Interface
 * Auto-generated from custom template
 * DO NOT EDIT MANUALLY
 */

import type {
{{#each imports}}
  {{this}},
{{/each}}
} from '../schemas/types.js';

export interface {{interfaceName}} {
{{#each methods}}
{{#if extensions.x-micro-contracts-sse}}
  {{name}}(input: {{inputType}}, req: FastifyRequest, reply: FastifyReply): Promise<void>;
{{else}}
  {{name}}(input: {{inputType}}): {{returnTypeStr}};
{{/if}}
{{/each}}
}
`);

      const config: MultiModuleConfig = {
        defaults: {
          contract: {
            output: path.join(tmpDir, 'packages/contract/{module}'),
            serviceTemplate: templatePath,
          },
          contractPublic: { output: path.join(tmpDir, 'packages/contract-published/{module}') },
        },
        modules: {
          aiChat: {
            openapi: specPath,
          },
        },
      };

      await generate(config, { skipLint: true, contractsOnly: true });

      // Stream service should use custom template with SSE extension
      const streamServicePath = path.join(tmpDir, 'packages/contract/aiChat/services/StreamServiceApi.ts');
      expect(fs.existsSync(streamServicePath)).toBe(true);
      const streamContent = fs.readFileSync(streamServicePath, 'utf-8');
      expect(streamContent).toContain('custom template');
      expect(streamContent).toContain('StreamServiceApi');
      expect(streamContent).toContain('FastifyRequest');
      expect(streamContent).toContain('FastifyReply');
      expect(streamContent).toContain('postAiChatStream(input: Stream_postAiChatStreamInput, req: FastifyRequest, reply: FastifyReply): Promise<void>;');

      // User service should use the else branch (no SSE)
      const userServicePath = path.join(tmpDir, 'packages/contract/aiChat/services/UserServiceApi.ts');
      expect(fs.existsSync(userServicePath)).toBe(true);
      const userContent = fs.readFileSync(userServicePath, 'utf-8');
      expect(userContent).toContain('UserServiceApi');
      expect(userContent).toContain('getUsers(input: User_getUsersInput): Promise<UserList>;');
      expect(userContent).not.toContain('FastifyRequest');

      // Index should still be generated (hardcoded, not from template)
      const indexPath = path.join(tmpDir, 'packages/contract/aiChat/services/index.ts');
      expect(fs.existsSync(indexPath)).toBe(true);
      const indexContent = fs.readFileSync(indexPath, 'utf-8');
      expect(indexContent).toContain('StreamServiceApi');
      expect(indexContent).toContain('UserServiceApi');
      expect(indexContent).toContain('ServiceRegistry');
    });

    it('should fall back to hardcoded generation when serviceTemplate is not specified', async () => {
      const specPath = path.join(tmpDir, 'spec.yaml');
      fs.writeFileSync(specPath, `
openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths:
  /api/users:
    get:
      operationId: getUsers
      x-micro-contracts-service: User
      x-micro-contracts-method: getUsers
      x-micro-contracts-sse: true
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UserList'
components:
  schemas:
    UserList:
      type: object
`);

      const config: MultiModuleConfig = {
        defaults: {
          contract: { output: path.join(tmpDir, 'packages/contract/{module}') },
          contractPublic: { output: path.join(tmpDir, 'packages/contract-published/{module}') },
        },
        modules: {
          core: {
            openapi: specPath,
          },
        },
      };

      await generate(config, { skipLint: true, contractsOnly: true });

      const servicePath = path.join(tmpDir, 'packages/contract/core/services/UserServiceApi.ts');
      expect(fs.existsSync(servicePath)).toBe(true);
      const content = fs.readFileSync(servicePath, 'utf-8');
      // Should use default hardcoded format (single input argument)
      expect(content).toContain('getUsers(input: User_getUsersInput): Promise<UserList>;');
      // Should NOT contain any framework-specific types (FastifyRequest etc.)
      expect(content).not.toContain('FastifyRequest');
    });

    it('should pass extensions to custom service template', async () => {
      const specPath = path.join(tmpDir, 'spec.yaml');
      fs.writeFileSync(specPath, `
openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths:
  /api/items:
    get:
      operationId: getItems
      x-micro-contracts-service: Item
      x-micro-contracts-method: getItems
      x-custom-cache: true
      x-custom-timeout: 5000
      parameters:
        - name: limit
          in: query
          required: false
          schema:
            type: integer
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ItemList'
components:
  schemas:
    ItemList:
      type: object
`);

      const templatePath = path.join(tmpDir, 'service-ext-test.hbs');
      fs.writeFileSync(templatePath, `import type {
{{#each imports}}
  {{this}},
{{/each}}
} from '../schemas/types.js';

export interface {{interfaceName}} {
{{#each methods}}
  // cache={{extensions.x-custom-cache}} timeout={{extensions.x-custom-timeout}} params={{parameters.length}}
  {{name}}(input: {{inputType}}): {{returnTypeStr}};
{{/each}}
}
`);

      const config: MultiModuleConfig = {
        defaults: {
          contract: {
            output: path.join(tmpDir, 'packages/contract/{module}'),
            serviceTemplate: templatePath,
          },
          contractPublic: { output: path.join(tmpDir, 'packages/contract-published/{module}') },
        },
        modules: {
          core: {
            openapi: specPath,
          },
        },
      };

      await generate(config, { skipLint: true, contractsOnly: true });

      const servicePath = path.join(tmpDir, 'packages/contract/core/services/ItemServiceApi.ts');
      expect(fs.existsSync(servicePath)).toBe(true);
      const content = fs.readFileSync(servicePath, 'utf-8');
      expect(content).toContain('cache=true');
      expect(content).toContain('timeout=5000');
      expect(content).toContain('params=1');
    });
  });

  describe('built-in server generation', () => {
    /** Spec + template + config as reported in issue #48. */
    function setupServerModule(serverOverrides: Record<string, unknown> = {}): MultiModuleConfig {
      const specPath = path.join(tmpDir, 'bff.openapi.json');
      fs.writeFileSync(specPath, JSON.stringify({
        openapi: '3.0.0',
        info: { title: 'BFF', version: '1.0.0' },
        paths: {
          '/settings': {
            get: {
              operationId: 'getSettings',
              'x-micro-contracts-service': 'Setting',
              'x-micro-contracts-method': 'list',
              responses: { '200': { description: 'ok' } },
            },
          },
        },
        components: { schemas: {} },
      }));

      const templatePath = path.join(tmpDir, 'route-manifest.hbs');
      fs.writeFileSync(templatePath, 'routes: {{routes.length}}\n');

      return {
        defaults: {
          contract: { output: path.join(tmpDir, 'contracts/{module}') },
          contractPublic: { output: path.join(tmpDir, 'contracts-published/{module}') },
        },
        modules: {
          bff: {
            openapi: specPath,
            server: {
              template: templatePath,
              output: path.join(tmpDir, 'contracts/bff/server/routes.generated.ts'),
              ...serverOverrides,
            },
          },
        },
      };
    }

    it('honors a module-level server.template and writes output as a file', async () => {
      const config = setupServerModule();

      await generate(config, { serverOnly: true });

      const routesPath = path.join(tmpDir, 'contracts/bff/server/routes.generated.ts');
      expect(fs.statSync(routesPath).isFile()).toBe(true);
      expect(fs.readFileSync(routesPath, 'utf-8')).toContain('routes: 1');
    });

    it('regenerates over an existing output file', async () => {
      const config = setupServerModule();

      await generate(config, { serverOnly: true });
      await generate(config, { serverOnly: true });

      const routesPath = path.join(tmpDir, 'contracts/bff/server/routes.generated.ts');
      expect(fs.readFileSync(routesPath, 'utf-8')).toContain('routes: 1');
    });

    it('leaves no directory behind when the template is missing', async () => {
      const config = setupServerModule({ template: undefined });

      await expect(generate(config, { serverOnly: true })).rejects.toThrow(/Server template is required/);

      expect(fs.existsSync(path.join(tmpDir, 'contracts/bff/server/routes.generated.ts'))).toBe(false);
    });

    it('does not require a frontend template when only server is declared', async () => {
      const config = setupServerModule();

      await expect(generate(config)).resolves.toBeUndefined();
      expect(fs.existsSync(path.join(tmpDir, 'frontend'))).toBe(false);
    });
  });

  describe('outputs generation', () => {
    /** Module with one working output, plus whatever overrides a test needs. */
    function setupOutputs(outputs: Record<string, Record<string, unknown>>): MultiModuleConfig {
      const specPath = path.join(tmpDir, 'spec.yaml');
      fs.writeFileSync(specPath, `
openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths:
  /api/users:
    get:
      operationId: getUsers
      x-micro-contracts-service: User
      x-micro-contracts-method: getUsers
      responses:
        '200':
          description: Success
components:
  schemas: {}
`);
      fs.writeFileSync(path.join(tmpDir, 'routes.hbs'), 'routes: {{routes.length}}');

      return {
        defaults: {
          contract: { output: path.join(tmpDir, 'contracts/{module}') },
          contractPublic: { output: path.join(tmpDir, 'contracts-published/{module}') },
          outputs: outputs as MultiModuleConfig['defaults'] extends { outputs?: infer O } ? O : never,
        },
        modules: { core: { openapi: specPath } },
      };
    }

    it('generates an output from its configured template', async () => {
      const config = setupOutputs({
        routes: { output: path.join(tmpDir, 'out/routes.generated.ts'), template: path.join(tmpDir, 'routes.hbs') },
      });

      await generate(config, {});

      expect(fs.readFileSync(path.join(tmpDir, 'out/routes.generated.ts'), 'utf-8')).toBe('routes: 1');
    });

    it('fails when a template cannot be rendered', async () => {
      fs.writeFileSync(path.join(tmpDir, 'broken.hbs'), '{{#each routes}}{{/wrongclose}}');
      const config = setupOutputs({
        broken: { output: path.join(tmpDir, 'out/broken.generated.ts'), template: path.join(tmpDir, 'broken.hbs') },
      });

      await expect(generate(config, {})).rejects.toThrow(/broken\.hbs.*for output 'broken'/s);
      expect(fs.existsSync(path.join(tmpDir, 'out/broken.generated.ts'))).toBe(false);
    });

    it('fails when a configured template does not exist', async () => {
      const config = setupOutputs({
        missing: { output: path.join(tmpDir, 'out/missing.generated.ts'), template: path.join(tmpDir, 'does-not-exist.hbs') },
      });

      await expect(generate(config, {})).rejects.toThrow(/Cannot load template .*does-not-exist\.hbs/);
    });

    it('uses the configured template path, not a same-named file under the spec directory', async () => {
      // A convention lookup by basename would pick up this decoy instead.
      const decoyDir = path.join(tmpDir, 'core', 'templates');
      fs.mkdirSync(decoyDir, { recursive: true });
      fs.writeFileSync(path.join(decoyDir, 'routes.hbs'), 'DECOY');

      const config = setupOutputs({
        routes: { output: path.join(tmpDir, 'out/routes.generated.ts'), template: path.join(tmpDir, 'routes.hbs') },
      });

      await generate(config, {});

      expect(fs.readFileSync(path.join(tmpDir, 'out/routes.generated.ts'), 'utf-8')).toBe('routes: 1');
    });

    it('fails instead of generating nothing when a flag matches no output', async () => {
      const config = setupOutputs({
        routes: { output: path.join(tmpDir, 'out/routes.generated.ts'), template: path.join(tmpDir, 'routes.hbs') },
      });

      // 'routes' contains neither 'server' nor 'frontend'/'client'.
      await expect(generate(config, { serverOnly: true })).rejects.toThrow(/No outputs matched/);
    });
  });

  describe('deps/ re-exports', () => {
    it('writes deps files under the configured contract output', async () => {
      const write = (name: string, service: string) => {
        const specPath = path.join(tmpDir, `${name}.yaml`);
        fs.writeFileSync(specPath, `
openapi: 3.0.3
info:
  title: ${name}
  version: 1.0.0
  x-micro-contracts-depend-on:
${name === 'billing' ? '    - core.User.getUsers' : '    []'}
paths:
  /${name}:
    get:
      operationId: get${service}
      x-micro-contracts-service: ${service}
      x-micro-contracts-method: getUsers
      responses:
        '200':
          description: Success
components:
  schemas: {}
`);
        return specPath;
      };

      const config: MultiModuleConfig = {
        defaults: {
          contract: { output: path.join(tmpDir, 'contracts/{module}') },
          contractPublic: { output: path.join(tmpDir, 'contracts-published/{module}') },
        },
        modules: {
          core: { openapi: write('core', 'User') },
          billing: { openapi: write('billing', 'Invoice') },
        },
      };

      await generate(config, { contractsOnly: true });

      const depsFile = path.join(tmpDir, 'contracts/billing/deps/core.ts');
      expect(fs.existsSync(depsFile)).toBe(true);
      // Import must reach the configured contract-published directory.
      const importPath = fs.readFileSync(depsFile, 'utf-8').match(/from '(.+)\/schemas\/types\.js'/)?.[1];
      expect(importPath).toBeDefined();
      expect(path.resolve(path.dirname(depsFile), importPath!))
        .toBe(path.resolve(path.join(tmpDir, 'contracts-published/core')));
    });
  });
});

