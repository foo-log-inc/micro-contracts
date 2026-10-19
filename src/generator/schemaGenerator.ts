/**
 * JSON Schema generator from OpenAPI schemas
 * Generates Fastify-compatible JSON Schema objects
 */

import type { 
  OpenAPISpec, 
  SchemaObject, 
  ReferenceObject,
  ParameterObject,
} from '../types.js';
import { isReference, getRefName, resolveOperation } from '../types.js';
import { operationTypeNames } from './typeGenerator.js';

/**
 * Generate JSON Schema TypeScript file from OpenAPI spec
 */
export function generateSchemas(spec: OpenAPISpec): string {
  const lines: string[] = [];
  
  lines.push('/**');
  lines.push(' * Auto-generated JSON Schemas from OpenAPI specification');
  lines.push(` * Generated from: ${spec.info.title} v${spec.info.version}`);
  lines.push(' * DO NOT EDIT MANUALLY');
  lines.push(' */');
  lines.push('');

  // Generate schemas from components/schemas
  if (spec.components?.schemas) {
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      lines.push(generateSchemaExport(name, schema, spec));
      lines.push('');
    }
  }

  // Generate query/path parameter schemas from paths
  const paramSchemas = parameterSchemas(spec);
  if (paramSchemas.length > 0) {
    lines.push('// Parameter schemas');
    for (const { name, params } of paramSchemas) {
      lines.push(generateParamsSchema(name, params, spec));
      lines.push('');
    }
  }

  // Export all schema names for registration
  lines.push('');
  lines.push('// All schemas for registration');
  lines.push('export const allSchemas = [');
  
  if (spec.components?.schemas) {
    for (const name of Object.keys(spec.components.schemas)) {
      lines.push(`  ${name},`);
    }
  }

  for (const { name } of paramSchemas) {
    lines.push(`  ${name},`);
  }

  lines.push('] as const;');

  return lines.join('\n');
}

/**
 * Generate a single schema export
 */
function generateSchemaExport(
  name: string,
  schema: SchemaObject | ReferenceObject,
  spec: OpenAPISpec
): string {
  const jsonSchema = { $id: name, ...convertSchemaValue(schema, spec) };
  const schemaStr = JSON.stringify(jsonSchema, null, 2)
    .split('\n')
    .map((line, i) => i === 0 ? line : '  ' + line)
    .join('\n');
  
  return `export const ${name} = ${schemaStr} as const;`;
}

/**
 * Convert an OpenAPI schema to the JSON Schema Fastify validates (Ajv) and
 * serializes (fast-json-stringify) with.
 *
 * Each keyword is translated on its own, so a keyword beside `$ref` or a
 * composition is kept rather than dropped.
 */
function convertSchemaValue(
  schema: SchemaObject | ReferenceObject,
  spec: OpenAPISpec
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (isReference(schema)) {
    result.$ref = `${getRefName(schema.$ref)}#`;
  }
  // A reference may carry schema keywords beside it (OpenAPI 3.1).
  const node = schema as SchemaObject;

  if (node.allOf) result.allOf = node.allOf.map(s => convertSchemaValue(s, spec));
  if (node.oneOf) result.oneOf = node.oneOf.map(s => convertSchemaValue(s, spec));
  if (node.anyOf) result.anyOf = node.anyOf.map(s => convertSchemaValue(s, spec));

  // Copy basic properties
  if (node.type) result.type = node.type;
  if (node.description) result.description = node.description;
  if (node.enum) result.enum = node.enum;
  if (node.format) result.format = node.format;
  if (node.default !== undefined) result.default = node.default;
  if (node.nullable) result.nullable = node.nullable;

  // Number constraints
  if (node.minimum !== undefined) result.minimum = node.minimum;
  if (node.maximum !== undefined) result.maximum = node.maximum;

  // String constraints
  if (node.minLength !== undefined) result.minLength = node.minLength;
  if (node.maxLength !== undefined) result.maxLength = node.maxLength;
  if (node.pattern) result.pattern = node.pattern;

  // Array constraints
  if (node.minItems !== undefined) result.minItems = node.minItems;
  if (node.maxItems !== undefined) result.maxItems = node.maxItems;
  if (node.items) {
    result.items = convertSchemaValue(node.items, spec);
  }

  // Object properties
  if (node.properties) {
    result.properties = {};
    for (const [propName, propSchema] of Object.entries(node.properties)) {
      (result.properties as Record<string, unknown>)[propName] = 
        convertSchemaValue(propSchema, spec);
    }
  }
  if (node.required && node.required.length > 0) {
    result.required = node.required;
  }
  if (node.additionalProperties !== undefined) {
    if (typeof node.additionalProperties === 'boolean') {
      result.additionalProperties = node.additionalProperties;
    } else {
      result.additionalProperties = convertSchemaValue(node.additionalProperties, spec);
    }
  }

  // Ajv and fast-json-stringify read `nullable` only as a widening of `type`.
  // Without a type Ajv refuses the schema, and a `$ref` or composition beside
  // it still rejects null — fast-json-stringify then writes null as `{}`.
  // There, null becomes a branch of its own, tried first so that Ajv's type
  // coercion cannot turn a null into the other branch's empty value.
  if (result.nullable && (result.type === undefined || result.$ref || result.allOf || result.oneOf || result.anyOf)) {
    delete result.nullable;
    return { anyOf: [{ type: 'null' }, result] };
  }

  return result;
}

/**
 * The parameter schemas of every operation: `<base>PathParams` and
 * `<base>QueryParams`, one per request location, which is how Fastify
 * validates them (`schema.params` and `schema.querystring`). A single schema
 * holding both validates neither location: its required path parameters would
 * be demanded of the query string.
 */
function parameterSchemas(spec: OpenAPISpec): Array<{ name: string; params: ParameterObject[] }> {
  const schemas: Array<{ name: string; params: ParameterObject[] }> = [];
  const names = new Set<string>();

  for (const [apiPath, pathItem] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (!operation) continue;

      const resolved = resolveOperation(spec, apiPath, method);
      const { base } = operationTypeNames(operation, resolved);

      for (const [location, suffix] of [['path', 'PathParams'], ['query', 'QueryParams']] as const) {
        const params = resolved.parameters.filter(p => p.in === location);
        const name = `${base}${suffix}`;
        if (params.length > 0 && !names.has(name)) {
          names.add(name);
          schemas.push({ name, params });
        }
      }
    }
  }

  return schemas;
}

/**
 * Generate parameter schema
 */
function generateParamsSchema(
  name: string,
  params: ParameterObject[],
  spec: OpenAPISpec
): string {
  const schema: Record<string, unknown> = {
    $id: name,
    type: 'object',
    properties: {},
    required: [] as string[],
  };

  for (const param of params) {
    if (param.schema) {
      (schema.properties as Record<string, unknown>)[param.name] = 
        convertSchemaValue(param.schema, spec);
    } else {
      (schema.properties as Record<string, unknown>)[param.name] = { type: 'string' };
    }
    
    if (param.required) {
      (schema.required as string[]).push(param.name);
    }
  }

  // Remove empty required array
  if ((schema.required as string[]).length === 0) {
    delete schema.required;
  }

  const schemaStr = JSON.stringify(schema, null, 2)
    .split('\n')
    .map((line, i) => i === 0 ? line : '  ' + line)
    .join('\n');

  return `export const ${name} = ${schemaStr} as const;`;
}

