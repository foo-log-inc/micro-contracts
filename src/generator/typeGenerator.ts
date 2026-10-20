/**
 * TypeScript type generator from OpenAPI schemas
 */

import type { 
  OpenAPISpec, 
  SchemaObject, 
  ReferenceObject,
  ParameterObject,
  OperationObject,
  OpenAPIType,
  ResolvedOperation,
  OperationBody,
} from '../types.js';
import { isReference, getRefName, isTsIdentifier, resolveOperation } from '../types.js';

/**
 * Normalize OpenAPI 3.1 type arrays into a non-null type and a nullable flag.
 * Returns undefined for type if the schema has no type field.
 */
function normalizeType(schema: SchemaObject | ReferenceObject): { types: OpenAPIType[]; nullable: boolean } {
  // A reference may carry schema keywords beside it (OpenAPI 3.1).
  const node = schema as SchemaObject;
  const raw = node.type;
  if (raw === undefined) {
    return { types: [], nullable: !!node.nullable };
  }
  const arr = Array.isArray(raw) ? raw : [raw];
  const hasNull = arr.includes('null');
  const nonNull = arr.filter((t): t is OpenAPIType => t !== 'null');
  return { types: nonNull, nullable: hasNull || !!node.nullable };
}

/**
 * Generate TypeScript type definitions from OpenAPI spec
 */
export function generateTypes(spec: OpenAPISpec): string {
  const lines: string[] = [];
  
  lines.push('/**');
  lines.push(' * Auto-generated TypeScript types from OpenAPI specification');
  lines.push(` * Generated from: ${spec.info.title} v${spec.info.version}`);
  lines.push(' * DO NOT EDIT MANUALLY');
  lines.push(' */');
  lines.push('');

  // Always include ProblemDetails (RFC 9457) for error handling
  lines.push(generateProblemDetailsType());
  lines.push('');

  // Generate types from components/schemas
  if (spec.components?.schemas) {
    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      // Skip if already generated (e.g., ProblemDetails)
      if (name === 'ProblemDetails') continue;
      lines.push(generateSchemaType(name, schema, spec));
      lines.push('');
    }
  }

  // Generate request/response types from paths
  const operationTypes = generateOperationTypes(spec);
  if (operationTypes) {
    lines.push('// Operation-specific types');
    lines.push(operationTypes);
  }

  return lines.join('\n');
}

/**
 * Generate ProblemDetails type (RFC 9457)
 * This is always included for standardized error handling
 */
function generateProblemDetailsType(): string {
  return `/**
 * RFC 9457 Problem Details for HTTP APIs
 * @see https://www.rfc-editor.org/rfc/rfc9457.html
 */
export interface ProblemDetails {
  /** A URI reference that identifies the problem type */
  type: string;
  /** A short, human-readable summary */
  title: string;
  /** The HTTP status code */
  status: number;
  /** A human-readable explanation specific to this occurrence */
  detail?: string;
  /** A URI reference to the specific occurrence */
  instance?: string;
  /** Application-specific error code (SCREAMING_SNAKE_CASE) */
  code?: string;
  /** Request trace ID for debugging */
  traceId?: string;
  /** Detailed validation errors */
  errors?: ValidationError[];
  /** Additional properties */
  [key: string]: unknown;
}

/**
 * Validation error detail
 */
export interface ValidationError {
  /** JSON Pointer to the invalid field */
  pointer: string;
  /** Error message for this field */
  detail: string;
}`;
}

/**
 * Generate TypeScript type for a single schema
 */
function generateSchemaType(
  name: string, 
  schema: SchemaObject | ReferenceObject,
  spec: OpenAPISpec
): string {
  // A plain object schema becomes an interface; anything else is the same type
  // a property of that schema would get.
  const composed = !isReference(schema) && (schema.allOf || schema.oneOf || schema.anyOf);
  if (!isReference(schema) && !composed && (normalizeType(schema).types.includes('object') || schema.properties)) {
    return generateInterfaceType(name, schema, spec);
  }

  return `export type ${name} = ${schemaToTypeString(schema, spec)};`;
}

