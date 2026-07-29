/**
 * TypeScript type generator from OpenAPI schemas
 */

import type { 
  OpenAPISpec, 
  SchemaObject, 
  ReferenceObject,
  ParameterObject,
  OperationObject,
  PathItem,
  OpenAPIType,
} from '../types.js';
import { isReference, getRefName, isTsIdentifier } from '../types.js';

/**
 * Normalize OpenAPI 3.1 type arrays into a non-null type and a nullable flag.
 * Returns undefined for type if the schema has no type field.
 */
function normalizeType(schema: SchemaObject): { types: OpenAPIType[]; nullable: boolean } {
  const raw = schema.type;
  if (raw === undefined) {
    return { types: [], nullable: !!schema.nullable };
  }
  const arr = Array.isArray(raw) ? raw : [raw];
  const hasNull = arr.includes('null');
  const nonNull = arr.filter((t): t is OpenAPIType => t !== 'null');
  return { types: nonNull, nullable: hasNull || !!schema.nullable };
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
  if (isReference(schema)) {
    const refName = getRefName(schema.$ref);
    return `export type ${name} = ${refName};`;
  }

  // Handle allOf, oneOf, anyOf
  if (schema.allOf) {
    const types = schema.allOf.map(s => schemaToTypeString(s, spec)).join(' & ');
    return `export type ${name} = ${types};`;
  }
  if (schema.oneOf) {
    const types = schema.oneOf.map(s => schemaToTypeString(s, spec)).join(' | ');
    return `export type ${name} = ${types};`;
  }
  if (schema.anyOf) {
    const types = schema.anyOf.map(s => schemaToTypeString(s, spec)).join(' | ');
    return `export type ${name} = ${types};`;
  }

  const { types, nullable } = normalizeType(schema);

  // Handle object type
  if (types.includes('object') || schema.properties) {
    return generateInterfaceType(name, schema, spec);
  }

  // Handle enum
  if (schema.enum) {
    const enumValues = schema.enum.map(v => 
      typeof v === 'string' ? `'${v}'` : String(v)
    ).join(' | ');
    const suffix = nullable ? ' | null' : '';
    return `export type ${name} = ${enumValues}${suffix};`;
  }

  // Handle array
  if (types.includes('array') && schema.items) {
    const itemType = schemaToTypeString(schema.items, spec);
    const suffix = nullable ? ' | null' : '';
    return `export type ${name} = ${itemType}[]${suffix};`;
  }

  // Handle primitive types (including type arrays like ['string', 'null'])
  const tsType = resolveTypeString(types, schema, nullable);
  return `export type ${name} = ${tsType};`;
}

/**
 * Generate interface type for object schema
 */
function generateInterfaceType(
  name: string, 
  schema: SchemaObject,
  spec: OpenAPISpec
): string {
  const lines: string[] = [];
  const required = new Set(schema.required || []);

  if (schema.description) {
    lines.push(`/** ${schema.description} */`);
  }
  lines.push(`export interface ${name} {`);

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

  lines.push('}');
  return lines.join('\n');
}

/**
 * Convert schema to TypeScript type string
 */
function schemaToTypeString(
  schema: SchemaObject | ReferenceObject,
  spec: OpenAPISpec
): string {
  if (isReference(schema)) {
    return getRefName(schema.$ref);
  }

  const { types, nullable } = normalizeType(schema);
  const nullSuffix = nullable ? ' | null' : '';

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

  // Handle enum
  if (schema.enum) {
    const enumValues = schema.enum.map(v => 
      typeof v === 'string' ? `'${v}'` : String(v)
    ).join(' | ');
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
    return `unknown${nullSuffix}`;
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

/**
 * Generate parameter types for operations
 */
function generateOperationTypes(spec: OpenAPISpec): string {
  const lines: string[] = [];
  const generatedTypes = new Set<string>();

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (!operation) continue;
      
      const baseTypeName = getOperationTypeName(operation);

      // Collect all parameters (path + query) into a single Params type
      const allParams = (operation.parameters || []).filter(
        (p): p is ParameterObject => !isReference(p) && (p.in === 'query' || p.in === 'path')
      );

      let paramsTypeName: string | undefined;
      if (allParams.length > 0) {
        paramsTypeName = `${baseTypeName}Params`;
        if (!generatedTypes.has(paramsTypeName)) {
          generatedTypes.add(paramsTypeName);
          lines.push(generateParamsType(paramsTypeName, allParams, spec));
          lines.push('');
        }
      }

      // Get request body type name
      let bodyTypeName: string | undefined;
      if (operation.requestBody) {
        if (isReference(operation.requestBody)) {
          // Referenced request body - extract name
          bodyTypeName = getRefName(operation.requestBody.$ref);
        } else {
          const content = operation.requestBody.content?.['application/json'];
          if (content?.schema) {
            if (isReference(content.schema)) {
              bodyTypeName = getRefName(content.schema.$ref);
            } else if (content.schema.properties || normalizeType(content.schema).types.includes('object')) {
              // Generate inline body type
              bodyTypeName = `${baseTypeName}Body`;
              if (!generatedTypes.has(bodyTypeName)) {
                generatedTypes.add(bodyTypeName);
                lines.push(generateRequestBodyType(bodyTypeName, content.schema, spec));
                lines.push('');
              }
            }
          }
        }
      }

      // Generate Input type that combines params and body
      // - params are flattened (path + query combined)
      // - body becomes 'data' (not HTTP-specific)
      // - Always generate (empty object for parameterless operations)
      const inputTypeName = `${baseTypeName}Input`;
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
 * Generate request body interface
 */
function generateRequestBodyType(
  name: string,
  schema: SchemaObject,
  spec: OpenAPISpec
): string {
  const lines: string[] = [];
  lines.push(`export interface ${name} {`);

  if (schema.properties) {
    const required = new Set(schema.required || []);
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const isRequired = required.has(propName);
      const optional = isRequired ? '' : '?';
      const tsType = schemaToTypeString(propSchema, spec);
      
      if (isReference(propSchema)) {
        // No description for refs
      } else if ((propSchema as SchemaObject).description) {
        lines.push(`  /** ${(propSchema as SchemaObject).description} */`);
      }
      lines.push(`  ${formatPropertyKey(propName)}${optional}: ${tsType};`);
    }
  }

  lines.push('}');
  return lines.join('\n');
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

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Render an OpenAPI property name as a TypeScript property key.
 * Schema property names are arbitrary strings, so names that are not
 * identifiers are emitted as quoted keys.
 */
export function formatPropertyKey(name: string): string {
  if (isTsIdentifier(name)) return name;
  return `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

