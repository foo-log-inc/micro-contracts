/**
 * OpenAPI specification linter
 * 
 * Validates x-public/x-private constraints
 */

import type { 
  OpenAPISpec, 
  OperationObject,
  SchemaObject,
  LintError,
  ResponseObject,
} from '../types.js';
import { isReference, getRefName, hasPrivateProperties, collectReferencedSchemas, collectReachableComponents, isTsIdentifier } from '../types.js';

export interface LintOptions {
  /** Treat warnings as errors */
  strict?: boolean;
  /** Screen spec mode (suppresses x-micro-contracts-service/method warnings) */
  screen?: boolean;
}

export interface LintResult {
  errors: LintError[];
  warnings: LintError[];
  valid: boolean;
}

/**
 * Lint OpenAPI specification for x-public/x-private violations
 */
export function lintSpec(spec: OpenAPISpec, options: LintOptions = {}): LintResult {
  const errors: LintError[] = [];
  const warnings: LintError[] = [];
  const eventDefs = spec.components?.['x-event-defs'] ?? {};
  
  // Check each operation
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (!operation) continue;
      
      const location = `${method.toUpperCase()} ${path}`;
      
      // Routes, service interfaces and template contexts are all keyed by these
      // extensions: an operation without them is dropped from every artifact.
      // In screen mode operations are consumed via ScreenContext instead.
      if (!options.screen) {
        const service = operation['x-micro-contracts-service'];
        const serviceMethod = operation['x-micro-contracts-method'];

        if (!service) {
          errors.push({
            type: 'error',
            code: 'MISSING_X_SERVICE',
            message: `Missing x-micro-contracts-service extension (operation would be dropped from routes and services)`,
            path,
            location,
          });
        } else if (!isTsIdentifier(service)) {
          errors.push({
            type: 'error',
            code: 'INVALID_X_SERVICE',
            message: `x-micro-contracts-service '${service}' is not a valid TypeScript identifier (used verbatim in generated type and interface names)`,
            path,
            location,
          });
        }

        if (!serviceMethod) {
          errors.push({
            type: 'error',
            code: 'MISSING_X_METHOD',
            message: `Missing x-micro-contracts-method extension (operation would be dropped from routes and services)`,
            path,
            location,
          });
        } else if (!isTsIdentifier(serviceMethod)) {
          errors.push({
            type: 'error',
            code: 'INVALID_X_METHOD',
            message: `x-micro-contracts-method '${serviceMethod}' is not a valid TypeScript identifier (used verbatim in generated method and type names)`,
            path,
            location,
          });
        }
      }
      
      // Screen spec consistency: if x-screen-id is present, require x-screen-const and x-screen-name
      if (operation['x-screen-id']) {
        if (!operation['x-screen-const']) {
          errors.push({
            type: 'error',
            code: 'SCREEN_MISSING_CONST',
            message: `Operation has x-screen-id but missing x-screen-const`,
            path,
            location,
          });
        }
        if (!operation['x-screen-name']) {
          errors.push({
            type: 'error',
            code: 'SCREEN_MISSING_NAME',
            message: `Operation has x-screen-id but missing x-screen-name`,
            path,
            location,
          });
        }
        if (!operation.operationId) {
          errors.push({
            type: 'error',
            code: 'SCREEN_MISSING_OPERATION_ID',
            message: `Screen operation requires operationId`,
            path,
            location,
          });
        }
      }
      
      // Deprecated x-events validation (warn + still validate structure)
      if (operation['x-events']) {
        warnings.push({
          type: 'warning',
          code: 'SCREEN_DEPRECATED_X_EVENTS',
          message: 'x-events (flat list) is deprecated. Use inline x-event instead.',
          path,
          location,
        });
        const events = operation['x-events'];
        if (!Array.isArray(events)) {
          errors.push({
            type: 'error',
            code: 'SCREEN_INVALID_EVENTS',
            message: `x-events must be an array`,
            path,
            location,
          });
        } else {
          for (let i = 0; i < events.length; i++) {
            const event = events[i];
            if (!event.name || !event.type) {
              errors.push({
                type: 'error',
                code: 'SCREEN_INVALID_EVENT',
                message: `x-events[${i}] must have name and type`,
                path,
                location,
              });
            }
          }
        }
      }

      // Conflicting x-events + x-event on same operation
      if (operation['x-events'] && operation['x-event'] != null) {
        errors.push({
          type: 'error',
          code: 'SCREEN_CONFLICTING_EVENT_DEFS',
          message: 'x-events and x-event cannot coexist on the same operation',
          path,
          location,
        });
      }

      // Validate inline x-event on this operation (any method)
      if (operation['x-event'] != null) {
        validateInlineEvent(operation['x-event'], path, location, errors, eventDefs);
      }

      // Validate x-event on links (200 response only, GET operations)
      if (method === 'get') {
        const resp200 = operation.responses?.['200'];
        if (resp200 && !isReference(resp200)) {
          const responseLinks = (resp200 as ResponseObject).links;
          if (responseLinks) {
            for (const [linkName, linkObj] of Object.entries(responseLinks)) {
              if (linkObj['x-event'] != null) {
                validateInlineEvent(
                  linkObj['x-event'],
                  `${path}.responses.200.links.${linkName}`,
                  location,
                  errors,
                  eventDefs,
                );
              }
            }
          }
        }

        // Validate x-interactions
        if (operation['x-interactions']) {
          const interactions = operation['x-interactions'];
          if (!Array.isArray(interactions)) {
            errors.push({
              type: 'error',
              code: 'SCREEN_INVALID_INTERACTIONS',
              message: 'x-interactions must be an array',
              path,
              location,
            });
          } else {
            for (let i = 0; i < interactions.length; i++) {
              if (!interactions[i].name) {
                errors.push({
                  type: 'error',
                  code: 'SCREEN_INVALID_INTERACTION',
                  message: `x-interactions[${i}] must have a name`,
                  path,
                  location,
                });
              }
              if (interactions[i]['x-event'] != null) {
                validateInlineEvent(
                  interactions[i]['x-event'],
                  `${path}.x-interactions[${i}]`,
                  location,
                  errors,
                  eventDefs,
                );
              }
            }
          }
        }
      }

      // Check public endpoints for private schema references
      if (operation['x-micro-contracts-published'] === true) {
        const privateErrors = checkPublicEndpointForPrivate(path, method, operation, spec);
        errors.push(...privateErrors);
        
        // Check for allOf/oneOf/anyOf in public endpoint schemas
        const compositionWarnings = checkPublicEndpointComposition(path, method, operation, spec);
        warnings.push(...compositionWarnings);
      }
    }
  }
  
  // Check schemas for x-private in required (warning - may indicate design issue)
  if (spec.components?.schemas) {
    for (const [schemaName, schema] of Object.entries(spec.components.schemas)) {
      if (isReference(schema)) continue;
      
      const privateInRequired = checkPrivateInRequired(schemaName, schema);
      warnings.push(...privateInRequired);
    }
  }
  
  const valid = errors.length === 0 && (!options.strict || warnings.length === 0);
  
  return { errors, warnings, valid };
}

