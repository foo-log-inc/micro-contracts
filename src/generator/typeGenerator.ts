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
  if (!isReference(schema) && !composed && isObjectSchema(schema)) {
    return generateInterfaceType(name, schema, spec);
  }

  return `export type ${name} = ${schemaToTypeString(schema, spec)};`;
}

/**
 * Whether a schema describes an object: it declares the object type, or
 * declares properties or required properties, which only an object has.
 */
function isObjectSchema(schema: SchemaObject): boolean {
  return normalizeType(schema).types.includes('object') || !!schema.properties || !!schema.required?.length;
}

/**
 * The members of an object schema's type: a member for each property, one of
 * type `unknown` for each required property the schema has no schema for (a
 * subschema that only requires it, as a oneOf branch does), and the type of
 * the index signature for the additional properties it allows. A property in
 * `propertyTypes` has that type instead of its schema's.
 */
function objectMembers(
  schema: SchemaObject,
  spec: OpenAPISpec,
  propertyTypes: ReadonlyMap<string, string> = new Map()
): { properties: Array<{ description?: string; member: string }>; additionalType?: string } {
  const required = new Set(schema.required || []);
  const properties: Array<{ description?: string; member: string }> = [];
  const memberTypes: string[] = [];

  for (const [propName, propSchema] of Object.entries(schema.properties ?? {})) {
    const tsType = propertyTypes.get(propName) ?? schemaToTypeString(propSchema, spec);
    const optional = required.has(propName) ? '' : '?';
    const description = isReference(propSchema) ? undefined : propSchema.description;
    properties.push({ description, member: `${formatPropertyKey(propName)}${optional}: ${tsType}` });
    memberTypes.push(tsType, ...(optional ? ['undefined'] : []));
  }
  for (const propName of required) {
    if (!schema.properties || !Object.hasOwn(schema.properties, propName)) {
      properties.push({ member: `${formatPropertyKey(propName)}: unknown` });
      memberTypes.push('unknown');
    }
  }

  if (!schema.additionalProperties) {
    return { properties };
  }
  if (typeof schema.additionalProperties === 'boolean') {
    return { properties, additionalType: 'unknown' };
  }
  // Every property's type has to be assignable to the index signature's type
  // (TS2411), so the index signature admits the properties' types as well.
  const valueType = schemaToTypeString(schema.additionalProperties, spec);
  const union = [...new Set([valueType, ...memberTypes])];
  const additionalType = union.includes('unknown') ? 'unknown' : union.join(' | ');
  return { properties, additionalType };
}

/**
 * Generate the type of an object schema: an interface, or — when the schema is
 * nullable, which an interface cannot express — the same members as a type
 * alias with `| null`. A property in `propertyTypes` has that type instead of
 * its schema's.
 */
