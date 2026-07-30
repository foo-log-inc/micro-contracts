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
  const jsonSchema = convertToJsonSchema(name, schema, spec);
  const schemaStr = JSON.stringify(jsonSchema, null, 2)
    .split('\n')
    .map((line, i) => i === 0 ? line : '  ' + line)
    .join('\n');
  
  return `export const ${name} = ${schemaStr} as const;`;
}

/**
 * Convert OpenAPI schema to JSON Schema with $id
 */
function convertToJsonSchema(
  name: string,
  schema: SchemaObject | ReferenceObject,
  spec: OpenAPISpec
): Record<string, unknown> {
  if (isReference(schema)) {
    return { $ref: `${getRefName(schema.$ref)}#` };
  }

  const result: Record<string, unknown> = {
    $id: name,
  };

  // Handle allOf, oneOf, anyOf
  if (schema.allOf) {
    result.allOf = schema.allOf.map(s => convertSchemaValue(s, spec));
    return result;
  }
  if (schema.oneOf) {
    result.oneOf = schema.oneOf.map(s => convertSchemaValue(s, spec));
    return result;
  }
  if (schema.anyOf) {
    result.anyOf = schema.anyOf.map(s => convertSchemaValue(s, spec));
    return result;
  }

  // Copy basic properties
  if (schema.type) result.type = schema.type;
  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;
  if (schema.format) result.format = schema.format;
  if (schema.default !== undefined) result.default = schema.default;
  if (schema.nullable) result.nullable = schema.nullable;

  // Number constraints
  if (schema.minimum !== undefined) result.minimum = schema.minimum;
  if (schema.maximum !== undefined) result.maximum = schema.maximum;

  // String constraints
  if (schema.minLength !== undefined) result.minLength = schema.minLength;
  if (schema.maxLength !== undefined) result.maxLength = schema.maxLength;
  if (schema.pattern) result.pattern = schema.pattern;

  // Array constraints
  if (schema.minItems !== undefined) result.minItems = schema.minItems;
  if (schema.maxItems !== undefined) result.maxItems = schema.maxItems;
  if (schema.items) {
    result.items = convertSchemaValue(schema.items, spec);
  }

  // Object properties
  if (schema.properties) {
    result.properties = {};
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      (result.properties as Record<string, unknown>)[propName] = 
        convertSchemaValue(propSchema, spec);
    }
  }
  if (schema.required && schema.required.length > 0) {
    result.required = schema.required;
  }
  if (schema.additionalProperties !== undefined) {
    if (typeof schema.additionalProperties === 'boolean') {
      result.additionalProperties = schema.additionalProperties;
    } else {
      result.additionalProperties = convertSchemaValue(schema.additionalProperties, spec);
    }
  }

  return result;
}

/**
 * Convert schema value (without $id)
 */
function convertSchemaValue(
  schema: SchemaObject | ReferenceObject,
  spec: OpenAPISpec
): Record<string, unknown> {
  if (isReference(schema)) {
    return { $ref: `${getRefName(schema.$ref)}#` };
  }

  const result: Record<string, unknown> = {};

  // Handle allOf, oneOf, anyOf
  if (schema.allOf) {
    result.allOf = schema.allOf.map(s => convertSchemaValue(s, spec));
    return result;
  }
  if (schema.oneOf) {
    result.oneOf = schema.oneOf.map(s => convertSchemaValue(s, spec));
    return result;
  }
  if (schema.anyOf) {
    result.anyOf = schema.anyOf.map(s => convertSchemaValue(s, spec));
    return result;
  }

  // Copy basic properties
  if (schema.type) result.type = schema.type;
  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;
  if (schema.format) result.format = schema.format;
  if (schema.default !== undefined) result.default = schema.default;
  if (schema.nullable) result.nullable = schema.nullable;

  // Number constraints
  if (schema.minimum !== undefined) result.minimum = schema.minimum;
  if (schema.maximum !== undefined) result.maximum = schema.maximum;

  // String constraints
  if (schema.minLength !== undefined) result.minLength = schema.minLength;
  if (schema.maxLength !== undefined) result.maxLength = schema.maxLength;
  if (schema.pattern) result.pattern = schema.pattern;

  // Array constraints
  if (schema.minItems !== undefined) result.minItems = schema.minItems;
  if (schema.maxItems !== undefined) result.maxItems = schema.maxItems;
  if (schema.items) {
    result.items = convertSchemaValue(schema.items, spec);
  }

  // Object properties
  if (schema.properties) {
    result.properties = {};
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      (result.properties as Record<string, unknown>)[propName] = 
        convertSchemaValue(propSchema, spec);
    }
  }
  if (schema.required && schema.required.length > 0) {
    result.required = schema.required;
  }
  if (schema.additionalProperties !== undefined) {
    if (typeof schema.additionalProperties === 'boolean') {
      result.additionalProperties = schema.additionalProperties;
    } else {
      result.additionalProperties = convertSchemaValue(schema.additionalProperties, spec);
    }
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