/**
 * Check if a public endpoint references schemas with x-private properties
 */
function checkPublicEndpointForPrivate(
  path: string,
  method: string,
  operation: OperationObject,
  spec: OpenAPISpec
): LintError[] {
  const errors: LintError[] = [];
  const location = `${method.toUpperCase()} ${path}`;

  // Every part of the operation that reaches a schema is checked, through
  // $ref into any component section, and for every status code: whatever the
  // published contract pulls in must be visible here.
  const sections: Array<{ code: string; label: string; root: unknown }> = [
    { code: 'PUBLIC_ENDPOINT_PRIVATE_REQUEST', label: 'request', root: operation.requestBody },
    { code: 'PUBLIC_ENDPOINT_PRIVATE_RESPONSE', label: 'response', root: operation.responses },
    { code: 'PUBLIC_ENDPOINT_PRIVATE_PARAMETER', label: 'parameter', root: operation.parameters },
  ];

  for (const section of sections) {
    if (!section.root) continue;

    for (const schemaRef of findPrivateSchemas(section.root, spec)) {
      errors.push({
        type: 'error',
        code: section.code,
        message: `Public endpoint references ${section.label} schema "${schemaRef}" with x-private properties`,
        path,
        location,
      });
    }
  }

  return errors;
}

/**
 * Names of private schemas reachable from `root` (part of an operation).
 *
 * Inline schemas are reported as "inline schema"; named ones by component name.
 */
function findPrivateSchemas(root: unknown, spec: OpenAPISpec): string[] {
  const found: string[] = [];

  // Named components reachable from here, including across responses,
  // requestBodies and parameters.
  for (const pointer of collectReachableComponents(root, spec)) {
    const [section, name] = [pointer.slice(0, pointer.indexOf('/')), pointer.slice(pointer.indexOf('/') + 1)];
    if (section !== 'schemas') continue;
    const schema = spec.components?.schemas?.[name];
    if (schema && hasPrivateProperties(schema, spec)) {
      found.push(name);
    }
  }

  // Inline schemas: reachable but unnamed, so they carry no component pointer.
  for (const schema of collectInlineSchemas(root)) {
    if (hasPrivateProperties(schema, spec)) {
      found.push('inline schema');
    }
  }

  return [...new Set(found)];
}

/** Inline (non-$ref) values of `schema` keys anywhere under `root`. */
function collectInlineSchemas(root: unknown): SchemaObject[] {
  const schemas: SchemaObject[] = [];
  const pending: unknown[] = [root];

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node)) {
      pending.push(...node);
      continue;
    }
    const record = node as Record<string, unknown>;
    const schema = record.schema;
    if (schema && typeof schema === 'object' && !isReference(schema)) {
      schemas.push(schema as SchemaObject);
    }
    pending.push(...Object.values(record));
  }

  return schemas;
}

