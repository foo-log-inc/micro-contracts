/**
 * OpenAPI Overlay Processor
 * 
 * Implements OpenAPI Overlay Specification for cross-cutting concerns.
 * Parses overlays and applies transformations to OpenAPI specs.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { MICRO_CONTRACTS_OPERATION_EXTENSIONS } from '../types.js';
import type { OpenAPISpec, OperationObject, ParameterObject, ResponseObject } from '../types.js';

// =============================================================================
// Types
// =============================================================================

interface OverlaySpec {
  overlay: string;  // Version (e.g., "1.0.0")
  info: {
    title: string;
    version: string;
  };
  actions: OverlayAction[];
}

interface OverlayAction {
  target: string;  // JSONPath-like selector
  description?: string;
  update?: Record<string, unknown>;
  /** Explicit name for this overlay action (used for type generation) */
  'x-micro-contracts-overlay-name'?: string;
}

/** Every key an overlay action may carry. Anything else is a typo or an invented setting. */
const ACTION_KEYS = ['target', 'description', 'update', 'x-micro-contracts-overlay-name'];

export interface ExtensionInfo {
  /** Extension name (e.g., 'requireAuth', 'tenantIsolation') */
  name: string;
  /** Extension marker the target selects on (e.g., 'x-middleware'); absent for `$.paths[*][*]` */
  marker?: string;
  /** Operations the target selected, keyed by {@link operationKey} */
  appliesTo: Set<string>;
  /** Parameters injected by this extension */
  injectedParameters: ParameterObject[];
  /** Responses injected by this extension */
  injectedResponses: Record<string, ResponseObject>;
}

/**
 * Key an operation is recorded under in {@link ExtensionInfo.appliesTo}.
 *
 * The overlay target is the only thing that decides which operations an overlay
 * covers. Consumers read that decision back through this key instead of
 * re-deriving it from the operation's marker, which could not see an overlay
 * whose name differs from the marker value — or one selected by `$.paths[*][*]`,
 * which has no marker at all.
 */
export function operationKey(apiPath: string, method: string): string {
  return `${method} ${apiPath}`;
}

export interface OverlayResult {
  /** Transformed OpenAPI spec */
  spec: OpenAPISpec;
  /** Extension information extracted from overlays */
  extensionInfo: Map<string, ExtensionInfo>;
  /** List of applied overlays */
  appliedOverlays: string[];
  /** Application log */
  log: OverlayApplicationLog[];
}

interface OverlayApplicationLog {
  overlay: string;
  target: string;
  path: string;
  method: string;
  changes: string[];
}

export interface OverlayConfig {
  /** Collision policy: error | warn | last-wins */
  collision?: 'error' | 'warn' | 'last-wins';
  /** Overlay files to apply in order */
  files: string[];
}

// =============================================================================
// Overlay Processor
// =============================================================================

/**
 * Process overlays and apply to OpenAPI spec
 * 
 * @param spec - Source OpenAPI spec
 * @param overlayConfig - Overlay configuration
 * @param basePath - Base path for resolving overlay file paths
 * @param specPath - Path to the source spec file (for $ref rebasing)
 */
export function processOverlays(
  spec: OpenAPISpec,
  overlayConfig: OverlayConfig,
  basePath: string = process.cwd(),
  specPath?: string
): OverlayResult {
  const result: OverlayResult = {
    spec: JSON.parse(JSON.stringify(spec)),  // Deep clone
    extensionInfo: new Map(),
    appliedOverlays: [],
    log: [],
  };

  const collision = overlayConfig.collision || 'error';
  const injectedKeys = new Map<string, { overlay: string; content: unknown }>();

  // Target directory for $ref rebasing (where transformed spec will be written)
  const targetDir = specPath ? path.dirname(path.resolve(basePath, specPath)) : undefined;

  for (const overlayFile of overlayConfig.files) {
    const overlayPath = path.resolve(basePath, overlayFile);
    
    if (!fs.existsSync(overlayPath)) {
      // Skipping would generate artifacts without the overlay's injections
      // (middleware, auth, headers) and still report success.
      throw new Error(`Overlay file not found: ${overlayFile} (resolved to ${overlayPath})`);
    }

    const overlayContent = fs.readFileSync(overlayPath, 'utf-8');
    const overlay = yaml.load(overlayContent) as OverlaySpec;
    const overlayDir = path.dirname(overlayPath);

    result.appliedOverlays.push(overlayFile);

    for (const action of overlay.actions) {
      applyAction(
        result,
        overlay,
        action,
        overlayFile,
        collision,
        injectedKeys,
        overlayDir,
        targetDir
      );
    }
  }

  return result;
}

