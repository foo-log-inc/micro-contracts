/**
 * OpenAPI specification types for code generation
 */

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
    'x-micro-contracts-depend-on'?: string[];  // Module-level dependencies
  };
  servers?: Array<{
    url: string;
    description?: string;
  }>;
  paths: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, SchemaObject>;
    responses?: Record<string, ResponseObject>;
    parameters?: Record<string, ParameterObject>;
    requestBodies?: Record<string, RequestBodyObject>;
    'x-event-defs'?: Record<string, { name?: string; type?: string; params?: Record<string, string> }>;
  };
  tags?: Array<{
    name: string;
    description?: string;
  }>;
}

export interface PathItem {
  get?: OperationObject;
  post?: OperationObject;
  put?: OperationObject;
  patch?: OperationObject;
  delete?: OperationObject;
  parameters?: ParameterObject[];
}

export interface OperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject | ReferenceObject;
  responses: Record<string, ResponseObject | ReferenceObject>;
  security?: Array<Record<string, string[]>>;
  // Custom extensions (canonical names)
  'x-micro-contracts-service'?: string;
  'x-micro-contracts-method'?: string;
  'x-micro-contracts-published'?: boolean;  // Include in contract-published (default: false)
  'x-micro-contracts-depend-on'?: string[];  // Operation-level dependencies
  // Security extensions
  'x-auth'?: 'required' | 'optional' | 'none';
  'x-authz'?: string[];
  'x-middleware'?: string[];
  // Screen spec extensions
  'x-screen-const'?: string;
  'x-screen-id'?: string;
  'x-screen-name'?: string;
  'x-back-navigation'?: boolean;
  /** @deprecated Use inline x-event instead. Will be removed in v0.15. */
  'x-events'?: ScreenEventDefinition[];
  'x-event'?: string | InlineEventRaw;
  'x-interactions'?: InteractionDefinitionRaw[];
  'x-view-model'?: string;
  'x-view-props'?: string;
}

/**
 * Screen analytics event definition (used in x-events)
 * @deprecated Use InlineEventDefinition with inline x-event instead
 */
export interface ScreenEventDefinition {
  /** Event name (e.g., 'home_view') */
  name: string;
  /** Event type (e.g., 'screen_view', 'user_action') */
  type: string;
  /**
   * Generated method name (e.g., 'trackView')
   * @deprecated Will be removed in v0.15
   */
  method?: string;
  /** Event parameters with their types */
  params?: Record<string, string>;
}

/**
 * Inline event declaration (placed on get, links, actions, interactions).
 * `type` is auto-inferred from placement if omitted in YAML.
 */
export interface InlineEventDefinition {
  /** Event name (e.g., 'home_view') */
  name: string;
  /** Event type — resolved from placement or explicit override */
  type: string;
  /** Event parameters (auto-derived for get/links, or explicit) */
  params?: Record<string, string>;
}

/**
 * Raw x-event value as it appears in OpenAPI YAML ($ref not yet resolved).
 */
export type InlineEventRaw =
  | string
  | { name: string; type?: string; params?: Record<string, string> }
  | { $ref: string };

/**
 * Raw x-interactions entry as it appears in OpenAPI YAML.
 * `name` is required. All other fields are optional.
 * Projects may add custom fields which are passed through to templates.
 */
export interface InteractionDefinitionRaw {
  name: string;
  description?: string;
  'x-event'?: string | InlineEventRaw;
  [key: string]: unknown;
}

export interface ParameterObject {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  description?: string;
  required?: boolean;
  schema?: SchemaObject | ReferenceObject;
}

export interface RequestBodyObject {
  description?: string;
  required?: boolean;
  content: Record<string, MediaTypeObject>;
}

export interface ResponseObject {
  description: string;
  content?: Record<string, MediaTypeObject>;
  links?: Record<string, LinkObject>;
}

/**
 * OpenAPI Link Object (used for screen navigation targets)
 */
export interface LinkObject {
  operationId?: string;
  description?: string;
  'x-event'?: string | InlineEventRaw;
}

export interface MediaTypeObject {
  schema?: SchemaObject | ReferenceObject;
}

export interface ReferenceObject {
  $ref: string;
}

/** Primitive OpenAPI type names */
export type OpenAPIType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object' | 'null';