function generateInterfaceType(
  name: string, 
  schema: SchemaObject,
  spec: OpenAPISpec,
  propertyTypes: ReadonlyMap<string, string> = new Map()
): string {
  const lines: string[] = [];
  const { nullable } = normalizeType(schema);
  const { properties, additionalType } = objectMembers(schema, spec, propertyTypes);

  if (schema.description) {
    lines.push(`/** ${commentText(schema.description)} */`);
  }
  lines.push(nullable ? `export type ${name} = {` : `export interface ${name} {`);

  for (const { description, member } of properties) {
    if (description) {
      lines.push(`  /** ${commentText(description)} */`);
    }
    lines.push(`  ${member};`);
  }
  if (additionalType) {
    lines.push(`  [key: string]: ${additionalType};`);
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

  // A value of a schema with allOf, oneOf or anyOf is valid against each of
  // them and against the schema's own keywords: its type is the intersection
  // of each keyword's type and the type of the schema without them.
  const compositions: string[] = [];
  if (schema.allOf) {
    compositions.push(`(${schema.allOf.map(s => schemaToTypeString(s, spec)).join(' & ')})`);
  }
  if (schema.oneOf) {
    compositions.push(`(${schema.oneOf.map(s => schemaToTypeString(s, spec)).join(' | ')})`);
  }
  if (schema.anyOf) {
    compositions.push(`(${schema.anyOf.map(s => schemaToTypeString(s, spec)).join(' | ')})`);
  }
  if (compositions.length > 0) {
    // The schema's own keywords, with the null it admits left to nullSuffix
    const own: SchemaObject = { ...schema, type: types.length > 0 ? types : undefined, nullable: undefined };
    delete own.allOf;
    delete own.oneOf;
    delete own.anyOf;
    const ownType = schemaToTypeString(own, spec);
    const parts = ownType === 'unknown' ? compositions
      : [ownType.includes(' | ') ? `(${ownType})` : ownType, ...compositions];
    return `${parts.join(' & ')}${nullSuffix}`;
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
  if (isObjectSchema(schema)) {
    const { properties, additionalType } = objectMembers(schema, spec);
    if (properties.length === 0) {
      return `Record<string, ${additionalType ?? 'unknown'}>${nullSuffix}`;
    }
    const members = properties.map(p => p.member);
    if (additionalType) {
      members.push(`[key: string]: ${additionalType}`);
    }
    return `{ ${members.join('; ')} }${nullSuffix}`;
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

/** The request locations whose parameters are validated, and the suffix of each one's schema. */
const PARAMETER_SCHEMA_SUFFIXES = {
  path: 'PathParams', query: 'QueryParams', header: 'HeaderParams', cookie: 'CookieParams',
} as const;

/**
 * The parameters an operation's Params type is made of: path, query and
 * cookie. Headers are validated but left out of the service's input.
 */
function paramsTypeMembers(resolved: ResolvedOperation): ParameterObject[] {
  return resolved.parameters.filter(p => p.in === 'query' || p.in === 'path' || p.in === 'cookie');
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
  /** The validation schema of the parameters of each request location that has any */
  parameterSchemas: Partial<Record<keyof typeof PARAMETER_SCHEMA_SUFFIXES, string>>;
  /**
   * The input a client calls the operation with, where it differs from the
   * service's: the input with its cookie parameters optional, since the
   * browser sends cookies and a client does not.
   */
  clientInput?: { name: string; cookies: string[] };
  /** The request body's type: its schema's, which validators.ts validates it with */
  body?: string;
  /**
   * For a form body with files: the type the service receives the form as,
   * each file as its bytes (`Uint8Array`) where the schema has a binary string
   */
  form?: string;
  /** The success response's JSON body type; absent when the response has none or streams */
  response?: string;
  /** For a success response that streams, the type of one event */
  event?: string;
  /** The body type of every other response with a body generated code carries */
  otherResponses: Array<{ statusCode: string; type: string }>;
  /** The inline schemas named after the operation, with their names */
  inline: Array<{ name: string; schema: SchemaObject }>;
} {
  const base = getOperationTypeName(operation);
  const params = paramsTypeMembers(resolved).length > 0 ? `${base}Params` : undefined;

  const parameterSchemas: Partial<Record<keyof typeof PARAMETER_SCHEMA_SUFFIXES, string>> = {};
  for (const [location, suffix] of Object.entries(PARAMETER_SCHEMA_SUFFIXES) as Array<[keyof typeof PARAMETER_SCHEMA_SUFFIXES, string]>) {
    if (resolved.parameters.some(p => p.in === location)) parameterSchemas[location] = `${base}${suffix}`;
  }

  const inline: Array<{ name: string; schema: SchemaObject }> = [];
  // A $ref schema is its component's type; an inline one, of any shape, is
  // generated under the operation's name.
  const nameSchema = (schema: SchemaObject | ReferenceObject | undefined, inlineName: string): string | undefined => {
    if (!schema) return undefined;
    if (isReference(schema)) return getRefName(schema.$ref);
    inline.push({ name: inlineName, schema });
    return inlineName;
  };

  const body = nameSchema(resolved.body?.schema, `${base}Body`);
  const form = resolved.body?.kind === 'form' && resolved.body.files.length > 0 ? `${base}Form` : undefined;
  const success = resolved.success.body;
  const response = nameSchema(success?.kind === 'json' ? success.schema : undefined, `${base}Response`);
  const event = nameSchema(success?.kind === 'stream' ? success.event : undefined, `${base}Event`);
  // Another response's inline body is named by its status: <base>404Response,
  // <base>4XXResponse, <base>DefaultResponse.
  const otherResponses = resolved.otherResponses.flatMap(({ statusCode, body: responseBody }) => {
    const suffix = statusCode === 'default' ? 'Default' : statusCode;
    const type = nameSchema(responseBody?.schema, `${base}${suffix}Response`);
    return type ? [{ statusCode, type }] : [];
  });

  const cookies = resolved.parameters.filter(p => p.in === 'cookie').map(p => p.name);
  const clientInput = cookies.length > 0 ? { name: `${base}ClientInput`, cookies } : undefined;

  return { base, input: `${base}Input`, params, parameterSchemas, clientInput, body, form, response, event, otherResponses, inline };
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
      const { input: inputTypeName, params: paramsTypeName, body: bodyTypeName, form: formTypeName, clientInput, inline } =
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

      // A form's files reach the service as bytes: its schema declares them as binary strings
      if (formTypeName && resolved.body?.kind === 'form' && !generatedTypes.has(formTypeName)) {
        generatedTypes.add(formTypeName);
        const fileTypes = new Map(resolved.body.files.map(file => [file.name, file.many ? 'Uint8Array[]' : 'Uint8Array']));
        lines.push(generateInterfaceType(formTypeName, resolved.body.object, spec, fileTypes));
        lines.push('');
      }

      // Generate Input type that combines params and body
      // - params are flattened (path, query and cookie combined)
      // - body becomes 'data' (not HTTP-specific)
      // - Always generate (empty object for parameterless operations)
      if (!generatedTypes.has(inputTypeName)) {
        generatedTypes.add(inputTypeName);
        lines.push(generateInputType(inputTypeName, paramsTypeName, formTypeName ?? bodyTypeName));
        lines.push('');
      }

      // A client's input leaves the cookies out: the browser sends them. It is
      // wider than the service's input, so a client implements the service API.
      if (clientInput && !generatedTypes.has(clientInput.name)) {
        generatedTypes.add(clientInput.name);
        const cookies = clientInput.cookies.map(literalType).join(' | ');
        lines.push(`export type ${clientInput.name} = Omit<${inputTypeName}, ${cookies}> & Partial<Pick<${inputTypeName}, ${cookies}>>;`);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

/**
 * Generate Input type that combines params and body
 * - params (path, query and cookie) are flattened (HTTP details hidden)
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
  
  // Flatten params (path, query and cookie parameters become direct properties)
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
 * Generate params interface (combines path, query and cookie parameters)
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
      lines.push(`  /** ${commentText(param.description)} */`);
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

/**
 * Text from the spec (a description, a summary) as the text of a generated
 * comment: a `*` followed by `/` would close the comment there, so the `/`
 * is escaped (`src/**\/*.ts` reads the same in an editor's hover).
 */
export function commentText(text: string): string {
  return text.replace(/\*\//g, '*\\/');
}

/** A JSON value as the TypeScript literal type admitting exactly that value. */
function literalType(value: unknown): string {
  if (typeof value === 'string') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  }
  return JSON.stringify(value);
}