/**
 * Apply a single overlay action
 */
function applyAction(
  result: OverlayResult,
  _overlay: OverlaySpec,
  action: OverlayAction,
  overlayFile: string,
  collision: 'error' | 'warn' | 'last-wins',
  injectedKeys: Map<string, { overlay: string; content: unknown }>,
  overlayDir?: string,
  targetDir?: string
): void {
  const { target, update } = action;

  validateAction(action, overlayFile);

  // Parse the target JSONPath pattern
  const parsed = parseTarget(target);
  if (!parsed) {
    // Returning here would apply nothing for this action and still succeed.
    throw new Error(
      `Overlay '${overlayFile}' has an unsupported target: ${target}. ` +
      `Supported form: $.paths[*][*][?(@.x-<marker> contains '<value>')]`
    );
  }

  // Find matching operations
  const matches = findMatchingOperations(result.spec, parsed);

  for (const match of matches) {
    const { path: apiPath, method, operation } = match;
    const changes: string[] = [];

    if (update) {
      // Apply updates (parameters, responses)
      if (update.parameters) {
        const params = update.parameters as ParameterObject[];
        for (const param of params) {
          // Rebase $ref paths in parameter
          const rebasedParam = rebaseRefs(param, overlayDir, targetDir);
          const key = `${apiPath}:${method}:param:${rebasedParam.name}`;
          checkCollision(key, rebasedParam, overlayFile, collision, injectedKeys);
          
          if (!operation.parameters) {
            operation.parameters = [];
          }
          // Avoid duplicates
          const existing = operation.parameters.findIndex(
            p => !('$ref' in p) && p.name === rebasedParam.name && p.in === rebasedParam.in
          );
          if (existing >= 0) {
            operation.parameters[existing] = rebasedParam;
          } else {
            operation.parameters.push(rebasedParam);
          }
          changes.push(`+${rebasedParam.name} (${rebasedParam.in})`);
        }
      }

      if (update.responses) {
        const responses = update.responses as Record<string, ResponseObject>;
        for (const [statusCode, response] of Object.entries(responses)) {
          // Rebase $ref paths in response
          const rebasedResponse = rebaseRefs(response, overlayDir, targetDir);
          const key = `${apiPath}:${method}:response:${statusCode}`;
          checkCollision(key, rebasedResponse, overlayFile, collision, injectedKeys);
          
          operation.responses[statusCode] = rebasedResponse as ResponseObject;
          changes.push(`+${statusCode}`);
        }
      }

      for (const [key, value] of Object.entries(update)) {
        if (key === 'parameters' || key === 'responses') continue;
        const rebasedValue = rebaseRefs(value, overlayDir, targetDir);
        const collisionKey = `${apiPath}:${method}:${key}`;
        checkCollision(collisionKey, rebasedValue, overlayFile, collision, injectedKeys);
        (operation as unknown as Record<string, unknown>)[key] = rebasedValue;
        changes.push(`+${key}`);
      }
    }

    // Log the application
    result.log.push({
      overlay: overlayFile,
      target,
      path: apiPath,
      method,
      changes,
    });

    // Extract extension info
    extractExtensionInfo(result.extensionInfo, parsed, action, apiPath, method);
  }
}

/**
 * Reject action keys and injected extensions that nothing reads.
 *
 * An overlay that is accepted but does nothing is the worst outcome: the
 * declaration sits in the spec repository looking enforced while the generated
 * code carries none of it.
 */
