import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateSchemas } from './schemaGenerator.js';
import type { OpenAPISpec } from '../types.js';

/**
 * The generated validators are only meaningful as Fastify reads them: Ajv
 * validates requests and fast-json-stringify serializes responses. These tests
 * register the emitted module the way the generated routes do and go through
 * HTTP, rather than reading the emitted text.
 */
const spec = {
  openapi: '3.1.0',
  info: { title: 'Test', version: '1.0.0' },
  paths: {},
  components: {
    schemas: {
      Org: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      Organization: { $ref: '#/components/schemas/Org' },
      Me: {
        type: 'object',
        properties: {
          composed: { allOf: [{ $ref: '#/components/schemas/Org' }], nullable: true },
          referenced: { $ref: '#/components/schemas/Org', nullable: true, description: 'Owning org' },
          unionWithNull: { oneOf: [{ $ref: '#/components/schemas/Org' }, { type: 'null' }] },
          scalarUnion: { anyOf: [{ type: 'string' }, { type: 'integer' }], nullable: true },
          alias: { $ref: '#/components/schemas/Organization' },
        },
      },
    },
  },
} as unknown as OpenAPISpec;

let tmpDir: string;
let app: FastifyInstance;
let response: unknown;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-generator-test-'));
  const validatorsPath = path.join(tmpDir, 'validators.ts');
  fs.writeFileSync(validatorsPath, generateSchemas(spec));
  const { allSchemas } = await import(validatorsPath);

  app = Fastify();
  for (const schema of allSchemas) {
    app.addSchema(schema);
  }
  app.get('/me', { schema: { response: { 200: { $ref: 'Me#' } } } }, async () => response);
  app.post('/me', { schema: { body: { $ref: 'Me#' } } }, async (request) => request.body);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function serialize(body: unknown): Promise<unknown> {
  response = body;
  const res = await app.inject({ method: 'GET', url: '/me' });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('nullable composed and referenced properties', () => {
  it('serializes null as null', async () => {
    const nulls = { composed: null, referenced: null, unionWithNull: null, scalarUnion: null };
    expect(await serialize(nulls)).toEqual(nulls);
  });

  it('still serializes a present value through the referenced schema', async () => {
    const org = { id: 'o1', internal: 'dropped' };
    expect(await serialize({ composed: org, referenced: org, unionWithNull: org, alias: org }))
      .toEqual({ composed: { id: 'o1' }, referenced: { id: 'o1' }, unionWithNull: { id: 'o1' }, alias: { id: 'o1' } });
  });

  it('accepts null in a request body and keeps it null', async () => {
    const nulls = { composed: null, referenced: null, unionWithNull: null, scalarUnion: null };
    const res = await app.inject({ method: 'POST', url: '/me', payload: nulls });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(nulls);
  });

  it('still rejects a value that matches neither null nor the referenced schema', async () => {
    for (const payload of [{ composed: {} }, { referenced: {} }, { alias: {} }]) {
      const res = await app.inject({ method: 'POST', url: '/me', payload });
      expect(res.statusCode).toBe(400);
    }
  });
});
