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
import { getRefName, resolveOperation } from '../types.js';
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

  // Generate the parameter, inline request body and inline response schemas of operations
  const opSchemas = operationSchemas(spec);
  if (opSchemas.length > 0) {
    lines.push('// Operation parameter, request body and response schemas');
    for (const { name, schema } of opSchemas) {
      lines.push(generateSchemaExport(name, schema, spec));
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

  for (const { name, registered } of opSchemas) {
    if (registered) lines.push(`  ${name},`);
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
 * Keywords a validator leaves out. None of them takes part in validation:
 *
 * - OpenAPI annotations that are not JSON Schema, or are shaped differently
 *   from the JSON Schema keyword of the same name. Ajv — strict, as Fastify
 *   runs it — refuses a schema carrying one.
 * - `$id` and `$schema`: the generator names every schema itself (the name
 *   routes reference it by), and Fastify's Ajv decides the dialect. An author's
 *   `$id` would replace that name and a `$schema` Ajv does not hold would stop
 *   Fastify from starting.
 */
const EXCLUDED_KEYWORDS = new Set(['example', 'examples', 'xml', 'externalDocs', 'discriminator', '$id', '$schema']);

/** Keywords whose value is a schema (or, for `items`, a list of them). */
const SUBSCHEMA_KEYWORDS = new Set([
  'items', 'additionalItems', 'additionalProperties', 'not', 'contains', 'propertyNames',
  'if', 'then', 'else', 'unevaluatedItems', 'unevaluatedProperties', 'contentSchema',
]);

/** Keywords whose value is a list of schemas. */
const SUBSCHEMA_LIST_KEYWORDS = new Set(['allOf', 'oneOf', 'anyOf', 'prefixItems']);

/** Keywords whose value maps names to schemas. */
const SUBSCHEMA_MAP_KEYWORDS = new Set(['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions']);

/**
 * Convert an OpenAPI schema to the JSON Schema Fastify validates (Ajv) and
 * serializes (fast-json-stringify) with.
 *
 * Every keyword is kept as written, so whatever the contract constrains, the
 * validator constrains. Only what JSON Schema spells differently is
 * translated: `$ref`, `nullable`, the boolean `exclusiveMinimum` /
 * `exclusiveMaximum` of OpenAPI 3.0, and the schemas nested in other keywords.
 * Extensions (`x-*`) and the keywords above are left out.
 */
function convertSchemaValue(
  schema: SchemaObject | ReferenceObject,
  spec: OpenAPISpec
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  // A reference may carry schema keywords beside it (OpenAPI 3.1).
  const node = schema as SchemaObject & Partial<ReferenceObject>;

  for (const [keyword, value] of Object.entries(node)) {
    if (keyword.startsWith('x-') || EXCLUDED_KEYWORDS.has(keyword)) continue;

    if (keyword === '$ref') {
      result.$ref = `${getRefName(value as string)}#`;
    } else if (keyword === 'nullable') {
      if (value === true) result.nullable = true;
    } else if (keyword === 'exclusiveMinimum' || keyword === 'exclusiveMaximum') {
      // OpenAPI 3.0 flags `minimum` / `maximum` as exclusive; JSON Schema
      // states the exclusive bound itself.
      if (typeof value !== 'boolean') result[keyword] = value;
    } else if (SUBSCHEMA_KEYWORDS.has(keyword)) {
      result[keyword] = convertSubschema(value, spec);
    } else if (SUBSCHEMA_LIST_KEYWORDS.has(keyword)) {
      result[keyword] = (value as Array<SchemaObject | ReferenceObject>).map(s => convertSchemaValue(s, spec));
    } else if (SUBSCHEMA_MAP_KEYWORDS.has(keyword)) {
      result[keyword] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, s]) => [name, convertSubschema(s, spec)])
      );
    } else {
      result[keyword] = value;
    }
  }

  for (const [flag, bound] of [['exclusiveMinimum', 'minimum'], ['exclusiveMaximum', 'maximum']] as const) {
    if (node[flag] === true && node[bound] !== undefined) {
      result[flag] = node[bound];
      delete result[bound];
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

/** A keyword's schema value: a schema, a boolean schema, or a list of schemas. */
function convertSubschema(value: unknown, spec: OpenAPISpec): unknown {
  if (Array.isArray(value)) {
    return value.map(s => convertSchemaValue(s, spec));
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return convertSchemaValue(value as SchemaObject | ReferenceObject, spec);
}

/**
 * The schemas operations need beyond components.schemas:
 *
 * - `<base>PathParams`, `<base>QueryParams`, `<base>HeaderParams` and
 *   `<base>CookieParams`, one per request location, which is how a route
 *   validates them (Fastify's `schema.params`, `schema.querystring` and
 *   `schema.headers`; cookies, which Fastify does not parse, by the route
 *   itself). A single schema holding them all validates no location: its
 *   required path parameters would be demanded of the query.
 * - an inline request body and every inline response body, under the names
 *   types.ts gives them.
 *
 * A header schema names its headers in lower case, as a request delivers
 * them (header names are case-insensitive). It is not `registered` in
 * allSchemas: a route gives it inline, since Fastify warns on a referenced
 * headers schema and, for one with its own `$id`, validates against the
 * registered copy.
 */
function operationSchemas(spec: OpenAPISpec): Array<{ name: string; schema: SchemaObject; registered: boolean }> {
  const schemas: Array<{ name: string; schema: SchemaObject; registered: boolean }> = [];
  const names = new Set<string>();
  const add = (name: string, schema: SchemaObject, registered = true) => {
    if (names.has(name)) return;
    names.add(name);
    schemas.push({ name, schema, registered });
  };

  for (const [apiPath, pathItem] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (!operation) continue;

      const resolved = resolveOperation(spec, apiPath, method);
      const { parameterSchemas, inline } = operationTypeNames(operation, resolved);

      for (const [location, name] of Object.entries(parameterSchemas)) {
        const params = resolved.parameters.filter(p => p.in === location);
        if (location === 'header') {
          add(name, parametersSchema(params.map(p => ({ ...p, name: p.name.toLowerCase() }))), false);
        } else {
          add(name, parametersSchema(params));
        }
      }

      for (const { name, schema } of inline) {
        add(name, schema);
      }
    }
  }

  return schemas;
}

/** The object schema the parameters of one request location form. */
function parametersSchema(params: ParameterObject[]): SchemaObject {
  const required = params.filter(p => p.required).map(p => p.name);
  return {
    type: 'object',
    properties: Object.fromEntries(params.map(p => [p.name, p.schema ?? { type: 'string' }])),
    ...(required.length > 0 ? { required } : {}),
  };
}