export interface SchemaObject {
  /** OpenAPI 3.0: single type string. OpenAPI 3.1: may be an array (e.g. ['string', 'null']) */
  type?: OpenAPIType | OpenAPIType[];
  format?: string;
  description?: string;
  enum?: Array<string | number | boolean>;
  items?: SchemaObject | ReferenceObject;
  properties?: Record<string, SchemaObject | ReferenceObject>;
  additionalProperties?: boolean | SchemaObject | ReferenceObject;
  required?: string[];
  nullable?: boolean;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  oneOf?: Array<SchemaObject | ReferenceObject>;
  anyOf?: Array<SchemaObject | ReferenceObject>;
  allOf?: Array<SchemaObject | ReferenceObject>;
  // Custom extensions
  'x-private'?: boolean;  // Mark as private (not allowed in public endpoints)
}

// =============================================================================
// Multi-Module Configuration
// =============================================================================

/**
 * Root configuration file structure
 */
export interface MultiModuleConfig {
  /** Default settings for all modules */
  defaults?: ModuleDefaults;

  /** Module definitions */
  modules: Record<string, ModuleConfig>;

  /** Spec directory structure configuration */
  spec?: SpecConfig;
}

/**
 * Spec directory structure configuration
 */
export interface SpecConfig {
  /** Root directory for spec files */
  root?: string;
  /** Shared resources configuration */
  shared?: {
    /** Path to shared OpenAPI schemas */
    openapi?: string;
    /** Path to shared templates */
    templates?: string;
    /** Path to shared overlays */
    overlays?: string;
    /** Path to shared spectral rules */
    spectral?: string;
  };
  /** Overlays to apply (in order) */
  overlays?: string[];
  /** Path to spectral ruleset */
  spectral?: string;
}

/**
 * Default settings applied to all modules (can be overridden per module)
 */
export interface ModuleDefaults {
  /** Contract package output config */
  contract?: {
    /** Output directory (supports {module} placeholder) */
    output: string;
    /** Path to custom Handlebars template for service interface generation */
    serviceTemplate?: string;
  };

  /** Public contract extraction config */
  contractPublic?: {
    /** Output directory (supports {module} placeholder) */
    output: string;
  };

  /** Server output config (legacy) */
  server?: ServerConfig;

  /** Frontend output config (legacy) */
  frontend?: FrontendConfig;

  /** Documentation config */
  docs?: DocsConfig;

  /** Overlay configuration */
  overlays?: OverlayConfig;

  /** Flexible output configuration */
  outputs?: Record<string, OutputConfig>;

  /** Shared module name for overlays */
  sharedModuleName?: string;
}

/**
 * Overlay configuration
 */
export interface OverlayConfig {
  /** Shared overlays applied to all modules */
  shared?: string[];
  /** Collision policy: error | warn | last-wins */
  collision?: 'error' | 'warn' | 'last-wins';
}

/**
 * Output configuration for flexible template-based generation
 */
export interface OutputConfig {
  /** Output file/directory path (supports {module} placeholder) */
  output: string;
  /** Template file path (relative to spec/) */
  template: string;
  /** Don't overwrite if file exists */
  overwrite?: boolean;
  /** Condition for generating this output */
  condition?: 'hasPublicEndpoints' | 'hasOverlays' | 'always';
  /** Enable/disable this output */
  enabled?: boolean;
  /** Template-specific configuration */
  config?: Record<string, unknown>;
}

/**
 * Dependency reference format: {module}.{service}.{method}
 */
export interface DependencyRef {
  module: string;
  service: string;
  method: string;
  raw: string;  // Original string
}

/**
 * Parse dependency reference string
 */
export function parseDependencyRef(ref: string): DependencyRef | null {
  const parts = ref.split('.');
  if (parts.length !== 3) return null;
  return {
    module: parts[0],
    service: parts[1],
    method: parts[2],
    raw: ref,
  };
}

/**
 * Collected dependencies from OpenAPI spec
 */
export interface ModuleDependencies {
  /** Module-level dependencies (from info.x-micro-contracts-depend-on) */
  moduleLevelDeps: DependencyRef[];
  /** Operation-level dependencies */
  operationLevelDeps: Map<string, DependencyRef[]>;  // operationId -> deps
  /** All unique dependencies */
  allDeps: DependencyRef[];
}

