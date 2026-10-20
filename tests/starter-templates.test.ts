/**
 * Starter template tests
 *
 * The starter templates are what `micro-contracts init` writes to
 * spec/default/templates/. These tests render them from getStarterTemplates()
 * — the content init writes — and run the code they generate.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Fastify, { type FastifyInstance } from 'fastify';
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
   * contract/m, server/{routes,overlayAdapter}.generated.ts and
   * frontend/api.generated.ts.
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
        },
      },
      modules: { m: { openapi: specPath } },
    };

    await generate(config);
  }

  /** Register the generated routes on a Fastify instance with these services and overlay handlers. */
  async function serve(
    services: Record<string, Record<string, unknown>>,
    overlayHandlers?: Record<string, unknown>,
  ): Promise<FastifyInstance> {
    const { registerRoutes } = await import(path.join(tmpDir, 'server/routes.generated.ts'));
    const app = Fastify();
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
        const res = await app.inject({ method: 'GET', url: '/users/ab' });
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
        const denied = await app.inject({ method: 'GET', url: '/users/ab' });
        expect(denied.statusCode).toBe(401);

        const admitted = await app.inject({ method: 'GET', url: '/users/ab', headers: { authorization: 'Bearer x' } });
        expect(admitted.statusCode).toBe(200);
        expect(admitted.json()).toEqual({ id: 'ab', name: 'n' });
      } finally {
        await app.close();
      }
    });
  });
});
