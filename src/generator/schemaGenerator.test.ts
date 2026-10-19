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

describe('validation keywords', () => {
  const keywordSpec = {
    openapi: '3.1.0',
    info: { title: 'Test', version: '1.0.0' },
    paths: {},
    components: {
      schemas: {
        Order: {
          type: 'object',
          required: ['orderId', 'quantity', 'tags'],
          properties: {
            orderId: { type: 'string' },
            quantity: { type: 'integer', minimum: 1, multipleOf: 5 },
            price: { type: 'number', exclusiveMinimum: 0 },
            discount: { type: 'number', maximum: 1, exclusiveMaximum: true },
            tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
            kind: { const: 'order' },
            note: { type: 'string', example: 'shown in docs', 'x-internal': true },
          },
        },
        CreateOrderRequest: {
          type: 'object',
          minProperties: 1,
          maxProperties: 3,
          properties: {
            quantity: { type: 'integer', multipleOf: 5 },
            note: { type: 'string' },
          },
        },
      },
    },
  } as unknown as OpenAPISpec;

  let keywordDir: string;
  let keywordApp: FastifyInstance;

  beforeAll(async () => {
    keywordDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-keywords-test-'));
    const validatorsPath = path.join(keywordDir, 'validators.ts');
    fs.writeFileSync(validatorsPath, generateSchemas(keywordSpec));
    const { allSchemas } = await import(validatorsPath);

    keywordApp = Fastify();
    for (const schema of allSchemas) {
      keywordApp.addSchema(schema);
    }
    keywordApp.post('/order', { schema: { body: { $ref: 'Order#' } } }, async (request) => request.body);
    keywordApp.post('/create', { schema: { body: { $ref: 'CreateOrderRequest#' } } }, async (request) => request.body);
    await keywordApp.ready();
  });

  afterAll(async () => {
    await keywordApp?.close();
    fs.rmSync(keywordDir, { recursive: true, force: true });
  });

  const post = (url: string, payload: Record<string, unknown>) => keywordApp.inject({ method: 'POST', url, payload });
  const valid = { orderId: 'o1', quantity: 5, tags: ['a'], kind: 'order', price: 1, discount: 0.5 };

  it('accepts a value within every declared constraint', async () => {
    expect((await post('/order', valid)).statusCode).toBe(200);
    expect((await post('/create', { quantity: 10 })).statusCode).toBe(200);
  });

  it('rejects a value breaking any declared constraint', async () => {
    for (const payload of [
      { ...valid, quantity: 7 },
      { ...valid, price: 0 },
      { ...valid, discount: 1 },
      { ...valid, tags: ['a', 'a'] },
      { ...valid, kind: 'other' },
    ]) {
      expect((await post('/order', payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await post('/create', {})).statusCode).toBe(400);
    expect((await post('/create', { quantity: 5, note: 'n', a: 1, b: 2 })).statusCode).toBe(400);
  });
});

describe('schema identity', () => {
  it('registers a component under its own name even when the author gave it an $id and $schema', async () => {
    const identitySpec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {},
      components: {
        schemas: {
          Foo: { type: 'object', properties: { a: { type: 'string' } } },
          Bar: {
            $id: 'https://example.com/bar',
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: { foo: { $ref: '#/components/schemas/Foo' } },
          },
        },
      },
    } as unknown as OpenAPISpec;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-identity-test-'));
    const validatorsPath = path.join(dir, 'validators.ts');
    fs.writeFileSync(validatorsPath, generateSchemas(identitySpec));
    const { allSchemas } = await import(validatorsPath);

    const identityApp = Fastify();
    try {
      for (const schema of allSchemas) {
        identityApp.addSchema(schema);
      }
      identityApp.post('/bars', { schema: { body: { $ref: 'Bar#' } } }, async (request) => request.body);
      await identityApp.ready();

      const res = await identityApp.inject({ method: 'POST', url: '/bars', payload: { foo: { a: 'x' } } });
      expect(res.statusCode).toBe(200);
    } finally {
      await identityApp.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