/**
 * Per-module configuration
 */
export interface ModuleConfig {
  /** Path to OpenAPI spec file (required) */
  openapi: string;

  /** Enable screen spec mode (parses x-screen-* extensions into ScreenContext) */
  screen?: boolean;

  /** Override contract output */
  contract?: {
    output?: string;
    /** Path to custom Handlebars template for service interface generation */
    serviceTemplate?: string;
  };

  /** Override public contract output */
  contractPublic?: {
    output?: string;
  };

  /** Override server config (legacy) */
  server?: ServerConfig & {
    /** Disable server generation for this module */
    enabled?: boolean;
  };

  /** Override frontend config (legacy) */
  frontend?: FrontendConfig & {
    /** Disable frontend generation for this module */
    enabled?: boolean;
  };

  /** Override docs config */
  docs?: DocsConfig;

  /** Module-specific overlays */
  overlays?: string[];

  /** Module-specific output overrides */
  outputs?: Record<string, Partial<OutputConfig> & { enabled?: boolean }>;

  /** Module-specific Spectral config */
  spectral?: string;

  /** Explicit dependencies (must be subset of OpenAPI x-micro-contracts-depend-on) */
  dependsOn?: string[];
}

/**
 * Server generation config
 */
export interface ServerConfig {
  /** Output file path for the generated routes (supports {module} placeholder) */
  output?: string;
  /** Path to the Handlebars template rendering the routes file */
  template?: string;
  /** Path to services object in Fastify (supports {module} placeholder) */
  servicesPath?: string;
}

/**
 * Frontend generation config
 */
export interface FrontendConfig {
  /** Output directory (supports {module} placeholder) */
  output?: string;
  /** Path to the Handlebars template rendering the client file */
  template?: string;
  /** Client file name */
  client?: string;
  /** Service re-exports file name */
  service?: string;
}

/**
 * Documentation config
 */
export interface DocsConfig {
  /** Enable documentation generation */
  enabled?: boolean;
  /** Template for redoc */
  template?: string;
}

/**
 * Resolved output configuration
 */
export interface ResolvedOutputConfig {
  /** Output ID */
  id: string;
  /** Output file/directory path (placeholders expanded) */
  output: string;
  /** Template file path (resolved) */
  template: string;
  /** Don't overwrite if file exists */
  overwrite: boolean;
  /** Condition for generation */
  condition: 'hasPublicEndpoints' | 'hasOverlays' | 'always';
  /** Enabled */
  enabled: boolean;
  /** Template-specific configuration */
  config: Record<string, unknown>;
}

/**
 * Resolved configuration for a single module (after applying defaults)
 */
export interface ResolvedModuleConfig {
  /** Module name */
  name: string;
  /** Path to OpenAPI spec file */
  openapi: string;
  /** Screen spec mode enabled */
  screen: boolean;
  /** Contract output directory */
  contractOutput: string;
  /** Public contract output directory */
  contractPublicOutput: string;
  /** Custom Handlebars template for service interface generation */
  serviceTemplate?: string;
  /** Server config (null if disabled) - legacy */
  server: {
    /** Output file path for the generated routes */
    output: string;
    servicesPath: string;
    template?: string;
  } | null;
  /** Frontend config (null if disabled) - legacy */
  frontend: {
    /** Output directory holding the client and service re-export files */
    output: string;
    client: string;
    service: string;
    template?: string;
  } | null;
  /** Docs config */
  docs: {
    enabled: boolean;
    template: string;
  };
  /** Overlay files to apply (in order) */
  overlays: string[];
  /** Overlay collision policy */
  overlayCollision: 'error' | 'warn' | 'last-wins';
  /** Resolved outputs (new flexible system) */
  outputs: ResolvedOutputConfig[];
  /** Module-specific Spectral config path */
  spectral?: string;
  /** Config-level dependencies (for validation) */
  dependsOn?: string[];
}

// =============================================================================
// Legacy Single-Module Configuration (deprecated)
// =============================================================================

/**
 * Legacy single-module config
 * @deprecated Use MultiModuleConfig instead
 */
export interface GeneratorConfig {
  /** Module name for service access */
  moduleName?: string;

