/**
 * Starter template tests
 *
 * The starter templates are what `micro-contracts init` writes to
 * spec/default/templates/ (the Lambda handler's with --lambda). These tests
 * render them from getStarterTemplates() and getLambdaStarterTemplates() — the
 * content init writes — and run the code they generate.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { Writable } from 'stream';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { generate } from '../src/generator/index.js';
import { getStarterTemplates, getLambdaStarterTemplates } from '../src/cli/templates.js';
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
   * contract/m, server/{routes,overlayAdapter,lambda}.generated.ts,
   * server/{services,overlays}.stubs.ts and frontend/api.generated.ts. The
   * project resolves packages from this repository's node_modules.
   */
  async function generateProject(spec: string, overlays: Record<string, string> = {}): Promise<void> {
    const templatesDir = path.join(tmpDir, 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    for (const [file, content] of Object.entries({ ...getStarterTemplates(), ...getLambdaStarterTemplates() })) {
      fs.writeFileSync(path.join(templatesDir, file), content);
    }
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(tmpDir, 'node_modules'), 'dir');

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
          'lambda-routes': output('server/lambda.generated.ts', 'lambda-routes.hbs'),
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
    // The example project is generated with what init --lambda writes, so the
    // code it type-checks is the code every new project starts from.
    const examplesDir = path.join(REPO_ROOT, 'examples/spec/default/templates');
    const starter = { ...getStarterTemplates(), ...getLambdaStarterTemplates() };

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

  describe('lambda handler', () => {
    // /items/{id} comes before /items/latest: the literal segment must still win
    const shopSpec = `
openapi: 3.0.3
info: { title: Shop, version: 1.0.0 }
paths:
  /items/{id}:
    get:
      operationId: getItem
      x-micro-contracts-service: Item
      x-micro-contracts-method: getItem
      x-middleware: [requireAuth]
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
        - { name: fields, in: query, required: false, schema: { type: string } }
        - { name: X-Tenant-Id, in: header, required: true, schema: { type: string, format: uuid } }
        - { name: cart_id, in: cookie, required: true, schema: { type: string, minLength: 2 } }
      responses:
        '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Item' } } } }
        '404': { description: missing, content: { application/json: { schema: { $ref: '#/components/schemas/ProblemDetails' } } } }
    delete:
      operationId: deleteItem
      x-micro-contracts-service: Item
      x-micro-contracts-method: deleteItem
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      responses:
        '204': { description: deleted }
  /items/latest:
    get:
      operationId: latestItem
      x-micro-contracts-service: Item
      x-micro-contracts-method: latestItem
      responses:
        '200': { description: ok, content: { application/json: { schema: { $ref: '#/components/schemas/Item' } } } }
  /items:
    post:
      operationId: createItem
      x-micro-contracts-service: Item
      x-micro-contracts-method: createItem
      requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/NewItem' } } } }
      responses:
        '201': { description: created, content: { application/json: { schema: { $ref: '#/components/schemas/Item' } } } }
        '4XX': { description: refused, content: { application/json: { schema: { $ref: '#/components/schemas/ProblemDetails' } } } }
  /items/{id}/events:
    get:
      operationId: watchItem
      x-micro-contracts-service: Item
      x-micro-contracts-method: watchItem
      parameters:
        - { name: id, in: path, required: true, schema: { type: integer } }
      responses:
        '200':
          description: events
          content:
            text/event-stream:
              x-stream-event:
                oneOf: [ { $ref: '#/components/schemas/Changed' }, { $ref: '#/components/schemas/Removed' } ]
                discriminator: { propertyName: type }
components:
  schemas:
    NewItem: { type: object, required: [name], properties: { name: { type: string, minLength: 1 }, qty: { type: integer } } }
    Item: { type: object, required: [id, name], properties: { id: { type: integer }, name: { type: string } } }
    Changed: { type: object, required: [type, qty], properties: { type: { type: string, enum: [changed] }, qty: { type: integer } } }
    Removed: { type: object, required: [type], properties: { type: { type: string, enum: [removed] } } }
    ProblemDetails:
      type: object
      required: [type, title, status]
      properties:
        type: { type: string }
        title: { type: string }
        status: { type: integer }
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

    const TENANT = '3f0e4f5e-1111-4222-8333-444455556666';
    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    /** The inputs the services were called with, and the stream services closed, by id */
    let calls: unknown[];
    let closed: number[];
    /** What the stream service did, in order, with what the response stream received */
    let log: string[];

    const itemService = {
      async getItem(input: { id: number }) {
        calls.push(input);
        if (input.id === 404) throw Object.assign(new Error('not found'), { statusCode: 404 });
        if (input.id === 500) throw new Error('database down');
        return { id: input.id, name: 'n', secret: 'not in the contract' };
      },
      async deleteItem(input: unknown) {
        calls.push(input);
      },
      async latestItem() {
        return { id: 0, name: 'latest' };
      },
      async createItem(input: { data: { name: string } }) {
        calls.push(input);
        return { id: 1, name: input.data.name };
      },
      async *watchItem({ id }: { id: number }) {
        try {
          if (id === 503) throw Object.assign(new Error('unavailable'), { statusCode: 503 });
          log.push('produce 1');
          yield { type: 'changed', qty: 1, internalNote: 'not in the contract' };
          await sleep(50);
          log.push('produce 2');
          yield { type: 'changed', qty: 2 };
          while (id === 2) {
            await sleep(20);
            yield { type: 'changed', qty: 0 };
          }
          yield { type: 'removed' };
        } finally {
          closed.push(id);
        }
      },
    };

    const requireAuth = async (input: Record<string, unknown>) =>
      input.Authorization === 'Bearer x'
        ? { success: true }
        : { success: false, error: { status: 401, message: 'Unauthorized', code: 'UNAUTHORIZED' } };

    /** A synthetic API Gateway HTTP API (payload 2.0) event */
    const event = (method: string, rawPath: string, parts: Record<string, unknown> = {}) => ({
      rawPath, rawQueryString: '', headers: {}, isBase64Encoded: false, requestContext: { http: { method } }, ...parts,
    });

    /** getItem's event, carrying everything the operation requires */
    const getItem = (id: string, parts: Record<string, unknown> = {}) => event('GET', `/items/${id}`, {
      headers: { authorization: 'Bearer x', 'x-tenant-id': TENANT }, cookies: ['theme=dark', 'cart_id=c1'], ...parts,
    });

    /** Generate the shop project and create its buffered handler */
    async function handler(options: { basePath?: string } = {}) {
      await generateProject(shopSpec, { 'auth.overlay.yaml': authOverlay });
      const { createHandler } = await import(path.join(tmpDir, 'server/lambda.generated.ts'));
      return createHandler({ services: { item: itemService }, overlays: { requireAuth }, ...options });
    }

    const problem = (status: number, title: string, type = '/errors/error') => JSON.stringify({ type, title, status });

    beforeEach(() => {
      calls = [];
      closed = [];
      log = [];
    });

    it('route each event to its operation, answering with its success status and the body its schema shapes', { timeout: 180_000 }, async () => {
      const handle = await handler();

      expect(await handle(getItem('7', { rawQueryString: 'fields=name' }))).toEqual({
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: '{"id":7,"name":"n"}',
      });
      expect(calls).toEqual([{ id: 7, fields: 'name', cart_id: 'c1' }]);

      expect((await handle(event('GET', '/items/latest'))).body).toBe('{"id":0,"name":"latest"}');
      expect(await handle(event('DELETE', '/items/7'))).toEqual({ statusCode: 204, headers: {}, body: '' });

      const created = await handle(event('POST', '/items', {
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify({ name: 'pen', qty: 2 })).toString('base64'),
        isBase64Encoded: true,
      }));
      expect(created).toEqual({ statusCode: 201, headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{"id":1,"name":"pen"}' });
      expect(calls.at(-1)).toEqual({ data: { name: 'pen', qty: 2 } });

      expect(typecheck()).toBe('');
    });

    it('answer a path no route has with 404, and another method of a route\'s path with 405 and Allow', async () => {
      const handle = await handler();
      expect(await handle(event('GET', '/nope'))).toEqual({
        statusCode: 404, headers: { 'content-type': 'application/json; charset=utf-8' }, body: problem(404, 'Route GET:/nope not found'),
      });
      const notAllowed = await handle(event('PUT', '/items/7'));
      expect(notAllowed.statusCode).toBe(405);
      expect(notAllowed.headers.allow).toBe('GET, DELETE');
    });

    it('route under a base path, and nothing outside it', async () => {
      const handle = await handler({ basePath: '/prod' });
      expect((await handle(event('GET', '/prod/items/latest'))).statusCode).toBe(200);
      expect((await handle(event('GET', '/items/latest'))).statusCode).toBe(404);
      expect((await handle(event('GET', '/production/items/latest'))).statusCode).toBe(404);
    });

    it('answer a request its schemas refuse with 400, worded as Fastify words it, before the service', async () => {
      const handle = await handler();
      const json = { 'content-type': 'application/json' };
      const refused = [
        [getItem('abc'), 'params/id must be integer'],
        [getItem('7', { rawQueryString: 'fields=a&fields=b' }), 'querystring/fields must be string'],
        [getItem('7', { headers: { authorization: 'Bearer x' } }), "headers must have required property 'x-tenant-id'"],
        [getItem('7', { headers: { authorization: 'Bearer x', 'x-tenant-id': 'tenant-1' } }), 'headers/x-tenant-id must match format "uuid"'],
        [getItem('7', { cookies: ['theme=dark'] }), "cookies must have required property 'cart_id'"],
        [getItem('7', { cookies: ['cart_id=c'] }), 'cookies/cart_id must NOT have fewer than 2 characters'],
        [event('POST', '/items', { headers: json, body: '{"qty":1}' }), "body must have required property 'name'"],
        [event('POST', '/items', { headers: json, body: '{"name":' }), "Body is not valid JSON but content-type is set to 'application/json'"],
        [event('POST', '/items', { headers: json, body: '{"name":"a","__proto__":{"admin":true}}' }), 'Object contains forbidden prototype property'],
        [event('POST', '/items'), 'body must be object'],
      ] as const;
      for (const [request, title] of refused) {
        const res = await handle(request);
        expect({ statusCode: res.statusCode, body: res.body }).toEqual({ statusCode: 400, body: problem(400, title) });
      }
      const unsupported = await handle(event('POST', '/items', { headers: { 'content-type': 'text/plain' }, body: 'pen' }));
      expect(unsupported.statusCode).toBe(415);
      expect(calls).toEqual([]);
    });

    it('run the operation\'s overlays, answering a refusal as the contract\'s error shape', async () => {
      const handle = await handler();
      const refused = await handle(getItem('7', { headers: { authorization: 'Bearer y', 'x-tenant-id': TENANT } }));
      expect({ statusCode: refused.statusCode, body: refused.body }).toEqual({
        statusCode: 401, body: problem(401, 'Unauthorized', '/errors/unauthorized'),
      });
      expect(calls).toEqual([]);
    });

    it('answer a service\'s error with the status it carries, else 500', async () => {
      const handle = await handler();
      const failure = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect(await handle(getItem('404'))).toEqual({
          statusCode: 404, headers: { 'content-type': 'application/json; charset=utf-8' }, body: problem(404, 'not found'),
        });
        expect(failure).not.toHaveBeenCalled();
        const crashed = await handle(getItem('500'));
        expect({ statusCode: crashed.statusCode, body: crashed.body }).toEqual({ statusCode: 500, body: problem(500, 'database down') });
        expect(failure).toHaveBeenCalledOnce();
      } finally {
        failure.mockRestore();
      }
    });

    it('answer a stream operation with its events together from the buffered handler', async () => {
      const handle = await handler();
      expect(await handle(event('GET', '/items/1/events'))).toEqual({
        statusCode: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: 'event: changed\ndata: {"type":"changed","qty":1}\n\n' +
          'event: changed\ndata: {"type":"changed","qty":2}\n\n' +
          'event: removed\ndata: {"type":"removed"}\n\n',
      });
    });

    describe('stream handler', () => {
      /** The prelude each response stream was opened with */
      let preludes: unknown[];

      beforeEach(() => {
        preludes = [];
        vi.stubGlobal('awslambda', {
          streamifyResponse: <H>(streamed: H) => streamed,
          HttpResponseStream: {
            from: (responseStream: Writable, prelude: unknown) => {
              preludes.push(prelude);
              return responseStream;
            },
          },
        });
      });

      afterEach(() => {
        vi.unstubAllGlobals();
      });

      /** A response stream recording each write in the log; destroyed after `limit` writes */
      function responseStream(limit = Infinity): Writable {
        let writes = 0;
        const stream: Writable = new Writable({
          write(chunk, _encoding, done) {
            log.push(`write ${String(chunk)}`);
            done();
            if (++writes === limit) stream.destroy();
          },
        });
        return stream;
      }

      async function streamHandler() {
        await generateProject(shopSpec, { 'auth.overlay.yaml': authOverlay });
        const { createStreamHandler } = await import(path.join(tmpDir, 'server/lambda.generated.ts'));
        return createStreamHandler({ services: { item: itemService }, overlays: { requireAuth } });
      }

      it('send each event as its service yields it, shaped by the event schema', async () => {
        const handle = await streamHandler();
        await handle(event('GET', '/items/1/events'), responseStream());
        expect(preludes).toEqual([{ statusCode: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } }]);
        expect(log).toEqual([
          'produce 1',
          'write event: changed\ndata: {"type":"changed","qty":1}\n\n',
          'produce 2',
          'write event: changed\ndata: {"type":"changed","qty":2}\n\n',
          'write event: removed\ndata: {"type":"removed"}\n\n',
        ]);
        expect(closed).toEqual([1]);
      });

      it('close the service when the response stream goes away', async () => {
        const handle = await streamHandler();
        await handle(event('GET', '/items/2/events'), responseStream(3)).catch(() => {});
        await vi.waitFor(() => expect(closed).toEqual([2]));
      });

      it('answer an operation that fails before its first event, and any other, as the buffered handler does', async () => {
        const handle = await streamHandler();
        const failure = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          await handle(event('GET', '/items/503/events'), responseStream());
          await handle(event('GET', '/items/latest'), responseStream());
        } finally {
          failure.mockRestore();
        }
        expect(preludes).toEqual([
          { statusCode: 503, headers: { 'content-type': 'application/json; charset=utf-8' } },
          { statusCode: 200, headers: { 'content-type': 'application/json; charset=utf-8' } },
        ]);
        expect(log).toEqual([`write ${problem(503, 'unavailable')}`, 'write {"id":0,"name":"latest"}']);
      });
    });
  });
});