/**
 * Generate the type of an object schema: an interface, or — when the schema is
 * nullable, which an interface cannot express — the same members as a type
 * alias with `| null`.
 */
function generateInterfaceType(
  name: string, 
  schema: SchemaObject,
  spec: OpenAPISpec
): string {
  const lines: string[] = [];
  const required = new Set(schema.required || []);
  const { nullable } = normalizeType(schema);

  if (schema.description) {
    lines.push(`/** ${schema.description} */`);
  }
  lines.push(nullable ? `export type ${name} = {` : `export interface ${name} {`);

  if (schema.properties) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const isRequired = required.has(propName);
      const tsType = schemaToTypeString(propSchema, spec);
      const optional = isRequired ? '' : '?';
      
      // Add description as JSDoc if available
      if (!isReference(propSchema) && propSchema.description) {
        lines.push(`  /** ${propSchema.description} */`);
      }
      
      lines.push(`  ${formatPropertyKey(propName)}${optional}: ${tsType};`);
    }
  }

  // Handle additionalProperties
  if (schema.additionalProperties) {
    if (typeof schema.additionalProperties === 'boolean') {
      lines.push('  [key: string]: unknown;');
    } else {
      const valueType = schemaToTypeString(schema.additionalProperties, spec);
      lines.push(`  [key: string]: ${valueType};`);
    }
  }

  lines.push(nullable ? '} | null;' : '}');
  return lines.join('\n');
}

/**
 * Convert schema to TypeScript type string
 */
function schemaToTypeString(
  schema: SchemaObject | ReferenceObject,
  spec: OpenAPISpec
): string {
  const { types, nullable } = normalizeType(schema);
  const nullSuffix = nullable ? ' | null' : '';

  if (isReference(schema)) {
    return `${getRefName(schema.$ref)}${nullSuffix}`;
  }

  // Handle allOf, oneOf, anyOf
  if (schema.allOf) {
    const ts = schema.allOf.map(s => schemaToTypeString(s, spec)).join(' & ');
    return `(${ts})${nullSuffix}`;
  }
  if (schema.oneOf) {
    const ts = schema.oneOf.map(s => schemaToTypeString(s, spec)).join(' | ');
    return `(${ts})${nullSuffix}`;
  }
  if (schema.anyOf) {
    const ts = schema.anyOf.map(s => schemaToTypeString(s, spec)).join(' | ');
    return `(${ts})${nullSuffix}`;
  }

  // Handle const and enum
  if (schema.const !== undefined) {
    return `${literalType(schema.const)}${nullSuffix}`;
  }
  if (schema.enum) {
    const enumValues = schema.enum.map(literalType).join(' | ');
    return `(${enumValues})${nullSuffix}`;
  }

  // Handle array
  if (types.includes('array') && schema.items) {
    const itemType = schemaToTypeString(schema.items, spec);
    const wrappedItemType = itemType.includes(' | ') || itemType.includes(' & ') 
      ? `(${itemType})` 
      : itemType;
    return `${wrappedItemType}[]${nullSuffix}`;
  }

  // Handle object with inline properties
  if (types.includes('object') || schema.properties) {
    if (!schema.properties) {
      if (schema.additionalProperties) {
        if (typeof schema.additionalProperties === 'boolean') {
          return `Record<string, unknown>${nullSuffix}`;
        }
        const valueType = schemaToTypeString(schema.additionalProperties, spec);
        return `Record<string, ${valueType}>${nullSuffix}`;
      }
      return `Record<string, unknown>${nullSuffix}`;
    }
    const props: string[] = [];
    const required = new Set(schema.required || []);
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const isRequired = required.has(propName);
      const tsType = schemaToTypeString(propSchema, spec);
      const optional = isRequired ? '' : '?';
      props.push(`${formatPropertyKey(propName)}${optional}: ${tsType}`);
    }
    return `{ ${props.join('; ')} }${nullSuffix}`;
  }

  // Handle primitive types (including type arrays like ['string', 'null'])
  return resolveTypeString(types, schema, nullable);
}