  /** Contract package output config */
  contract?: {
    /** Output directory for contract package */
    output: string;
    /** Path to OpenAPI spec (relative to module directory) */
    openapi?: string;
  };

  /** Public contract extraction config */
  contractPublic?: {
    /** Output directory for public contract */
    output: string;
  };

  /** Server output config */
  server?: {
    /** Output directory */
    output: string;
    /** Routes file name */
    routes?: string;
  };

  /** Frontend output config */
  frontend?: {
    /** Output directory */
    output: string;
    /** Client file name */
    client?: string;
    /** Shared client path (for contract-published) */
    shared?: string;
  };

  /** Documentation config */
  docs?: {
    /** Enable documentation generation */
    enabled?: boolean;
    /** Template for redoc */
    template?: string;
  };

  // Legacy config (for backward compatibility)
  /** @deprecated Use contract.openapi instead */
  input?: string;
  /** @deprecated Use server.output instead */
  output?: string;
  /** @deprecated */
  generateTypes?: boolean;
  /** @deprecated */
  generateSchemas?: boolean;
  /** @deprecated */
  generateRoutes?: boolean;
}

// =============================================================================
// Config Utilities
// =============================================================================

/**
 * Check if config is multi-module format
 */
export function isMultiModuleConfig(config: unknown): config is MultiModuleConfig {
  return typeof config === 'object' && config !== null && 'modules' in config;
}

// =============================================================================
// Config Validation
// =============================================================================

/**
 * Allowed keys per config object, mirroring the interfaces above.
 *
 * A key absent here is rejected, so a key added to an interface without being
 * added here fails loudly on first use instead of being silently ignored —
 * which is how `server.template` went unnoticed.
 *
 * `'*'` means "any key, each value validated against the given spec"
 * (used for the `modules` and `outputs` records).
 */
type KeySpec = { [key: string]: KeySpec | null };

const SERVER_KEYS: KeySpec = { output: null, template: null, servicesPath: null };
const FRONTEND_KEYS: KeySpec = { output: null, template: null, client: null, service: null };
const OUTPUT_KEYS: KeySpec = {
  output: null, template: null, overwrite: null, condition: null, enabled: null, config: null,
};
const CONTRACT_KEYS: KeySpec = { output: null, serviceTemplate: null };

const MODULE_KEYS: KeySpec = {
  openapi: null,
  screen: null,
  contract: CONTRACT_KEYS,
  contractPublic: { output: null },
  server: { ...SERVER_KEYS, enabled: null },
  frontend: { ...FRONTEND_KEYS, enabled: null },
  docs: { enabled: null, template: null },
  overlays: null,
  outputs: { '*': OUTPUT_KEYS },
  spectral: null,
  dependsOn: null,
};

const CONFIG_KEYS: KeySpec = {
  defaults: {
    contract: CONTRACT_KEYS,
    contractPublic: { output: null },
    server: SERVER_KEYS,
    frontend: FRONTEND_KEYS,
    docs: { enabled: null, template: null },
    overlays: { shared: null, collision: null },
    outputs: { '*': OUTPUT_KEYS },
    sharedModuleName: null,
  },
  modules: { '*': MODULE_KEYS },
  spec: {
    root: null,
    shared: { openapi: null, templates: null, overlays: null, spectral: null },
    overlays: null,
    spectral: null,
  },
};

/** Keys removed from the config format, with the replacement to use instead. */
const REMOVED_KEYS: Record<string, string> = {
  'defaults.templates': 'use defaults.server.template / defaults.frontend.template / defaults.contract.serviceTemplate',
  'defaults.server.routes': 'the file name is part of server.output (e.g. server/src/{module}/routes.generated.ts)',
  'defaults.frontend.shared': 'no longer generated; declare an entry under outputs instead',
};

function collectUnknownKeys(value: unknown, spec: KeySpec, trail: string, found: string[]): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;

  const wildcard = spec['*'];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const keyPath = trail ? `${trail}.${key}` : key;

    if (wildcard !== undefined) {
      if (wildcard) collectUnknownKeys(child, wildcard, keyPath, found);
      continue;
    }

    if (!(key in spec)) {
      // Report against the shape, not the module name, so `modules.a.templates`
      // and `defaults.templates` share one migration hint.
      const shapePath = trail.replace(/^modules\.[^.]+/, 'defaults');
      const hint = REMOVED_KEYS[shapePath ? `${shapePath}.${key}` : key]
        ?? REMOVED_KEYS[`defaults.${key}`];
      found.push(`${keyPath}${hint ? ` (${hint})` : ''}`);
      continue;
    }

    const childSpec = spec[key];
    if (childSpec) collectUnknownKeys(child, childSpec, keyPath, found);
  }
}