function validateAction(action: OverlayAction, overlayFile: string): void {
  const unknownKeys = Object.keys(action).filter(key => !ACTION_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(
      `Overlay '${overlayFile}' has unsupported action ${unknownKeys.length === 1 ? 'key' : 'keys'}: ` +
      `${unknownKeys.join(', ')}. Supported keys: ${ACTION_KEYS.join(', ')}. ` +
      `Narrow an overlay through its target, not through a key the generator does not read.`
    );
  }

  for (const key of Object.keys(action.update ?? {})) {
    if (key.startsWith('x-micro-contracts-') && !MICRO_CONTRACTS_OPERATION_EXTENSIONS.includes(key)) {
      throw new Error(
        `Overlay '${overlayFile}' injects '${key}', which nothing reads. ` +
        `The x-micro-contracts-* namespace belongs to the generator; injectable keys are ` +
        `${MICRO_CONTRACTS_OPERATION_EXTENSIONS.join(', ')}. ` +
        `To generate handlers for the selected operations, name the action with ` +
        `x-micro-contracts-overlay-name; to carry your own data, use your own x-* key.`
      );
    }
  }
}

/**
 * Parse overlay target into structured format
 * Supports: $.paths[*][*][?(@.x-ext contains 'value')]
 */
interface ParsedTarget {
  extensionMarker?: string;
  extensionValue?: string;
}

function parseTarget(target: string): ParsedTarget | null {
  // Pattern: $.paths[*][*][?(@.x-ext contains 'value')]
  const containsMatch = target.match(
    /\$\.paths\[\*\]\[\*\]\[\?\(@\.(x-[a-z-]+)\s+contains\s+'([^']+)'\)\]/
  );
  
  if (containsMatch) {
    return {
      extensionMarker: containsMatch[1],
      extensionValue: containsMatch[2],
    };
  }

  // Pattern: $.paths[*][*][?(@.x-ext)]
  const existsMatch = target.match(
    /\$\.paths\[\*\]\[\*\]\[\?\(@\.(x-[a-z-]+)\)\]/
  );
  
  if (existsMatch) {
    return {
      extensionMarker: existsMatch[1],
    };
  }

  // Simple pattern: $.paths[*][*]
  if (target === '$.paths[*][*]') {
    return {};
  }

  return null;
}

/**
 * Find operations matching the parsed target
 */
interface MatchedOperation {
  path: string;
  method: string;
  operation: OperationObject;
}

function findMatchingOperations(
  spec: OpenAPISpec,
  parsed: ParsedTarget
): MatchedOperation[] {
  const matches: MatchedOperation[] = [];
  const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

  for (const [apiPath, pathItem] of Object.entries(spec.paths)) {
    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation) continue;

      // Check if operation matches the target
      if (parsed.extensionMarker) {
        const extValue = (operation as unknown as Record<string, unknown>)[parsed.extensionMarker];
        
        if (!extValue) continue;
        
        if (parsed.extensionValue) {
          // Check if array contains the value
          if (Array.isArray(extValue)) {
            if (!extValue.includes(parsed.extensionValue)) continue;
          } else if (extValue !== parsed.extensionValue) {
            continue;
          }
        }
      }

      matches.push({ path: apiPath, method, operation });
    }
  }

  return matches;
}

/**
 * Rebase $ref paths in an object from source directory to target directory
 * 
 * @param obj - Object that may contain $ref properties
 * @param sourceDir - Directory where the source file is located (e.g., overlay or OpenAPI source)
 * @param targetDir - Directory where the output file will be written
 * @returns Object with rebased $ref paths
 */
export function rebaseRefs<T>(obj: T, sourceDir?: string, targetDir?: string): T {
  if (!sourceDir || !targetDir) {
    return obj;
  }

  // Deep clone and rebase
  return rebaseRefsRecursive(JSON.parse(JSON.stringify(obj)), sourceDir, targetDir) as T;
}