/**
 * Map a single OpenAPI type name to its TypeScript equivalent
 */
function singleTypeToTs(typeName: OpenAPIType): string {
  switch (typeName) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'object':
      return 'Record<string, unknown>';
    case 'array':
      return 'unknown[]';
    default:
      return 'unknown';
  }
}

/**
 * Resolve an array of OpenAPI types (with nullable flag) into a TypeScript type string.
 * Handles both single-type and multi-type (OpenAPI 3.1 union) cases.
 */
function resolveTypeString(types: OpenAPIType[], schema: SchemaObject, nullable: boolean): string {
  const nullSuffix = nullable ? ' | null' : '';

  if (types.length === 0) {
    // A declared type of only 'null' admits null alone; no declared type admits anything.
    return schema.type !== undefined ? 'null' : `unknown${nullSuffix}`;
  }

  const tsTypes = types.map(t => singleTypeToTs(t));
  const unique = [...new Set(tsTypes)];
  return unique.join(' | ') + nullSuffix;
}

/**
 * Generate a valid TypeScript identifier from service and method
 * e.g., "User" + "getSchema" -> "User_getSchema"
 */
function getOperationTypeName(operation: OperationObject): string {
  const service = operation['x-micro-contracts-service'] as string | undefined;
  const method = operation['x-micro-contracts-method'] as string | undefined;
  
  if (service && method) {
    // Use x-micro-contracts-service + _ + x-micro-contracts-method for type name
    return `${service}_${method}`;
  }
  
  // Fallback: sanitize operationId (replace dots with underscores, etc.)
  if (operation.operationId) {
    return operation.operationId.replace(/[^a-zA-Z0-9]/g, '_');
  }
  
  return 'Unknown';
}

/** The parameters an operation's Params type is made of: path and query. */
function paramsTypeMembers(resolved: ResolvedOperation): ParameterObject[] {
  return resolved.parameters.filter(p => p.in === 'query' || p.in === 'path');
}

/**
 * The type names generated for one operation.
 *
 * The single definition of what an operation contributes to types.ts: the
 * emitter below, validators.ts and the deps/ re-exports all read it, so none
 * of them can name a type that is never generated.
 */
export function operationTypeNames(operation: OperationObject, resolved: ResolvedOperation): {
  base: string;
  input: string;
  params?: string;
  /** The request body's type */
  body?: string;
  /** The success response body's type; absent when the response has no body */
  response?: string;
  /** The body type of every other response with a body generated code carries */
  otherResponses: Array<{ statusCode: string; type: string }>;
  /** The inline schemas named after the operation, with their names */
  inline: Array<{ name: string; schema: SchemaObject }>;
} {
  const base = getOperationTypeName(operation);
  const params = paramsTypeMembers(resolved).length > 0 ? `${base}Params` : undefined;

  const inline: Array<{ name: string; schema: SchemaObject }> = [];
  // A $ref body is its component's type; an inline one, of any shape, is
  // generated under the operation's name.
  const nameBody = (body: OperationBody | undefined, inlineName: string): string | undefined => {
    if (!body) return undefined;
    if (isReference(body.schema)) return getRefName(body.schema.$ref);
    inline.push({ name: inlineName, schema: body.schema });
    return inlineName;
  };

  const body = nameBody(resolved.body, `${base}Body`);
  const response = nameBody(resolved.success.body, `${base}Response`);
  // Another response's inline body is named by its status: <base>404Response,
  // <base>4XXResponse, <base>DefaultResponse.
  const otherResponses = resolved.otherResponses.flatMap(({ statusCode, body: responseBody }) => {
    const suffix = statusCode === 'default' ? 'Default' : statusCode;
    const type = nameBody(responseBody, `${base}${suffix}Response`);
    return type ? [{ statusCode, type }] : [];
  });

  return { base, input: `${base}Input`, params, body, response, otherResponses, inline };
}