/**
 * Reject unknown config keys. A mistyped or removed key must fail loudly:
 * silently ignoring it looks like the setting was honored.
 */
export function validateConfigKeys(config: unknown): void {
  const unknown: string[] = [];
  collectUnknownKeys(config, CONFIG_KEYS, '', unknown);

  if (unknown.length > 0) {
    throw new Error(
      `Unknown configuration ${unknown.length === 1 ? 'key' : 'keys'}:\n` +
      unknown.map(k => `  - ${k}`).join('\n')
    );
  }
}

/**
 * Expand placeholders in a string
 */
export function expandPlaceholders(template: string, moduleName: string): string {
  const pascalCase = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
  const upperSnake = moduleName.toUpperCase().replace(/-/g, '_');
  
  return template
    .replace(/\{module\}/g, moduleName)
    .replace(/\{Module\}/g, pascalCase)
    .replace(/\{MODULE\}/g, upperSnake);
}

/**
 * Resolve outputs configuration
 */
function resolveOutputs(
  moduleName: string,
  moduleConfig: ModuleConfig,
  defaults: ModuleDefaults
): ResolvedOutputConfig[] {
  const expand = (s: string) => expandPlaceholders(s, moduleName);
  const resolvedOutputs: ResolvedOutputConfig[] = [];
  
  // Merge default outputs with module overrides
  const defaultOutputs = defaults.outputs || {};
  const moduleOutputs = moduleConfig.outputs || {};
  
  const allOutputIds = new Set([
    ...Object.keys(defaultOutputs),
    ...Object.keys(moduleOutputs),
  ]);
  
  for (const id of allOutputIds) {
    const defaultConfig = defaultOutputs[id];
    const moduleOverride = moduleOutputs[id];
    
    // Skip if explicitly disabled
    if (moduleOverride?.enabled === false) continue;

    const output = expand(moduleOverride?.output ?? defaultConfig?.output ?? '');
    const template = moduleOverride?.template ?? defaultConfig?.template ?? '';

    // An output that resolves to no file or no template generates nothing:
    // say so instead of skipping it silently.
    if (!output || !template) {
      const missing = [!output && 'output', !template && 'template'].filter(Boolean).join(' and ');
      throw new Error(
        `outputs.${id} for module '${moduleName}' is missing ${missing}. ` +
        `Set it under defaults.outputs.${id} or modules.${moduleName}.outputs.${id}, ` +
        `or disable it with enabled: false.`
      );
    }

    resolvedOutputs.push({
      id,
      output,
      template,
      overwrite: moduleOverride?.overwrite ?? defaultConfig?.overwrite ?? true,
      condition: moduleOverride?.condition ?? defaultConfig?.condition ?? 'always',
      enabled: moduleOverride?.enabled ?? defaultConfig?.enabled ?? true,
      config: {
        ...(defaultConfig?.config || {}),
        ...(moduleOverride?.config || {}),
      },
    });
  }
  
  return resolvedOutputs;
}

/**
 * Resolve module config by applying defaults and expanding placeholders
 */