/**
 * Check for allOf/oneOf/anyOf in public endpoint schemas (warning)
 */
function checkPublicEndpointComposition(
  path: string,
  method: string,
  operation: OperationObject,
  spec: OpenAPISpec
): LintError[] {
  const warnings: LintError[] = [];
  const location = `${method.toUpperCase()} ${path}`;
  
  // Collect all referenced schemas
  const referencedSchemas = new Set<string>();
  
  if (operation.requestBody && !isReference(operation.requestBody)) {
    const content = operation.requestBody.content?.['application/json'];
    if (content?.schema) {
      collectReferencedSchemas(content.schema, spec, referencedSchemas);
    }
  }
  
  for (const response of Object.values(operation.responses)) {
    const resp = isReference(response)
      ? spec.components?.responses?.[getRefName(response.$ref)]
      : response;
    
    if (resp?.content?.['application/json']?.schema) {
      collectReferencedSchemas(resp.content['application/json'].schema, spec, referencedSchemas);
    }
  }
  
  // Check each referenced schema for composition
  for (const schemaName of referencedSchemas) {
    const schema = spec.components?.schemas?.[schemaName];
    if (!schema || isReference(schema)) continue;
    
    if (schema.allOf || schema.oneOf || schema.anyOf) {
      warnings.push({
        type: 'warning',
        code: 'PUBLIC_ENDPOINT_COMPOSITION',
        message: `Public endpoint uses schema "${schemaName}" with allOf/oneOf/anyOf (may complicate compatibility)`,
        path,
        location,
      });
    }
  }
  
  return warnings;
}

/**
 * Check if x-private properties are in required array
 * This is a warning because it may indicate a design issue
 * (the schema cannot be promoted to public use without removing the property)
 */
function checkPrivateInRequired(schemaName: string, schema: SchemaObject): LintError[] {
  const warnings: LintError[] = [];
  
  if (!schema.properties || !schema.required) return warnings;
  
  for (const propName of schema.required) {
    const prop = schema.properties[propName];
    if (prop && !isReference(prop) && prop['x-private']) {
      warnings.push({
        type: 'warning',
        code: 'PRIVATE_IN_REQUIRED',
        message: `Schema "${schemaName}" has x-private property "${propName}" in required array (cannot be used in public endpoints)`,
        location: `components/schemas/${schemaName}`,
      });
    }
  }
  
  return warnings;
}

/**
 * Validate an inline x-event value (string, {name}, or {$ref}).
 */
function validateInlineEvent(
  raw: unknown,
  path: string,
  location: string,
  errors: LintError[],
  eventDefs: Record<string, unknown> = {},
): void {
  if (typeof raw === 'string') return; // valid string form
  if (typeof raw !== 'object' || raw === null) {
    errors.push({
      type: 'error',
      code: 'SCREEN_INVALID_X_EVENT',
      message: 'x-event must be a string, object with {name}, or {$ref}',
      path,
      location,
    });
    return;
  }
  const obj = raw as Record<string, unknown>;
  if (!obj.$ref && !obj.name) {
    errors.push({
      type: 'error',
      code: 'SCREEN_INVALID_X_EVENT',
      message: 'x-event object must have either $ref or name',
      path,
      location,
    });
    return;
  }

  if (typeof obj.$ref === 'string' && obj.$ref.startsWith('#/components/x-event-defs/')) {
    const defName = obj.$ref.split('/').pop()!;
    if (!(defName in eventDefs)) {
      errors.push({
        type: 'error',
        code: 'SCREEN_UNKNOWN_EVENT_REF',
        message:
          `x-event references '${obj.$ref}' but components.x-event-defs has no '${defName}' ` +
          `(defined: ${Object.keys(eventDefs).join(', ') || 'none'})`,
        path,
        location,
      });
    }
  }
}

/**
 * Format lint results for console output
 */
export function formatLintResults(result: LintResult): string {
  const lines: string[] = [];
  
  if (result.errors.length > 0) {
    lines.push('Errors:');
    for (const error of result.errors) {
      lines.push(`  ❌ [${error.code}] ${error.message}`);
      if (error.location) lines.push(`     at ${error.location}`);
    }
    lines.push('');
  }
  
  if (result.warnings.length > 0) {
    lines.push('Warnings:');
    for (const warning of result.warnings) {
      lines.push(`  ⚠️  [${warning.code}] ${warning.message}`);
      if (warning.location) lines.push(`     at ${warning.location}`);
    }
    lines.push('');
  }
  
  if (result.valid) {
    lines.push('✅ Lint passed');
  } else {
    lines.push(`❌ Lint failed with ${result.errors.length} error(s)`);
  }
  
  return lines.join('\n');
}