/**
 * Generate parameter types for operations
 */
function generateOperationTypes(spec: OpenAPISpec): string {
  const lines: string[] = [];
  const generatedTypes = new Set<string>();

  for (const [apiPath, pathItem] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (!operation) continue;

      const resolved = resolveOperation(spec, apiPath, method);
      const { input: inputTypeName, params: paramsTypeName, body: bodyTypeName, inline } =
        operationTypeNames(operation, resolved);

      if (paramsTypeName && !generatedTypes.has(paramsTypeName)) {
        generatedTypes.add(paramsTypeName);
        lines.push(generateParamsType(paramsTypeName, paramsTypeMembers(resolved), spec));
        lines.push('');
      }

      // An inline body or response schema needs its type emitted; a $ref one
      // names an existing component schema.
      for (const { name, schema } of inline) {
        if (generatedTypes.has(name)) continue;
        generatedTypes.add(name);
        lines.push(generateSchemaType(name, schema, spec));
        lines.push('');
      }

      // Generate Input type that combines params and body
      // - params are flattened (path + query combined)
      // - body becomes 'data' (not HTTP-specific)
      // - Always generate (empty object for parameterless operations)
      if (!generatedTypes.has(inputTypeName)) {
        generatedTypes.add(inputTypeName);
        lines.push(generateInputType(inputTypeName, paramsTypeName, bodyTypeName));
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

/**
 * Generate Input type that combines params and body
 * - params (path + query) are flattened (HTTP details hidden)
 * - body is renamed to 'data' (not HTTP-specific naming)
 * - parameterless operations get empty object type
 * 
 * Examples:
 *   - No params: type Input = Record<string, never>;  (empty object)
 *   - Params only: type Input = Params;
 *   - Body only: type Input = { data: Body };
 *   - Params + Body: type Input = Params & { data: Body };
 */
function generateInputType(
  name: string,
  paramsType?: string,
  bodyType?: string
): string {
  const parts: string[] = [];
  
  // Flatten params (path + query parameters become direct properties)
  if (paramsType) {
    parts.push(paramsType);
  }
  
  // Body becomes 'data' property (not HTTP-specific naming)
  if (bodyType) {
    parts.push(`{ data: ${bodyType} }`);
  }
  
  // Generate type alias
  if (parts.length === 0) {
    // Parameterless operation: empty object type
    return `export type ${name} = Record<string, never>;`;
  } else if (parts.length === 1) {
    return `export type ${name} = ${parts[0]};`;
  } else {
    return `export type ${name} = ${parts.join(' & ')};`;
  }
}

/**
 * Generate params interface (combines path + query parameters)
 */
function generateParamsType(
  name: string,
  params: ParameterObject[],
  spec: OpenAPISpec
): string {
  const lines: string[] = [];
  lines.push(`export interface ${name} {`);

  for (const param of params) {
    const optional = param.required ? '' : '?';
    let tsType = 'unknown';
    
    if (param.schema) {
      tsType = schemaToTypeString(param.schema, spec);
    }
    
    if (param.description) {
      lines.push(`  /** ${param.description} */`);
    }
    lines.push(`  ${formatPropertyKey(param.name)}${optional}: ${tsType};`);
  }

  lines.push('}');
  return lines.join('\n');
}

/**
 * Render a name as a TypeScript property key. Schema property names (and
 * overlay names) are arbitrary strings, so names that are not identifiers
 * are emitted as quoted keys.
 */
export function formatPropertyKey(name: string): string {
  return isTsIdentifier(name) ? name : literalType(name);
}

/** A JSON value as the TypeScript literal type admitting exactly that value. */
function literalType(value: unknown): string {
  if (typeof value === 'string') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
  return JSON.stringify(value);
}

