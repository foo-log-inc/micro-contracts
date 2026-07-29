import { describe, it, expect } from 'vitest';
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
});
