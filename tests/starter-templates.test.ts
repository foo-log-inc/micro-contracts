/**
 * Starter template tests
 *
 * The starter templates are what `micro-contracts init` writes to
 * spec/default/templates/. These tests render them from getStarterTemplates()
 * — the content init writes — and run the code they generate.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { generate } from '../src/generator/index.js';
import { getStarterTemplates } from '../src/cli/templates.js';
import type { MultiModuleConfig, OutputConfig } from '../src/types.js';

const REPO_ROOT = path.resolve(__dirname, '..');

describe('starter templates', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starter-templates-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Generate module `m` from `spec` (and `overlays`, by file name) with the
   * starter templates as init writes them, into tmpDir:
   * contract/m, server/{routes,overlayAdapter}.generated.ts,
   * server/{services,overlays}.stubs.ts and frontend/api.generated.ts.
   */
  async function generateProject(spec: string, overlays: Record<string, string> = {}): Promise<void> {
    const templatesDir = path.join(tmpDir, 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    for (const [file, content] of Object.entries(getStarterTemplates())) {
      fs.writeFileSync(path.join(templatesDir, file), content);
    }

    const specPath = path.join(tmpDir, 'spec.yaml');
    fs.writeFileSync(specPath, spec);
    const overlayPaths = Object.entries(overlays).map(([file, content]) => {
      const overlayPath = path.join(tmpDir, file);
      fs.writeFileSync(overlayPath, content);
      return overlayPath;
    });

    const output = (file: string, template: string, extra: Partial<OutputConfig> = {}): OutputConfig => ({
      output: path.join(tmpDir, file),
      template: path.join(templatesDir, template),
      config: { contractPackage: '../contract/{module}', servicesPath: 'fastify.services.{module}' },
      ...extra,
    });

    const config: MultiModuleConfig = {
      defaults: {
        contract: { output: path.join(tmpDir, 'contract/{module}') },
        contractPublic: { output: path.join(tmpDir, 'contract-published/{module}') },
        overlays: { shared: overlayPaths, collision: 'error' },
        outputs: {
          'server-routes': output('server/routes.generated.ts', 'fastify-routes.hbs'),
          'overlay-adapter': output('server/overlayAdapter.generated.ts', 'overlay-adapter.hbs', { condition: 'hasOverlays' }),
          'frontend-client': output('frontend/api.generated.ts', 'fetch-client.hbs'),
          'service-stubs': output('server/services.stubs.ts', 'service-stubs.hbs'),
          'overlay-stubs': output('server/overlays.stubs.ts', 'overlay-stubs.hbs', { condition: 'hasOverlays' }),
        },
      },
      modules: { m: { openapi: specPath } },
    };

    await generate(config);
  }

  /**
   * Type-check the generated project as a project using it would: the server
   * under NodeNext, with the Fastify decorations it registers, and the client
   * under a bundler's resolution. Returns tsc's diagnostics.
   */
  function typecheck(): string {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }));
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(tmpDir, 'node_modules'), 'dir');
    const overlays = fs.existsSync(path.join(tmpDir, 'contract/m/overlays'));
    fs.writeFileSync(path.join(tmpDir, 'server/fastify.d.ts'), [
      "import type { ServiceRegistry } from '../contract/m/services/index.js';",
      ...(overlays ? ["import type { OverlayRegistry } from '../contract/m/overlays/index.js';"] : []),
      "declare module 'fastify' {",
      '  interface FastifyInstance {',
      '    services: { m: ServiceRegistry };',
      ...(overlays ? ['    overlayHandlers: OverlayRegistry;'] : []),
      '  }',
      '}',
    ].join('\n'));
    fs.writeFileSync(path.join(tmpDir, 'frontend/env.d.ts'),
      'interface ImportMeta { readonly env?: Record<string, string | undefined> }\n');

    const common = { target: 'ES2022', lib: ['ES2022', 'DOM'], strict: true, noEmit: true, skipLibCheck: true };
    const projects = {
      'tsconfig.server.json': { compilerOptions: { ...common, module: 'NodeNext', moduleResolution: 'NodeNext' }, include: ['server', 'contract'] },
      'tsconfig.frontend.json': { compilerOptions: { ...common, module: 'ESNext', moduleResolution: 'bundler' }, include: ['frontend', 'contract'] },
    };

    let diagnostics = '';
    for (const [file, tsconfig] of Object.entries(projects)) {
      fs.writeFileSync(path.join(tmpDir, file), JSON.stringify(tsconfig));
      try {
        execFileSync(process.execPath, [path.join(REPO_ROOT, 'node_modules/typescript/bin/tsc'), '-p', file], {
          cwd: tmpDir, encoding: 'utf-8', stdio: 'pipe',
        });
      } catch (error) {
        diagnostics += (error as { stdout: string }).stdout;
      }
    }
    return diagnostics;
  }

  /** Register the generated routes on a Fastify instance with these services and overlay handlers. */
  async function serve(
    services: Record<string, Record<string, unknown>>,
    overlayHandlers?: Record<string, unknown>,
    options: FastifyServerOptions = {},
  ): Promise<FastifyInstance> {
    const { registerRoutes } = await import(path.join(tmpDir, 'server/routes.generated.ts'));
    const app = Fastify(options);
    app.decorate('services', { m: services });
    if (overlayHandlers) app.decorate('overlayHandlers', overlayHandlers);
    await registerRoutes(app);
    return app;
  }

  it('are exactly the templates in examples/spec/default/templates', () => {
    // The example project is generated with what init writes, so the code it
    // type-checks is the code every new project starts from.
    const examplesDir = path.join(REPO_ROOT, 'examples/spec/default/templates');
    const starter = getStarterTemplates();

    expect(fs.readdirSync(examplesDir).sort()).toEqual(Object.keys(starter).sort());
    for (const [file, content] of Object.entries(starter)) {
      expect(fs.readFileSync(path.join(examplesDir, file), 'utf-8'), file).toBe(content);
    }
  });

  describe('overlays', () => {
    const userSpec = `
openapi: 3.0.3
info: { title: Users, version: 1.0.0 }
paths:
  /users/{id}:
    get:
      operationId: getUser
      x-micro-contracts-service: User
      x-micro-contracts-method: getUser
      x-middleware: [requireAuth]
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { $ref: '#/components/schemas/User' } } }
components:
  schemas:
    User: { type: object, required: [id, name], properties: { id: { type: string }, name: { type: string } } }
`;

    const authOverlay = `
overlay: 1.0.0
info: { title: auth, version: 1.0.0 }
actions:
  - target: "$.paths[*][*][?(@.x-middleware contains 'requireAuth')]"
    update:
      parameters:
        - { name: Authorization, in: header, required: true, schema: { type: string } }
      responses:
        '401': { description: Unauthorized }
`;

    const userService = { getUser: async ({ id }: { id: string }) => ({ id, name: 'n' }) };

    it('refuse an operation whose overlay handler is not registered', async () => {
      await generateProject(userSpec, { 'auth.overlay.yaml': authOverlay });
      // requireAuth is not registered: the operation must not run without it.
      const app = await serve({ user: userService }, {});

      try {
        const res = await app.inject({ method: 'GET', url: '/users/ab', headers: { authorization: 'Bearer x' } });
        expect(res.statusCode).toBe(500);
        expect(res.json().message).toContain('"requireAuth"');
      } finally {
        await app.close();
      }
    });

    it('run the operation once its overlay handler admits the request', async () => {
      await generateProject(userSpec, { 'auth.overlay.yaml': authOverlay });
      const requireAuth = async (input: Record<string, unknown>) =>
        input.Authorization === 'Bearer x'
          ? { success: true }
          : { success: false, error: { status: 401, message: 'Unauthorized' } };
      const app = await serve({ user: userService }, { requireAuth });

      try {
        const denied = await app.inject({ method: 'GET', url: '/users/ab', headers: { authorization: 'Bearer y' } });
        expect(denied.statusCode).toBe(401);

        const admitted = await app.inject({ method: 'GET', url: '/users/ab', headers: { authorization: 'Bearer x' } });
        expect(admitted.statusCode).toBe(200);
        expect(admitted.json()).toEqual({ id: 'ab', name: 'n' });
      } finally {
        await app.close();
      }
    });

    it('read an in: cookie parameter from the Cookie header, never from a header of that name', async () => {
      await generateProject(userSpec, {
        'auth.overlay.yaml': `
overlay: 1.0.0
info: { title: auth, version: 1.0.0 }
actions:
  - target: "$.paths[*][*][?(@.x-middleware contains 'requireAuth')]"
    update:
      parameters:
        - { name: Authorization, in: header, required: true, schema: { type: string } }
        - { name: session, in: cookie, required: false, schema: { type: string } }
      responses:
        '401': { description: Unauthorized }
`,
      });
      const received: Array<Record<string, unknown>> = [];
      const requireAuth = async (input: Record<string, unknown>) => {
        received.push(input);
        return { success: true };
      };
      const app = await serve({ user: userService }, { requireAuth });

      try {
        await app.inject({
          method: 'GET', url: '/users/ab',
          headers: { authorization: 'Bearer x', cookie: 'theme=dark; session=s3cr3t%21' },
        });
        await app.inject({
          method: 'GET', url: '/users/ab',
          headers: { authorization: 'Bearer x', session: 'forged' },
        });
        expect(received).toEqual([
          { Authorization: 'Bearer x', session: 's3cr3t!' },
          { Authorization: 'Bearer x', session: undefined },
        ]);
      } finally {
        await app.close();
      }
    });

    it('generate handler stubs that implement the overlay registry', { timeout: 180_000 }, async () => {
      await generateProject(userSpec, {
        'auth.overlay.yaml': authOverlay,
        'audit.overlay.yaml': `
overlay: 1.0.0
info: { title: audit, version: 1.0.0 }
actions:
  - target: "$.paths[*][*]"
    x-micro-contracts-overlay-name: audit
    update:
      parameters:
        - { name: session, in: cookie, schema: { type: string } }
`,
      });

      const stubs = fs.readFileSync(path.join(tmpDir, 'server/overlays.stubs.ts'), 'utf-8');
      expect(stubs).toContain("'requireAuth': async (input: RequireAuthOverlayInput)");
      expect(stubs).toContain("'audit': async (input: AuditOverlayInput)");
      expect(typecheck()).toBe('');
    });

    it('generate overlay types, an adapter and stubs that type-check for an overlay named outside identifier syntax', { timeout: 180_000 }, async () => {
      await generateProject(userSpec.replace('x-middleware: [requireAuth]', 'x-middleware: [tenant-isolation]'), {
        'tenant.overlay.yaml': `
overlay: 1.0.0
info: { title: tenant, version: 1.0.0 }
actions:
  - target: "$.paths[*][*][?(@.x-middleware contains 'tenant-isolation')]"
    update:
      parameters:
        - { name: X-Tenant-Id, in: header, required: true, schema: { type: string } }
`,
      });

      expect(typecheck()).toBe('');
      const received: Array<Record<string, unknown>> = [];
      const app = await serve({ user: userService }, {
        'tenant-isolation': async (input: Record<string, unknown>) => { received.push(input); return { success: true }; },
      });
      try {
        const res = await app.inject({ method: 'GET', url: '/users/ab', headers: { 'x-tenant-id': 't1' } });
        expect(res.statusCode).toBe(200);
        expect(received).toEqual([{ 'X-Tenant-Id': 't1' }]);
      } finally {
        await app.close();
      }
    });

    it('generate an adapter that type-checks for a module with a single overlay', { timeout: 180_000 }, async () => {
      await generateProject(userSpec, { 'auth.overlay.yaml': authOverlay });
      expect(typecheck()).toBe('');
    });

    it('refuse a request without a required overlay parameter before the overlay runs', async () => {
      await generateProject(userSpec, {
        'session.overlay.yaml': `
overlay: 1.0.0
info: { title: session, version: 1.0.0 }
actions:
  - target: "$.paths[*][*][?(@.x-middleware contains 'requireAuth')]"
    update:
      parameters:
        - { name: session, in: cookie, required: true, schema: { type: string } }
`,
      });
      const received: Array<Record<string, unknown>> = [];
      const served: unknown[] = [];
      const requireAuth = async (input: Record<string, unknown>) => { received.push(input); return { success: true }; };
      const app = await serve({ user: { getUser: async (input: unknown) => { served.push(input); return { id: 'ab', name: 'n' }; } } }, { requireAuth });

      try {
        // The route validates the parameter the overlay injected into the operation
        const refused = await app.inject({ method: 'GET', url: '/users/ab' });
        expect(refused.statusCode).toBe(400);
        expect(refused.json().message).toContain('session');
        expect([received, served]).toEqual([[], []]);

        const admitted = await app.inject({ method: 'GET', url: '/users/ab', headers: { cookie: 'session=s1' } });
        expect(admitted.statusCode).toBe(200);
        expect(received).toEqual([{ session: 's1' }]);
      } finally {
        await app.close();
      }

      // The adapter refuses it as well, for a route that hands it a request unvalidated
      const { runOverlays } = await import(path.join(tmpDir, 'server/overlayAdapter.generated.ts'));
      const outcome = await runOverlays('getUser', { requireAuth }, {
        headers: {}, params: { id: 'ab' }, query: {}, cookies: new Map(), body: undefined,
      });
      expect(outcome).toMatchObject({ success: false, error: { status: 400, title: expect.stringContaining('session') } });
      expect(received).toHaveLength(1);
    });

    it('fail generation on an overlay parameter in a location requests do not have', async () => {
      await expect(generateProject(userSpec, {
        'auth.overlay.yaml': `
overlay: 1.0.0
info: { title: auth, version: 1.0.0 }
actions:
  - target: "$.paths[*][*][?(@.x-middleware contains 'requireAuth')]"
    update:
      parameters:
        - { name: token, in: body, schema: { type: string } }
`,
      })).rejects.toThrow(/'token'.*'body'/);
    });
  });

  describe('success responses', () => {
    const orderSpec = `
openapi: 3.0.3
info: { title: Orders, version: 1.0.0 }
paths:
  /orders:
    post:
      operationId: createOrder
      x-micro-contracts-service: Order
      x-micro-contracts-method: createOrder
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/CreateOrder' } } }
      responses:
        '201':
          description: created
          content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } }
  /orders/{id}:
    parameters:
      - { name: id, in: path, required: true, schema: { type: string } }
    get:
      operationId: getOrder
      x-micro-contracts-service: Order
      x-micro-contracts-method: getOrder
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } }
    delete:
      operationId: deleteOrder
      x-micro-contracts-service: Order
      x-micro-contracts-method: deleteOrder
      responses:
        '204': { description: deleted }
  /stats:
    get:
      operationId: getStats
      x-micro-contracts-service: Order
      x-micro-contracts-method: getStats
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                required: [count]
                properties:
                  count: { type: integer }
  /jobs:
    post:
      operationId: startJob
      x-micro-contracts-service: Order
      x-micro-contracts-method: startJob
      responses:
        '202':
          description: accepted
          content: { application/json: { schema: { $ref: '#/components/schemas/Job' } } }
  /things:
    get:
      operationId: listThings
      x-micro-contracts-service: Order
      x-micro-contracts-method: listThings
      responses:
        '2XX':
          description: ok
          content: { application/json: { schema: { $ref: '#/components/schemas/Things' } } }
        '400':
          description: bad
          content: { application/json: { schema: { $ref: '#/components/schemas/Problem' } } }
components:
  schemas:
    CreateOrder: { type: object, required: [qty], properties: { qty: { type: integer } } }
    Order: { type: object, properties: { id: { type: string } } }
    Job: { type: object, properties: { id: { type: string } } }
    Things: { type: object, properties: { items: { type: array, items: { type: string } } } }
    Problem: { type: object, properties: { title: { type: string } } }
`;

    it('answer with the declared status, the body shaped by the schema declared for it', async () => {
      await generateProject(orderSpec);
      const app = await serve({
        order: {
          createOrder: async () => ({ id: 'o1', internalNote: 'not in the contract' }),
          getOrder: async () => { throw Object.assign(new Error('no such order'), { statusCode: 404 }); },
          deleteOrder: async () => ({ internalNote: 'not in the contract' }),
          getStats: async () => ({ count: 3, internalNote: 'not in the contract' }),
          startJob: async () => ({ id: 'j1', internalNote: 'not in the contract' }),
          listThings: async () => ({ items: ['a'], internalNote: 'not in the contract' }),
        },
      });

      try {
        const answers = [];
        for (const [method, url, payload] of [
          ['POST', '/orders', { qty: 1 }],
          ['GET', '/orders/o1', undefined],
          ['DELETE', '/orders/o1', undefined],
          ['GET', '/stats', undefined],
          ['POST', '/jobs', undefined],
          ['GET', '/things', undefined],
        ] as const) {
          const res = await app.inject({ method, url, payload });
          answers.push([`${method} ${url}`, res.statusCode, res.statusCode < 300 ? res.body : undefined]);
        }
        expect(answers).toEqual([
          ['POST /orders', 201, '{"id":"o1"}'],
          ['GET /orders/o1', 404, undefined],
          ['DELETE /orders/o1', 204, ''],
          ['GET /stats', 200, '{"count":3}'],
          ['POST /jobs', 202, '{"id":"j1"}'],
          ['GET /things', 200, '{"items":["a"]}'],
        ]);
      } finally {
        await app.close();
      }
    });

    it('generate routes and a client that type-check against the service interfaces', { timeout: 180_000 }, async () => {
      await generateProject(orderSpec);
      expect(typecheck()).toBe('');
    });

    it('generate service stubs that implement the service interfaces', { timeout: 180_000 }, async () => {
      await generateProject(orderSpec.replace('x-micro-contracts-service: Order\n      x-micro-contracts-method: getStats', 'x-micro-contracts-service: Stats\n      x-micro-contracts-method: getStats'));

      const stubs = fs.readFileSync(path.join(tmpDir, 'server/services.stubs.ts'), 'utf-8');
      expect(stubs).toContain('export class OrderService implements OrderServiceApi {');
      expect(stubs).toContain('export class StatsService implements StatsServiceApi {');
      expect(typecheck()).toBe('');
    });
  });

  describe('request validation', () => {
    it('reads the cookie parameters an operation declares, validated, into the service input', { timeout: 180_000 }, async () => {
      await generateProject(`
openapi: 3.0.3
info: { title: T, version: 1.0.0 }
paths:
  /cart:
    get:
      operationId: getCart
      x-micro-contracts-service: Cart
      x-micro-contracts-method: getCart
      parameters:
        - { name: cart_id, in: cookie, required: true, schema: { type: string, minLength: 2 } }
        - { name: page, in: cookie, required: false, schema: { type: integer } }
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { type: object, properties: { ok: { type: boolean } } } } }
`);
      const served: unknown[] = [];
      const app = await serve({ cart: { getCart: async (input: unknown) => { served.push(input); return { ok: true }; } } });

      try {
        const statuses = [];
        for (const cookie of [undefined, 'cart_id=c', 'cart_id=c1; page=x', 'theme=dark; cart_id=c1; page=3', 'cart_id=c2']) {
          statuses.push((await app.inject({ method: 'GET', url: '/cart', headers: cookie ? { cookie } : {} })).statusCode);
        }
        expect(statuses).toEqual([400, 400, 400, 200, 200]);
        expect(served).toEqual([{ cart_id: 'c1', page: 3 }, { cart_id: 'c2' }]);

        // The error handler receives a cookie validation error as it receives Fastify's own
        const missing = await app.inject({ method: 'GET', url: '/cart' });
        expect(missing.json()).toEqual({
          statusCode: 400, code: 'FST_ERR_VALIDATION', error: 'Bad Request',
          message: "cookies must have required property 'cart_id'",
        });
      } finally {
        await app.close();
      }
      expect(typecheck()).toBe('');
    });


    it('refuses a request without a required header the operation declares, before the service', { timeout: 180_000 }, async () => {
      await generateProject(`
openapi: 3.0.3
info: { title: T, version: 1.0.0 }
paths:
  /reports:
    get:
      operationId: getReport
      x-micro-contracts-service: Report
      x-micro-contracts-method: getReport
      parameters:
        - { name: X-Tenant-Id, in: header, required: true, schema: { type: string, format: uuid } }
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { type: object, properties: { ok: { type: boolean } } } } }
`);
      const served: unknown[] = [];
      const app = await serve({ report: { getReport: async (input: unknown) => { served.push(input); return { ok: true }; } } });
      const tenant = '3f0e4f5e-1111-4222-8333-444455556666';

      try {
        const statuses = [];
        for (const headers of [{}, { 'X-Tenant-Id': 'tenant-1' }, { 'X-Tenant-Id': tenant }, { 'x-tenant-id': tenant }]) {
          statuses.push((await app.inject({ method: 'GET', url: '/reports', headers })).statusCode);
        }
        expect(statuses).toEqual([400, 400, 200, 200]);
        expect(served).toHaveLength(2);
      } finally {
        await app.close();
      }
      expect(typecheck()).toBe('');
    });

    it('accepts every oneOf member, tagged or not, unchanged, with the validator options the README gives', async () => {
      await generateProject(`
openapi: 3.0.3
info: { title: T, version: 1.0.0 }
paths:
  /messages:
    post:
      operationId: postMessage
      x-micro-contracts-service: Msg
      x-micro-contracts-method: postMessage
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/Message' } } }
      responses:
        '200': { description: ok }
  /notes:
    post:
      operationId: postNote
      x-micro-contracts-service: Msg
      x-micro-contracts-method: postNote
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/Note' } } }
      responses:
        '200': { description: ok }
  /plain:
    post:
      operationId: postPlain
      x-micro-contracts-service: Msg
      x-micro-contracts-method: postPlain
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/Plain' } } }
      responses:
        '200': { description: ok }
components:
  schemas:
    Ping:
      type: object
      additionalProperties: false
      required: [kind]
      properties: { kind: { type: string, enum: [ping] } }
    Text:
      type: object
      additionalProperties: false
      required: [kind, text]
      properties: { kind: { type: string, enum: [text] }, text: { type: string } }
    TextOptional:
      type: object
      additionalProperties: false
      required: [kind]
      properties: { kind: { type: string, enum: [text] }, text: { type: string } }
    Message:
      oneOf: [ { $ref: '#/components/schemas/Ping' }, { $ref: '#/components/schemas/Text' } ]
      discriminator: { propertyName: kind }
    Note:
      oneOf: [ { $ref: '#/components/schemas/Ping' }, { $ref: '#/components/schemas/TextOptional' } ]
      discriminator: { propertyName: kind }
    Plain:
      oneOf: [ { $ref: '#/components/schemas/Ping' }, { $ref: '#/components/schemas/TextOptional' } ]
`);
      const received: unknown[] = [];
      const record = async (input: unknown) => { received.push(input); };
      // README, Validators: Fastify's default validator options, with removeAdditional: false
      const app = await serve(
        { msg: { postMessage: record, postNote: record, postPlain: record } },
        undefined,
        { ajv: { customOptions: { removeAdditional: false } } },
      );

      try {
        const statuses = [];
        for (const url of ['/messages', '/notes', '/plain']) {
          for (const payload of [{ kind: 'text', text: 'hello' }, { kind: 'ping' }]) {
            statuses.push((await app.inject({ method: 'POST', url, payload })).statusCode);
          }
        }
        expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
        expect(received).toEqual([
          { data: { kind: 'text', text: 'hello' } }, { data: { kind: 'ping' } },
          { data: { kind: 'text', text: 'hello' } }, { data: { kind: 'ping' } },
          { data: { kind: 'text', text: 'hello' } }, { data: { kind: 'ping' } },
        ]);

        const invalid = await app.inject({ method: 'POST', url: '/messages', payload: { kind: 'nope' } });
        expect(invalid.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });
  });

  describe('error responses', () => {
    const itemSpec = (errorKey: string) => `
openapi: 3.0.3
info: { title: T, version: 1.0.0 }
paths:
  /items/{id}:
    get:
      operationId: getItem
      x-micro-contracts-service: Item
      x-micro-contracts-method: getItem
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      responses:
        '200':
          description: ok
          content: { application/json: { schema: { $ref: '#/components/schemas/Item' } } }
        '${errorKey}':
          description: failed
          content: { application/json: { schema: { $ref: '#/components/schemas/ProblemDetails' } } }
components:
  schemas:
    Item: { type: object, properties: { id: { type: integer } } }
    ProblemDetails:
      type: object
      required: [type, title, status]
      properties:
        type: { type: string }
        title: { type: string }
        status: { type: integer }
        detail: { type: string }
`;

    /** Serve getItem, failing with 404 for id 404, behind an error handler that copies an internal field into the body. */
    async function serveItems(): Promise<FastifyInstance> {
      const { registerRoutes } = await import(path.join(tmpDir, 'server/routes.generated.ts'));
      const app = Fastify();
      app.decorate('services', { m: { item: { getItem: async ({ id }: { id: number }) => {
        if (id === 404) throw Object.assign(new Error('not found'), { statusCode: 404, dbQuery: 'SELECT * FROM secrets' });
        return { id };
      } } } });
      app.setErrorHandler((error: Error & { statusCode?: number; dbQuery?: string }, _req, reply) => {
        const status = error.statusCode ?? 500;
        reply.status(status).send({ type: 'about:blank', title: error.message, status, dbQuery: error.dbQuery });
      });
      await registerRoutes(app);
      return app;
    }

    it.each(['404', '4XX'])('shape an error body by the schema declared under %s', { timeout: 180_000 }, async (errorKey) => {
      await generateProject(itemSpec(errorKey));
      const app = await serveItems();
      try {
        const res = await app.inject({ method: 'GET', url: '/items/404' });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({ type: 'about:blank', title: 'not found', status: 404 });
      } finally {
        await app.close();
      }
      expect(typecheck()).toBe('');
    });
  });

  it('reach a service named ...Service under its ServiceRegistry key', { timeout: 180_000 }, async () => {
    await generateProject(`
openapi: 3.0.3
info: { title: T, version: 1.0.0 }
paths:
  /users:
    get:
      operationId: listUsers
      x-micro-contracts-service: UserService
      x-micro-contracts-method: listUsers
      responses:
        '200': { description: ok, content: { application/json: { schema: { type: object, properties: { n: { type: integer } } } } } }
`);
    expect(fs.readFileSync(path.join(tmpDir, 'contract/m/services/index.ts'), 'utf-8')).toContain('  user: UserServiceServiceApi;');
    const app = await serve({ user: { listUsers: async () => ({ n: 1 }) } });
    try {
      const res = await app.inject({ method: 'GET', url: '/users' });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
    expect(typecheck()).toBe('');
  });

  describe('stream responses', () => {
    const chatSpec = `
openapi: 3.0.3
info: { title: Chat, version: 1.0.0 }
paths:
  /chat:
    post:
      operationId: chat
      x-micro-contracts-service: Chat
      x-micro-contracts-method: chat
      requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/ChatRequest' } } } }
      responses:
        '200':
          description: events
          content:
            text/event-stream:
              x-stream-event:
                oneOf: [ { $ref: '#/components/schemas/TextDelta' }, { $ref: '#/components/schemas/StreamEnd' } ]
                discriminator: { propertyName: type }
  /lines:
    get:
      operationId: lines
      x-micro-contracts-service: Chat
      x-micro-contracts-method: lines
      responses:
        '200':
          description: events
          content:
            application/x-ndjson:
              x-stream-event: { $ref: '#/components/schemas/ChatEvent' }
components:
  schemas:
    ChatRequest: { type: object, required: [prompt], properties: { prompt: { type: string } } }
    TextDelta: { type: object, required: [type, text], properties: { type: { type: string, enum: [text] }, text: { type: string } } }
    StreamEnd: { type: object, required: [type], properties: { type: { type: string, enum: [end] } } }
    ChatEvent:
      oneOf: [ { $ref: '#/components/schemas/TextDelta' }, { $ref: '#/components/schemas/StreamEnd' } ]
      discriminator: { propertyName: type }
`;

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    /** The services closed, by prompt: an iterator's finally block ran. */
    let closed: string[];
    const chatService = {
      async *chat({ data }: { data: { prompt: string } }) {
        try {
          if (data.prompt === 'fail') throw Object.assign(new Error('unavailable'), { statusCode: 503 });
          for (const text of data.prompt.split(' ')) {
            yield { type: 'text', text, internalNote: 'not in the contract' };
            await sleep(50);
          }
          if (data.prompt.startsWith('bad')) yield { type: 'nope' };
          while (data.prompt.startsWith('slow')) {
            yield { type: 'text', text: '.' };
            await sleep(50);
          }
          yield { type: 'end' };
        } finally {
          closed.push(data.prompt);
        }
      },
      async *lines() {
        yield { type: 'text', text: 'a', internalNote: 'not in the contract' };
        yield { type: 'end' };
      },
    };

    /**
     * Serve the chat spec on a port; returns its base URL. Closing the server
     * closes every connection: the client opens a spare one after an abort.
     */
    async function listen(): Promise<{ app: FastifyInstance; base: string }> {
      await generateProject(chatSpec);
      const app = await serve({ chat: chatService }, undefined, { forceCloseConnections: true });
      await app.listen({ port: 0, host: '127.0.0.1' });
      return { app, base: `http://127.0.0.1:${(app.server.address() as { port: number }).port}` };
    }

    /** The body's chunks as they arrive, and how reading ended. */
    async function chunks(res: Response): Promise<{ received: string[]; ended: 'done' | 'aborted' }> {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const received: string[] = [];
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return { received, ended: 'done' };
          received.push(decoder.decode(value));
        }
      } catch {
        return { received, ended: 'aborted' };
      }
    }

    const chat = (base: string, prompt: string, init: RequestInit = {}) => fetch(`${base}/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }), ...init,
    });

    beforeEach(() => {
      closed = [];
    });

    it('send each event as an SSE frame as the service yields it, shaped by the event schema', async () => {
      const { app, base } = await listen();
      try {
        const res = await chat(base, 'hello world');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/event-stream');
        const { received, ended } = await chunks(res);
        expect(ended).toBe('done');
        // The first frame arrives on its own, before the service yields the next event
        expect(received[0]).toBe('event: text\ndata: {"type":"text","text":"hello"}\n\n');
        expect(received.join('')).toBe(
          'event: text\ndata: {"type":"text","text":"hello"}\n\n' +
          'event: text\ndata: {"type":"text","text":"world"}\n\n' +
          'event: end\ndata: {"type":"end"}\n\n'
        );
      } finally {
        await app.close();
      }
    });

    it('send each event as an NDJSON line', async () => {
      const { app, base } = await listen();
      try {
        const res = await fetch(`${base}/lines`);
        expect(res.headers.get('content-type')).toBe('application/x-ndjson');
        expect(await res.text()).toBe('{"type":"text","text":"a"}\n{"type":"end"}\n');
      } finally {
        await app.close();
      }
    });

    it('end the stream at an event the contract does not declare, and close the service', async () => {
      const { app, base } = await listen();
      try {
        const { received, ended } = await chunks(await chat(base, 'bad one'));
        expect(ended).toBe('aborted');
        expect(received.join('')).toBe(
          'event: text\ndata: {"type":"text","text":"bad"}\n\n' +
          'event: text\ndata: {"type":"text","text":"one"}\n\n'
        );
        await vi.waitFor(() => expect(closed).toContain('bad one'));
      } finally {
        await app.close();
      }
    });

    it('close the service when the client goes away', async () => {
      const { app, base } = await listen();
      try {
        const abort = new AbortController();
        const res = await chat(base, 'slow', { signal: abort.signal });
        await res.body!.getReader().read();
        abort.abort();
        await vi.waitFor(() => expect(closed).toEqual(['slow']));
      } finally {
        await app.close();
      }
    });

    it('fail before the first event through the error handler, as a JSON operation does', async () => {
      const { app, base } = await listen();
      try {
        const res = await chat(base, 'fail');
        expect(res.status).toBe(503);
        expect(res.headers.get('content-type')).toContain('application/json');
        expect(await res.json()).toMatchObject({ statusCode: 503, message: 'unavailable' });
      } finally {
        await app.close();
      }
    });

    it('deliver the events to the generated client as a typed AsyncIterable', async () => {
      const { app, base } = await listen();
      vi.stubEnv('VITE_API_BASE_URL', base);
      try {
        const { chatApi } = await import(path.join(tmpDir, 'frontend/api.generated.ts'));
        const events: unknown[] = [];
        for await (const event of chatApi.chat({ data: { prompt: 'hello world' } })) events.push(event);
        expect(events).toEqual([{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }, { type: 'end' }]);

        const lines: unknown[] = [];
        for await (const event of chatApi.lines({})) lines.push(event);
        expect(lines).toEqual([{ type: 'text', text: 'a' }, { type: 'end' }]);
      } finally {
        vi.unstubAllEnvs();
        await app.close();
      }
    });

    it('generate routes, a client and stubs that type-check', { timeout: 180_000 }, async () => {
      await generateProject(chatSpec);
      expect(typecheck()).toBe('');
    });
  });
});
