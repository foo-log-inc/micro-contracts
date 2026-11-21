import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { generateTypes } from './typeGenerator.js';
import type { OpenAPISpec } from '../types.js';

function minimalSpec(schemas: Record<string, unknown>): OpenAPISpec {
  return {
    openapi: '3.1.0',
    info: { title: 'Test', version: '1.0.0' },
    paths: {},
    components: { schemas: schemas as OpenAPISpec['components'] extends { schemas?: infer S } ? S : never },
  };
}

function extractInterface(output: string, name: string): string {
  const re = new RegExp(`export interface ${name} \\{[\\s\\S]*?\\n\\}`, 'm');
  const match = output.match(re);
  return match ? match[0] : '';
}

describe('OpenAPI 3.1 type array nullable syntax', () => {
  it('generates string | null for type: [string, null]', () => {
    const spec = minimalSpec({
      Example: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          phase: { type: ['string', 'null'], description: 'nullable string' },
        },
      },
    });
    const output = generateTypes(spec);
    const iface = extractInterface(output, 'Example');
    expect(iface).toContain('phase?: string | null;');
    expect(iface).toContain('name: string;');
  });

  it('generates number | null for type: [number, null]', () => {
    const spec = minimalSpec({
      Example: {
        type: 'object',
        properties: {
          count: { type: ['number', 'null'] },
        },
      },
    });
    const output = generateTypes(spec);
    expect(output).toContain('count?: number | null;');
  });

  it('generates number | null for type: [integer, null]', () => {
    const spec = minimalSpec({
      Example: {
        type: 'object',
        properties: {
          count: { type: ['integer', 'null'] },
        },
      },
    });
    const output = generateTypes(spec);
    expect(output).toContain('count?: number | null;');
  });

  it('generates string | number for type: [string, integer]', () => {
    const spec = minimalSpec({
      Example: {
        type: 'object',
        properties: {
          value: { type: ['string', 'integer'] },
        },
      },
    });
    const output = generateTypes(spec);
    expect(output).toContain('value?: string | number;');
  });

  it('generates string | number | null for type: [string, integer, null]', () => {
    const spec = minimalSpec({
      Example: {
        type: 'object',
        properties: {
          value: { type: ['string', 'integer', 'null'] },
        },
      },
    });
    const output = generateTypes(spec);
    expect(output).toContain('value?: string | number | null;');
  });

  it('still supports OpenAPI 3.0 nullable: true syntax', () => {
    const spec = minimalSpec({
      Example: {
        type: 'object',
        properties: {
          phase: { type: 'string', nullable: true },
        },
      },
    });
    const output = generateTypes(spec);
    expect(output).toContain('phase?: string | null;');
  });

  it('handles both 3.0 and 3.1 nullable in the same schema', () => {
    const spec = minimalSpec({
      Example: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          phase_v31: { type: ['string', 'null'], description: 'Nullable string (3.1 syntax)' },
          phase_v30: { type: 'string', nullable: true, description: 'Nullable string (3.0 syntax)' },
        },
      },
    });
    const output = generateTypes(spec);
    const iface = extractInterface(output, 'Example');
    expect(iface).toContain('name: string;');
    expect(iface).toContain('phase_v31?: string | null;');
    expect(iface).toContain('phase_v30?: string | null;');
    expect(iface).not.toContain('unknown');
  });

  it('quotes property names that are not valid identifiers', () => {
    const spec = minimalSpec({
      Setting: {
        type: 'object',
        description: 'app settings',
        properties: {
          '{any}': { type: 'string', description: 'free-form key' },
          'kebab-case': { type: 'number' },
          "it's": { type: 'string' },
          plain: { type: 'string' },
        },
      },
    });
    const iface = extractInterface(generateTypes(spec), 'Setting');
    expect(iface).toContain("'{any}'?: string;");
    expect(iface).toContain("'kebab-case'?: number;");
    expect(iface).toContain("'it\\'s'?: string;");
    expect(iface).toContain('plain?: string;');
  });

  it('quotes non-identifier property names in inline object types', () => {
    const spec = minimalSpec({
      Wrapper: {
        type: 'object',
        properties: {
          nested: {
            type: 'object',
            properties: { 'x-header': { type: 'string' } },
          },
        },
      },
    });
    expect(generateTypes(spec)).toContain("'x-header'?: string");
  });

  it('generates top-level type alias with nullable type array', () => {
    const spec = minimalSpec({
      NullableString: {
        type: ['string', 'null'],
      },
    });
    const output = generateTypes(spec);
    expect(output).toContain('export type NullableString = string | null;');
  });

  it('maps type: null to null, so a union with it stays typed', () => {
    const spec = minimalSpec({
      Org: { type: 'object', properties: { id: { type: 'string' } } },
      Me: {
        type: 'object',
        properties: {
          org: { oneOf: [{ $ref: '#/components/schemas/Org' }, { type: 'null' }] },
          nothing: { type: 'null' },
        },
      },
    });
    const iface = extractInterface(generateTypes(spec), 'Me');
    expect(iface).toContain('org?: (Org | null);');
    expect(iface).toContain('nothing?: null;');
  });

  it('keeps nullable beside a $ref', () => {
    const spec = minimalSpec({
      Org: { type: 'object', properties: { id: { type: 'string' } } },
      Me: {
        type: 'object',
        properties: { org: { $ref: '#/components/schemas/Org', nullable: true } },
      },
      MaybeOrg: { $ref: '#/components/schemas/Org', nullable: true },
    });
    const output = generateTypes(spec);
    expect(extractInterface(output, 'Me')).toContain('org?: Org | null;');
    expect(output).toContain('export type MaybeOrg = Org | null;');
  });

  it('keeps nullable on a top-level composition', () => {
    const spec = minimalSpec({
      Org: { type: 'object', properties: { id: { type: 'string' } } },
      MaybeOrg: { allOf: [{ $ref: '#/components/schemas/Org' }], nullable: true },
    });
    expect(generateTypes(spec)).toContain('export type MaybeOrg = (Org) | null;');
  });

  it('types a nullable object component as its members or null', () => {
    const spec = minimalSpec({
      Org: {
        type: 'object',
        nullable: true,
        description: 'Owning organization',
        properties: { id: { type: 'string', description: 'Org id' } },
      },
      Team: { type: ['object', 'null'], properties: { name: { type: 'string' } } },
      Me: { type: 'object', properties: { org: { $ref: '#/components/schemas/Org' } } },
    });
    const output = generateTypes(spec);
    expect(output).toContain(
      '/** Owning organization */\nexport type Org = {\n  /** Org id */\n  id?: string;\n} | null;'
    );
    expect(output).toContain('export type Team = {\n  name?: string;\n} | null;');
    expect(extractInterface(output, 'Me')).toContain('org?: Org;');
  });

  it('applies a top-level array to the whole nullable item type', () => {
    const spec = minimalSpec({
      Names: { type: 'array', items: { type: ['string', 'null'] } },
    });
    expect(generateTypes(spec)).toContain('export type Names = (string | null)[];');
  });
});

