/**
 * JSON Schema generator from OpenAPI schemas
 * Generates Fastify-compatible JSON Schema objects
 */

import type { 
  OpenAPISpec, 
  SchemaObject, 
  ReferenceObject,
  ParameterObject,
  OperationObject,
} from '../types.js';
import { isReference, getRefName } from '../types.js';

/**
 * Get a valid TypeScript identifier from service and method
 * e.g., "User" + "getSchema" -> "User_getSchema"
 */
function getOperationTypeBase(operation: OperationObject): string {
  const service = operation['x-micro-contracts-service'] as string | undefined;
  const method = operation['x-micro-contracts-method'] as string | undefined;
  
  if (service && method) {
    return `${service}_${method}`;
  }
  
  if (operation.operationId) {
    return operation.operationId.replace(/[^a-zA-Z0-9]/g, '_');
  }
  
  return 'Unknown';
}

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
  const paramSchemas = generateParameterSchemas(spec);
  if (paramSchemas) {
    lines.push('// Parameter schemas');
    lines.push(paramSchemas);
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
  
  // Add parameter schemas
  for (const [, pathItem] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (!operation) continue;
      
      const typeBase = getOperationTypeBase(operation);

      // Combine query and path params into a single Params schema
      const queryParams = (operation.parameters || []).filter(
        (p): p is ParameterObject => !isReference(p) && p.in === 'query'
      );
      const pathParams = (operation.parameters || []).filter(
        (p): p is ParameterObject => !isReference(p) && p.in === 'path'
      );
      const allParams = [...pathParams, ...queryParams];
      if (allParams.length > 0) {
        lines.push(`  ${typeBase}Params,`);
      }
    }
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
 * Generate parameter schemas from paths
 */
function generateParameterSchemas(spec: OpenAPISpec): string {
  const lines: string[] = [];
  const generatedSchemas = new Set<string>();

  for (const [, pathItem] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (!operation) continue;
      
      const typeBase = getOperationTypeBase(operation);

      // Generate combined params schema (path + query params)
      const queryParams = (operation.parameters || []).filter(
        (p): p is ParameterObject => !isReference(p) && p.in === 'query'
      );
      const pathParams = (operation.parameters || []).filter(
        (p): p is ParameterObject => !isReference(p) && p.in === 'path'
      );
      const allParams = [...pathParams, ...queryParams];

      if (allParams.length > 0) {
        const schemaName = `${typeBase}Params`;
        if (!generatedSchemas.has(schemaName)) {
          generatedSchemas.add(schemaName);
          lines.push(generateParamsSchema(schemaName, allParams, spec));
          lines.push('');
        }
      }
    }
  }

  return lines.join('\n');
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