function rebaseRefsRecursive(obj: unknown, overlayDir: string, targetDir: string): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => rebaseRefsRecursive(item, overlayDir, targetDir));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (key === '$ref' && typeof value === 'string') {
        // Rebase the $ref path
        result[key] = rebaseRefPath(value, overlayDir, targetDir);
      } else {
        result[key] = rebaseRefsRecursive(value, overlayDir, targetDir);
      }
    }
    return result;
  }

  return obj;
}

/**
 * Rebase a single $ref path from overlay directory to target directory
 * 
 * @param refPath - The $ref value (e.g., '../openapi/problem-details.yaml#/components/schemas/X')
 * @param overlayDir - Directory where the overlay file is located
 * @param targetDir - Directory where the transformed spec will be written
 * @returns Rebased $ref path
 */
function rebaseRefPath(refPath: string, overlayDir: string, targetDir: string): string {
  // Handle internal references (start with #)
  if (refPath.startsWith('#')) {
    return refPath;
  }

  // Split $ref into file path and JSON pointer
  const [filePath, jsonPointer] = refPath.split('#');
  
  // If no file path, it's a pure JSON pointer
  if (!filePath) {
    return refPath;
  }

  // Resolve the absolute path of the referenced file
  const absoluteRefPath = path.resolve(overlayDir, filePath);
  
  // Calculate the relative path from target directory
  const relativePath = path.relative(targetDir, absoluteRefPath);
  
  // Normalize to forward slashes (for cross-platform compatibility)
  const normalizedPath = relativePath.split(path.sep).join('/');
  
  // Reconstruct the $ref
  return jsonPointer ? `${normalizedPath}#${jsonPointer}` : normalizedPath;
}

/**
 * Check for collision and handle according to policy
 */
function checkCollision(
  key: string,
  content: unknown,
  overlayFile: string,
  collision: 'error' | 'warn' | 'last-wins',
  injectedKeys: Map<string, { overlay: string; content: unknown }>
): void {
  const existing = injectedKeys.get(key);
  
  if (existing) {
    const contentStr = JSON.stringify(content);
    const existingStr = JSON.stringify(existing.content);
    
    if (contentStr === existingStr) {
      // Identical content - idempotent, allow
      return;
    }
    
    const message = `Overlay collision at ${key}: ${existing.overlay} vs ${overlayFile}`;
    
    switch (collision) {
      case 'error':
        throw new Error(message);
      case 'warn':
        console.warn(`Warning: ${message}`);
        break;
      case 'last-wins':
        // Just overwrite
        break;
    }
  }
  
  injectedKeys.set(key, { overlay: overlayFile, content });
}

/**
 * Extract extension information from overlay action
 */
function extractExtensionInfo(
  extensionInfo: Map<string, ExtensionInfo>,
  parsed: ParsedTarget,
  action: OverlayAction,
  apiPath: string,
  method: string
): void {
  const { update } = action;
  if (!update) return;

  // The name is what handlers, interfaces and the registry are generated under.
  // A marker target names itself through the value it selects on; `$.paths[*][*]`
  // has no such value, so an action that wants handlers says so with
  // x-micro-contracts-overlay-name. An unnamed action injects into the spec only
  // (see examples/spec/_shared/overlays/correlation-id.overlay.yaml).
  const overlayName = action['x-micro-contracts-overlay-name'] || parsed.extensionValue;
  if (!overlayName) return;

  const key = parsed.extensionMarker ? `${parsed.extensionMarker}:${overlayName}` : overlayName;

  if (!extensionInfo.has(key)) {
    extensionInfo.set(key, {
      name: overlayName,
      marker: parsed.extensionMarker,
      appliesTo: new Set(),
      injectedParameters: [],
      injectedResponses: {},
    });
  }

  const info = extensionInfo.get(key)!;
  info.appliesTo.add(operationKey(apiPath, method));
  
  if (update.parameters) {
    const params = update.parameters as ParameterObject[];
    for (const param of params) {
      // Avoid duplicates
      if (!info.injectedParameters.find(p => p.name === param.name)) {
        info.injectedParameters.push(param);
      }
    }
  }
  
  if (update.responses) {
    const responses = update.responses as Record<string, ResponseObject>;
    Object.assign(info.injectedResponses, responses);
  }
}