export function resolveModuleConfig(
  moduleName: string,
  moduleConfig: ModuleConfig,
  defaults: ModuleDefaults = {}
): ResolvedModuleConfig {
  const expand = (s: string) => expandPlaceholders(s, moduleName);
  
  // Contract output
  const contractOutput = expand(
    moduleConfig.contract?.output ?? 
    defaults.contract?.output ?? 
    `packages/contract/${moduleName}`
  );
  
  // Public contract output
  const contractPublicOutput = expand(
    moduleConfig.contractPublic?.output ?? 
    defaults.contractPublic?.output ?? 
    `packages/contract-published/${moduleName}`
  );
  
  // Service template (module overrides defaults)
  const serviceTemplate = moduleConfig.contract?.serviceTemplate ?? defaults.contract?.serviceTemplate;
  
  // Server config (legacy). Only generated when the section is declared:
  // an undeclared section must not demand a template.
  const serverEnabled =
    (moduleConfig.server !== undefined || defaults.server !== undefined) &&
    moduleConfig.server?.enabled !== false;
  const server = serverEnabled ? {
    output: expand(
      moduleConfig.server?.output ??
      defaults.server?.output ??
      `server/src/${moduleName}/routes.generated.ts`
    ),
    template: moduleConfig.server?.template ?? defaults.server?.template,
    servicesPath: expand(
      moduleConfig.server?.servicesPath ??
      defaults.server?.servicesPath ??
      `fastify.services.${moduleName}`
    ),
  } : null;
  
  // Frontend config (legacy). Declared-only, as with server above.
  const frontendEnabled =
    (moduleConfig.frontend !== undefined || defaults.frontend !== undefined) &&
    moduleConfig.frontend?.enabled !== false;
  const frontendDefaults = defaults.frontend;
  const frontendOverride = moduleConfig.frontend;

  const frontend = frontendEnabled ? {
    output: expand(
      frontendOverride?.output ??
      frontendDefaults?.output ??
      `frontend/src/${moduleName}`
    ),
    template: frontendOverride?.template ?? frontendDefaults?.template,
    client: frontendOverride?.client ?? frontendDefaults?.client ?? 'api.generated.ts',
    service: frontendOverride?.service ?? frontendDefaults?.service ?? 'service.generated.ts',
  } : null;

  // Docs config
  const docs = {
    enabled: moduleConfig.docs?.enabled ?? defaults.docs?.enabled ?? true,
    template: moduleConfig.docs?.template ?? defaults.docs?.template ?? 'default',
  };
  
  // Overlays (shared + module-specific)
  const overlays: string[] = [
    ...(defaults.overlays?.shared || []),
    ...(moduleConfig.overlays || []),
  ];
  
  const overlayCollision = defaults.overlays?.collision || 'error';

  // New outputs system
  const outputs = resolveOutputs(moduleName, moduleConfig, defaults);
  
  return {
    name: moduleName,
    openapi: moduleConfig.openapi,
    screen: moduleConfig.screen === true,
    contractOutput,
    contractPublicOutput,
    serviceTemplate,
    server,
    frontend,
    docs,
    overlays,
    overlayCollision,
    outputs,
    spectral: moduleConfig.spectral,
    dependsOn: moduleConfig.dependsOn,
  };
}

// Route info extracted from OpenAPI
export interface RouteInfo {
  path: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  operationId: string;
  service: string;
  serviceMethod: string;
  isPublished: boolean;
  summary?: string;
  tags?: string[];
  queryParams?: ParameterInfo[];
  pathParams?: ParameterInfo[];
  requestBody?: {
    schemaName: string;
    required: boolean;
  };
  responses: ResponseInfo[];
  /** Middleware/overlay names from x-middleware extension */
  overlays?: string[];
}

export interface ParameterInfo {
  name: string;
  required: boolean;
  schemaName?: string;
}

export interface ResponseInfo {
  statusCode: string;
  schemaName?: string;
}

// Service info for interface generation
export interface ServiceInfo {
  name: string;
  methods: ServiceMethodInfo[];
}

export interface ServiceMethodInfo {
  name: string;
  operationId: string;
  httpMethod: string;
  path: string;
  isPublished: boolean;
  requestType?: string;
  responseType?: string;
  /** Params type (path + query combined) */
  paramsType?: string;
  /** All parameters (path, query, header) from the operation */
  parameters: ParameterObject[];
  /** Request body schema name (if exists) */
  requestBodySchema?: string;
  /** All x-* extension properties from the operation */
  extensions: Record<string, unknown>;
}

// Lint result
export interface LintError {
  type: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
  location?: string;
}

// Helper to check if object is a reference
export function isReference(obj: unknown): obj is ReferenceObject {
  return typeof obj === 'object' && obj !== null && '$ref' in obj;
}

/**
 * True when `name` can be emitted verbatim as a TypeScript identifier.
 * Names that fail this must be quoted (property keys) or rejected (type names).
 */
export function isTsIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

// Extract schema name from $ref
export function getRefName(ref: string): string {
  // "#/components/schemas/EntryListResponse" -> "EntryListResponse"
  const parts = ref.split('/');
  return parts[parts.length - 1];
}