describe('const', () => {
  it('types a const as its literal value', () => {
    const output = generateTypes(minimalSpec({
      Order: {
        type: 'object',
        properties: {
          kind: { const: 'order' },
          version: { type: 'integer', const: 2 },
        },
      },
    }));
    const iface = extractInterface(output, 'Order');
    expect(iface).toContain("kind?: 'order';");
    expect(iface).toContain('version?: 2;');
  });
});

/**
 * Type-check `check` against the generated `types` as a consumer does (tsc
 * --strict). Returns tsc's diagnostics: empty when every assignment in `check`
 * holds and every `@ts-expect-error` marks an error.
 */
function typecheck(types: string, check: string[]): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'type-generator-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'types.ts'), types);
    fs.writeFileSync(path.join(tmpDir, 'check.ts'), check.join('\n'));
    const tsc = path.resolve(__dirname, '../../node_modules/typescript/bin/tsc');
    execFileSync(process.execPath, [tsc, '--strict', '--noEmit', '--target', 'ES2022', '--module', 'ESNext',
      '--moduleResolution', 'bundler', 'check.ts'], { cwd: tmpDir, encoding: 'utf-8', stdio: 'pipe' });
    return '';
  } catch (error) {
    return (error as { stdout: string }).stdout;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}


describe('a composition beside the schema\'s own keywords', () => {
  /** An object whose properties hold, and one of whose properties is required, by a oneOf of required-only subschemas */
  const eventRecordSchemas = {
    PayloadRef: {
      type: 'object',
      required: ['bucket', 'key'],
      additionalProperties: false,
      properties: { bucket: { type: 'string' }, key: { type: 'string' } },
    },
    EventRecord: {
      type: 'object',
      required: ['v', 'kind', 'org', 'deliveryId', 'event', 'receivedAt'],
      additionalProperties: false,
      oneOf: [{ required: ['payload'] }, { required: ['payloadRef'] }],
      properties: {
        v: { type: 'integer', enum: [1] },
        kind: { type: 'string', enum: ['event'] },
        org: { type: 'string' },
        deliveryId: { type: 'string' },
        event: { type: 'string' },
        receivedAt: { type: 'string', format: 'date-time' },
        payload: { type: 'object', additionalProperties: true },
        payloadRef: { $ref: '#/components/schemas/PayloadRef' },
      },
    },
  };

  it('types the properties and the subschemas\' required properties together', () => {
    expect(generateTypes(minimalSpec(eventRecordSchemas))).toContain(
      "export type EventRecord = { v: (1); kind: ('event'); org: string; deliveryId: string; event: string; receivedAt: string; " +
      'payload?: Record<string, unknown>; payloadRef?: PayloadRef } & ({ payload: unknown } | { payloadRef: unknown });'
    );
  });

  it('types an anyOf of required-only subschemas beside an object with additional properties', () => {
    const output = generateTypes(minimalSpec({
      Contact: {
        type: 'object',
        additionalProperties: true,
        anyOf: [{ required: ['email'] }, { required: ['phone'] }],
        properties: { email: { type: 'string' }, phone: { type: 'string' } },
      },
    }));
    expect(output).toContain(
      'export type Contact = { email?: string; phone?: string; [key: string]: unknown } & ({ email: unknown } | { phone: unknown });'
    );
  });

  it('types every composition keyword of a schema', () => {
    const output = generateTypes(minimalSpec({
      A: { type: 'object', properties: { a: { type: 'string' } } },
      B: { type: 'object', properties: { b: { type: 'string' } } },
      C: { type: 'object', properties: { c: { type: 'string' } } },
      AB: { allOf: [{ $ref: '#/components/schemas/A' }], oneOf: [{ $ref: '#/components/schemas/B' }, { $ref: '#/components/schemas/C' }] },
      MaybeAB: { allOf: [{ $ref: '#/components/schemas/A' }], anyOf: [{ $ref: '#/components/schemas/B' }], nullable: true },
    }));
    expect(output).toContain('export type AB = (A) & (B | C);');
    expect(output).toContain('export type MaybeAB = (A) & (B) | null;');
  });

  it('gives a consumer a type that checks the record', () => {
    expect(typecheck(generateTypes(minimalSpec(eventRecordSchemas)), [
      "import type { EventRecord } from './types';",
      "const base = { v: 1, kind: 'event', org: 'o', deliveryId: 'd', event: 'push', receivedAt: '2026-11-22T00:00:00Z' } as const;",
      'export const withPayload: EventRecord = { ...base, payload: { action: 1 } };',
      "export const withRef: EventRecord = { ...base, payloadRef: { bucket: 'b', key: 'k' } };",
      "export const header: Omit<EventRecord, 'payload' | 'payloadRef'> = { ...base };",
      '// @ts-expect-error a field the schema does not declare',
      'export const extra: EventRecord = { ...base, payload: {}, extra: 1 };',
      '// @ts-expect-error v is 1',
      'export const wrongV: EventRecord = { ...base, v: 2, payload: {} };',
      "// @ts-expect-error kind is 'event'",
      'export const wrongKind: EventRecord = { ...base, kind: 1, payload: {} };',
      '// @ts-expect-error payloadRef is a PayloadRef',
      "export const wrongRef: EventRecord = { ...base, payloadRef: { bucket: 'b' } };",
      '// @ts-expect-error one of payload and payloadRef is required',
      'export const neither: EventRecord = { ...base };',
    ])).toBe('');
  });
});

describe('additional properties beside properties', () => {
  it('admits the properties\' types in the index signature, so the type compiles', () => {
    const output = generateTypes(minimalSpec({
      Labels: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' }, count: { type: 'integer' } },
        additionalProperties: { type: 'string' },
      },
      Tags: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
        additionalProperties: { type: 'string' },
      },
    }));
    expect(extractInterface(output, 'Labels')).toContain('[key: string]: string | number | undefined;');
    expect(extractInterface(output, 'Tags')).toContain('[key: string]: string;');
    expect(typecheck(output, [
      "import type { Labels } from './types';",
      "export const labels: Labels = { name: 'n', count: 1, env: 'prod' };",
      '// @ts-expect-error an additional property is a string',
      "export const wrong: Labels = { name: 'n', env: {} };",
    ])).toBe('');
  });
});