// =============================================================================
// Overlay Interface Generation
// =============================================================================

/**
 * Generate TypeScript interfaces for overlays
 * 
 * These interfaces are HTTP-agnostic. The HTTP layer (routes template)
 * extracts parameters from the request and passes them to overlay handlers.
 */
export function generateExtensionInterfaces(
  extensionInfo: Map<string, ExtensionInfo>
): string {
  const lines: string[] = [];
  
  lines.push('/**');
  lines.push(' * Overlay Interfaces');
  lines.push(' * Auto-generated from overlay specifications');
  lines.push(' * DO NOT EDIT MANUALLY');
  lines.push(' * ');
  lines.push(' * These interfaces are HTTP-agnostic. Overlay handlers receive');
  lines.push(' * extracted parameters and return success/failure with optional context.');
  lines.push(' */');
  lines.push('');

  // Generate common result type
  lines.push('// =============================================================================');
  lines.push('// Common Types');
  lines.push('// =============================================================================');
  lines.push('');
  lines.push('/**');
  lines.push(' * Result returned by overlay handlers');
  lines.push(' * - success: true → continue to next handler/service');
  lines.push(' * - success: false → return error response');
  lines.push(' */');
  lines.push('export interface OverlayResult<TContext = unknown> {');
  lines.push('  success: boolean;');
  lines.push('  error?: {');
  lines.push('    status: number;');
  lines.push('    message: string;');
  lines.push('    code?: string;');
  lines.push('  };');
  lines.push('  /** Context passed to subsequent handlers and service */');
  lines.push('  context?: TContext;');
  lines.push('}');
  lines.push('');

  // Group by marker. A marker block types the marker's own value union, so an
  // overlay selected by `$.paths[*][*]` — which has no marker — has no block.
  const byMarker = new Map<string, ExtensionInfo[]>();
  const markerless: ExtensionInfo[] = [];
  for (const info of extensionInfo.values()) {
    if (!info.marker) {
      markerless.push(info);
      continue;
    }
    if (!byMarker.has(info.marker)) {
      byMarker.set(info.marker, []);
    }
    byMarker.get(info.marker)!.push(info);
  }

  // Generate interfaces for each marker
  for (const [marker, extensions] of byMarker) {
    const markerName = markerToTypeName(marker);
    
    lines.push(`// =============================================================================`);
    lines.push(`// ${markerName} Overlays`);
    lines.push(`// =============================================================================`);
    lines.push('');

    // Generate value type
    const values = extensions.map(e => `'${e.name}'`).join(' | ');
    lines.push(`export type ${markerName}Value = ${values};`);
    lines.push('');

    // Generate input and handler types for each extension
    for (const ext of extensions) {
      pushOverlayTypes(lines, ext);
    }

    // Generate registry interface
    const registryName = `${markerName}Registry`;
    lines.push(`/**`);
    lines.push(` * Registry interface for ${marker} overlay handlers`);
    lines.push(` */`);
    lines.push(`export interface ${registryName} {`);
    for (const ext of extensions) {
      const handlerName = `${capitalize(ext.name)}Overlay`;
      lines.push(`  ${ext.name}: ${handlerName};`);
    }
    lines.push(`}`);
    lines.push('');
  }

  if (markerless.length > 0) {
    lines.push(`// =============================================================================`);
    lines.push(`// Overlays applied to every operation`);
    lines.push(`// =============================================================================`);
    lines.push('');

    for (const ext of markerless) {
      pushOverlayTypes(lines, ext);
    }
  }

  const allExtensions = [...[...byMarker.values()].flat(), ...markerless];

  // Generate unified OverlayRegistry (combines all markers)
  lines.push('// =============================================================================');
  lines.push('// Unified Overlay Registry');
  lines.push('// =============================================================================');
  lines.push('');
  lines.push('/**');
  lines.push(' * Combined registry interface for all overlay handlers');
  lines.push(' * Use this when a single handler registry is needed');
  lines.push(' */');
  lines.push('export interface OverlayRegistry {');
  for (const ext of allExtensions) {
    const handlerName = `${capitalize(ext.name)}Overlay`;
    lines.push(`  ${ext.name}: ${handlerName};`);
  }
  lines.push('}');
  lines.push('');

  // Generate combined extension info type
  lines.push('// =============================================================================');
  lines.push('// Overlay Info (for templates)');
  lines.push('// =============================================================================');
  lines.push('');
  lines.push('export interface OverlayInfoMap {');
  for (const [key, info] of extensionInfo) {
    lines.push(`  '${key}': {`);
    lines.push(`    name: '${info.name}';`);
    if (info.marker) {
      lines.push(`    marker: '${info.marker}';`);
    }
    lines.push(`    injectedParameters: ${JSON.stringify(info.injectedParameters.map(p => p.name))};`);
    lines.push(`    injectedResponses: ${JSON.stringify(Object.keys(info.injectedResponses))};`);
    lines.push(`  };`);
  }
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

/**
 * Emit the input and handler types for one overlay.
 *
 * Every overlay gets these, whether a marker or `$.paths[*][*]` selected it.
 */
function pushOverlayTypes(lines: string[], ext: ExtensionInfo): void {
  const inputName = `${capitalize(ext.name)}OverlayInput`;
  const handlerName = `${capitalize(ext.name)}Overlay`;

  // Generate input type from injected parameters
  lines.push(`/**`);
  lines.push(` * Input for ${ext.name} overlay`);
  lines.push(` * Parameters extracted from HTTP request by the routes layer`);
  lines.push(` */`);
  lines.push(`export interface ${inputName} {`);

  if (ext.injectedParameters.length > 0) {
    for (const param of ext.injectedParameters) {
      const optional = param.required ? '' : '?';
      const tsType = parameterToTsType(param);
      if (param.description) {
        lines.push(`  /** ${param.description} */`);
      }
      // Use OpenAPI parameter name as-is (quoted for names with special chars)
      lines.push(`  '${param.name}'${optional}: ${tsType};`);
    }
  } else {
    // No parameters - empty input
    lines.push(`  // No parameters required`);
  }
  lines.push(`}`);
  lines.push('');

  // Generate handler type
  lines.push(`/**`);
  lines.push(` * Handler for ${ext.name} overlay`);
  if (Object.keys(ext.injectedResponses).length > 0) {
    lines.push(` * May return errors: ${Object.keys(ext.injectedResponses).join(', ')}`);
  }
  lines.push(` */`);
  lines.push(`export type ${handlerName} = (input: ${inputName}) => Promise<OverlayResult>;`);
  lines.push('');
}

/**
 * Convert parameter to TypeScript type
 */
function parameterToTsType(param: ParameterObject): string {
  if (!param.schema) return 'unknown';
  
  const schema = param.schema as { type?: string; format?: string };
  switch (schema.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'unknown[]';
    default:
      return 'unknown';
  }
}

/**
 * Convert marker like 'x-middleware' to type name like 'Middleware'
 */
function markerToTypeName(marker: string): string {
  return marker
    .replace(/^x-/, '')
    .split('-')
    .map(capitalize)
    .join('');
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format overlay application log for console output
 */
export function formatOverlayLog(result: OverlayResult): string {
  const lines: string[] = [];

  for (const overlay of result.appliedOverlays) {
    lines.push(`[overlay] Applying ${overlay}`);
    
    const overlayLogs = result.log.filter(l => l.overlay === overlay);
    for (const log of overlayLogs) {
      lines.push(`  → ${log.path} ${log.method.toUpperCase()}: ${log.changes.join(', ')}`);
    }
  }

  return lines.join('\n');
}