/**
 * Extract dependencies from OpenAPI spec
 */
export function extractDependencies(spec: OpenAPISpec): ModuleDependencies {
  const moduleLevelDeps: DependencyRef[] = [];
  const operationLevelDeps = new Map<string, DependencyRef[]>();
  const allDepsSet = new Set<string>();
  
  // Module-level dependencies
  const moduleDepRefs = spec.info['x-micro-contracts-depend-on'] || [];
  for (const ref of moduleDepRefs) {
    const parsed = parseDependencyRef(ref);
    if (parsed) {
      moduleLevelDeps.push(parsed);
      allDepsSet.add(ref);
    }
  }
  
  // Operation-level dependencies
  for (const [, pathItem] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (!operation) continue;
      
      const opId = operation.operationId || '';
      const opDepRefs = operation['x-micro-contracts-depend-on'] || [];
      
      if (opDepRefs.length > 0) {
        const parsedDeps: DependencyRef[] = [];
        for (const ref of opDepRefs) {
          const parsed = parseDependencyRef(ref);
          if (parsed) {
            parsedDeps.push(parsed);
            allDepsSet.add(ref);
          }
        }
        if (parsedDeps.length > 0) {
          operationLevelDeps.set(opId, parsedDeps);
        }
      }
    }
  }
  
  // All unique deps
  const allDeps: DependencyRef[] = [];
  for (const ref of allDepsSet) {
    const parsed = parseDependencyRef(ref);
    if (parsed) allDeps.push(parsed);
  }
  
  return { moduleLevelDeps, operationLevelDeps, allDeps };
}

/**
 * Get canonical extension value (supports both short and long forms)
 */
export function getExtensionValue<T>(
  obj: Record<string, unknown>,
  shortName: string,
  longName: string
): T | undefined {
  return (obj[longName] ?? obj[shortName]) as T | undefined;
}

// Check if a schema contains x-private properties
export function hasPrivateProperties(
  schema: SchemaObject | ReferenceObject,
  spec: OpenAPISpec,
  visited = new Set<string>()
): boolean {
  if (isReference(schema)) {
    const refName = getRefName(schema.$ref);
    if (visited.has(refName)) return false;
    visited.add(refName);
    
    const resolved = spec.components?.schemas?.[refName];
    if (!resolved) return false;
    return hasPrivateProperties(resolved, spec, visited);
  }

  // Check if schema itself is private
  if (schema['x-private']) return true;

  // Check properties
  if (schema.properties) {
    for (const propSchema of Object.values(schema.properties)) {
      if (hasPrivateProperties(propSchema, spec, visited)) return true;
    }
  }

  // Check array items
  if (schema.items) {
    if (hasPrivateProperties(schema.items, spec, visited)) return true;
  }

  // Check allOf/oneOf/anyOf
  for (const composite of [schema.allOf, schema.oneOf, schema.anyOf]) {
    if (composite) {
      for (const s of composite) {
        if (hasPrivateProperties(s, spec, visited)) return true;
      }
    }
  }

  return false;
}

// Collect all schemas referenced by a schema
export function collectReferencedSchemas(
  schema: SchemaObject | ReferenceObject,
  spec: OpenAPISpec,
  result = new Set<string>()
): Set<string> {
  if (isReference(schema)) {
    const refName = getRefName(schema.$ref);
    if (result.has(refName)) return result;
    result.add(refName);
    
    const resolved = spec.components?.schemas?.[refName];
    if (resolved) {
      collectReferencedSchemas(resolved, spec, result);
    }
    return result;
  }

  if (schema.properties) {
    for (const propSchema of Object.values(schema.properties)) {
      collectReferencedSchemas(propSchema, spec, result);
    }
  }

  if (schema.items) {
    collectReferencedSchemas(schema.items, spec, result);
  }

  for (const composite of [schema.allOf, schema.oneOf, schema.anyOf]) {
    if (composite) {
      for (const s of composite) {
        collectReferencedSchemas(s, spec, result);
      }
    }
  }

  if (schema.additionalProperties && typeof schema.additionalProperties !== 'boolean') {
    collectReferencedSchemas(schema.additionalProperties, spec, result);
  }

  return result;
}
