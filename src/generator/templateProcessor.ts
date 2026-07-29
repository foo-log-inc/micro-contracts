/**
 * Template Processor
 * 
 * Provides Handlebars template loading and processing for code generation.
 * Supports custom templates for server routes, frontend clients, etc.
 */

import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import type { OpenAPISpec, OperationObject, ParameterObject, ResponseObject, ScreenEventDefinition, InlineEventDefinition, InlineEventRaw, InteractionDefinitionRaw } from '../types.js';
import type { ExtensionInfo } from './overlayProcessor.js';
import { isReference, getRefName } from '../types.js';

// =============================================================================
// Types
// =============================================================================

export interface TemplateConfig {
  /** Path to server route template */
  server?: string;
  /** Path to frontend client template */
  frontend?: string;
  /** Path to service interface template */
  services?: string;
  /** Custom templates by name */
  custom?: Record<string, string>;
}

export interface TemplateContext {
  /** Module name */
  moduleName: string;
  /** OpenAPI spec (possibly transformed) */
  spec: OpenAPISpec;
  /** OpenAPI title */
  title: string;
  /** OpenAPI version */
  version: string;
  /** Base URL derived from OpenAPI servers[0].url */
  baseUrl: string;
  /** Extension information from overlays */
  extensionInfo: ExtensionInfo[];
  /** Applied overlays */
  appliedOverlays: string[];
  /** Path to services object (e.g., 'fastify.services.core') */
  servicesPath: string;
  /** Contract package import path */
  contractPackage: string;
  /** Routes extracted from spec */
  routes: RouteContext[];
  /** Services grouped from routes (with methods list) */
  services: ServiceContext[];
  /** Service API types for import (e.g., ['UserServiceApi', 'OrderServiceApi']) */
  serviceTypes: string[];
  /** Schema types needed for import */
  schemaTypes: string[];
  /** All schema names */
  schemaNames: string[];
  /** Unique overlays with their parameters (for overlay adapter generation) */
  uniqueOverlays: UniqueOverlayContext[];
  /** Screen contexts extracted from screen spec (populated when screen mode is enabled) */
  screens: ScreenContext[];
}

/**
 * Pre-parsed screen context from OpenAPI screen specification.
 * Populated when module has `screen: true` in config.
 */
export interface ScreenContext {
  /** Route path (e.g., '/home') */
  route: string;
  /** Stable constant name (e.g., 'HOME') from x-screen-const */
  screenConst: string;
  /** Traceability ID (e.g., 'SCR-001') from x-screen-id */
  screenId: string;
  /** Generated symbol name (e.g., 'HomePage') from x-screen-name */
  screenName: string;
  /** OpenAPI operationId (e.g., 'renderHomePage') */
  operationId: string;
  /** Whether back navigation is supported (from x-back-navigation) */
  supportsBack: boolean;
  /** ViewModel schema name (from 200 response $ref or x-view-model) */
  viewModelSchema: string;
  /** Forward navigation targets (from response links) */
  links: ScreenLink[];
  /**
   * Analytics event declarations (from x-events)
   * @deprecated Use screenEvent / links[].event / actions[].event instead
   */
  events: ScreenEventDefinition[];
  /** Whether the screen requires authentication (has non-empty security) */
  requiresAuth: boolean;
  /** Inline event on the GET operation (screen_view) */
  screenEvent?: InlineEventDefinition;
  /** Mutation operations (post/put/patch/delete) with optional inline events */
  actions: ScreenAction[];
  /** Interaction bindings with optional inline events */
  interactions: ScreenInteraction[];
  /** Path parameters of this screen's route */
  pathParams: string[];
}

export interface ScreenLink {
  /** Link key name (e.g., 'goToSettings') */
  name: string;
  /** Target route path */
  targetRoute: string;
  /** Target operationId */
  targetOperationId: string;
  /** Inline event fired on navigation via this link */
  event?: InlineEventDefinition;
}

/** Mutation operation (post/put/patch/delete) on a screen's path */
export interface ScreenAction {
  /** HTTP method (post, put, patch, delete) */
  method: string;
  operationId: string;
  summary: string;
  schemaRef: string;
  event?: InlineEventDefinition;
}

/** In-page interaction binding from x-interactions */
export interface ScreenInteraction {
  name: string;
  description: string;
  event?: InlineEventDefinition;
  /** Project-specific fields passed through from YAML */
  extras: Record<string, unknown>;
}

export interface UniqueOverlayContext {
  name: string;
  params: ExtensionParameterContext[];
}

export interface RouteContext {
  path: string;
  fastifyPath: string;
  /** URL pattern for client (with ${params.xxx} template syntax) */
  clientUrlPattern: string;
  method: string;
  /** HTTP method in uppercase */
  httpMethod: string;
  operationId: string;
  service: string;
  serviceKey: string;
  serviceMethod: string;
  summary?: string;
  tags: string[];
  isPublished: boolean;
  /** Extensions applied to this route */
  extensions: RouteExtension[];
  /** Query parameters */
  queryParams: ParameterContext[];
  /** Path parameters */
  pathParams: ParameterContext[];
  /** Request body info */
  requestBody?: {
    schemaName: string;
    required: boolean;
  };
  /** Response info */
  responses: ResponseContext[];
  /** Type name base for this route (e.g., 'User_getUsers') */
  typeNameBase: string;
  /** Response type (for return type) */
  responseType: string;
  /** Request body type (if exists) */
  requestType?: string;
  /** Params type (path + query combined, if exists) */
  paramsType?: string;
  /** Unified input type (e.g., User_getUsersInput) */
  inputType: string;
  /** URL pattern for client using input object (with ${input.xxx} template syntax) */
  clientUrlPatternInput: string;
  /** Parameters injected by extensions for this route */
  extensionParams: ExtensionParameterContext[];
}

export interface RouteExtension {
  marker: string;
  value: string;
  registryKey: string;  // e.g., 'middlewareRegistry.requireAuth'
}

export interface ExtensionParameterContext {
  extensionName: string;
  name: string;
  location: 'headers' | 'query' | 'params';
  tsType: string;
  required: boolean;
}

export interface ParameterContext {
  name: string;
  required: boolean;
  schemaName?: string;
}

export interface ResponseContext {
  statusCode: string;
  schemaName?: string;
}

export interface ServiceContext {
  name: string;
  key: string;
  methods: string[];
}

// =============================================================================
// Template Processor
// =============================================================================

/**
 * Load and compile a template
 */
export function loadTemplate(templatePath: string): Handlebars.TemplateDelegate {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templatePath}`);
  }
  
  const content = fs.readFileSync(templatePath, 'utf-8');
  return Handlebars.compile(content);
}

/**
 * Build template context from spec and overlay result
 */
export function buildTemplateContext(
  spec: OpenAPISpec,
  moduleName: string,
  options: {
    servicesPath?: string;
    contractPackage?: string;
    extensionInfo?: Map<string, ExtensionInfo>;
    appliedOverlays?: string[];
    screen?: boolean;
  } = {}
): TemplateContext {
  const servicesPath = options.servicesPath || `fastify.services.${moduleName}`;
  const contractPackage = options.contractPackage || `@project/contract/${moduleName}`;
  const extensionInfo = options.extensionInfo 
    ? Array.from(options.extensionInfo.values())
    : [];
  const appliedOverlays = options.appliedOverlays || [];
  
  const routes = extractRoutes(spec, extensionInfo);
  const services = extractServices(routes);
  const schemaNames = Object.keys(spec.components?.schemas || {});
  
  // Extract base URL from OpenAPI servers
  const baseUrl = extractBaseUrl(spec);
  
  // Extract service types for imports (e.g., 'UserServiceApi')
  const serviceTypes = services.map(s => `${s.name}ServiceApi`);
  
  // Extract schema types needed for imports
  const schemaTypes = extractSchemaTypes(routes);

  // Extract unique overlays with their parameters (deduplicated)
  const uniqueOverlays = extractUniqueOverlays(routes);

  // Extract screen contexts when screen mode is enabled
  const screens = options.screen ? extractScreens(spec) : [];

  return {
    moduleName,
    spec,
    title: spec.info.title,
    version: spec.info.version,
    baseUrl,
    extensionInfo,
    appliedOverlays,
    servicesPath,
    contractPackage,
    routes,
    services,
    serviceTypes,
    schemaTypes,
    schemaNames,
    uniqueOverlays,
    screens,
  };
}

/**
 * Extract unique overlays from routes (deduplicated by overlay name)
 */
function extractUniqueOverlays(routes: RouteContext[]): UniqueOverlayContext[] {
  const overlayMap = new Map<string, ExtensionParameterContext[]>();

  for (const route of routes) {
    for (const ext of route.extensions) {
      if (!overlayMap.has(ext.value)) {
        // Find params for this overlay
        const params = route.extensionParams.filter(p => p.extensionName === ext.value);
        overlayMap.set(ext.value, params);
      }
    }
  }

  return Array.from(overlayMap.entries()).map(([name, params]) => ({ name, params }));
}

/**
 * Extract base URL from OpenAPI servers field
 * Returns path portion only (e.g., '/api' from 'http://localhost:3000/api')
 */
function extractBaseUrl(spec: OpenAPISpec): string {
  const servers = spec.servers;
  if (!servers || servers.length === 0) {
    return '';
  }
  
  const serverUrl = servers[0].url;
  try {
    // Try to parse as full URL
    const url = new URL(serverUrl);
    // Return pathname, removing trailing slash
    return url.pathname.replace(/\/$/, '');
  } catch {
    // If not a valid URL, assume it's already a path
    return serverUrl.replace(/\/$/, '');
  }
}

/**
 * Extract all schema types needed for client imports
 */
function extractSchemaTypes(routes: RouteContext[]): string[] {
  const types = new Set<string>();
  types.add('ProblemDetails'); // Always needed for error handling
  
  for (const route of routes) {
    if (route.requestBody?.schemaName) {
      types.add(route.requestBody.schemaName);
    }
    for (const resp of route.responses) {
      if (resp.schemaName) {
        types.add(resp.schemaName);
      }
    }
    // Add params type (path + query parameters) for templates that need it
    if (route.pathParams.length > 0 || route.queryParams.length > 0) {
      types.add(`${route.typeNameBase}Params`);
    }
    // Add unified input type (for service-aligned templates)
    types.add(`${route.typeNameBase}Input`);
  }
  
  return Array.from(types).sort();
}

/**
 * Process template with context
 */
export function processTemplate(
  template: Handlebars.TemplateDelegate,
  context: TemplateContext
): string {
  return template(context);
}

/**
 * Render a configured template. The only path from a configured template to
 * generated content: a template that cannot be found, parsed or rendered is an
 * error, never a silent substitution.
 *
 * `label` names what is being generated, for the error message.
 */
export function renderTemplate(
  templatePath: string,
  context: TemplateContext | Record<string, unknown>,
  label: string
): string {
  let template: Handlebars.TemplateDelegate;
  try {
    template = loadTemplate(path.resolve(templatePath));
  } catch (error) {
    throw new Error(
      `Cannot load template '${templatePath}' for ${label}: ` +
      (error instanceof Error ? error.message : String(error))
    );
  }

  try {
    return template(context);
  } catch (error) {
    throw new Error(
      `Cannot render template '${templatePath}' for ${label}: ` +
      (error instanceof Error ? error.message : String(error))
    );
  }
}

// =============================================================================
// Route Extraction
// =============================================================================

function extractRoutes(
  spec: OpenAPISpec,
  extensionInfo: ExtensionInfo[]
): RouteContext[] {
  const routes: RouteContext[] = [];
  const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

  for (const [apiPath, pathItem] of Object.entries(spec.paths)) {
    for (const method of methods) {
      const operation = pathItem[method];
      if (!operation) continue;

      // Canonical extension names only
      const service = operation['x-micro-contracts-service'];
      const serviceMethod = operation['x-micro-contracts-method'];
      
      if (!service || !serviceMethod) continue;

      const operationId = operation.operationId || `${method}${apiPath.replace(/[^a-zA-Z0-9]/g, '')}`;
      const typeNameBase = `${service}_${serviceMethod}`;
      const fastifyPath = apiPath.replace(/\{([^}]+)\}/g, ':$1');
      const serviceKey = service.charAt(0).toLowerCase() + service.slice(1);

      // Extract extensions and their parameters
      const extensions: RouteExtension[] = [];
      const extensionParams: ExtensionParameterContext[] = [];
      
      for (const info of extensionInfo) {
        const extValue = (operation as unknown as Record<string, unknown>)[info.marker];
        if (extValue) {
          const matches = Array.isArray(extValue) 
            ? extValue.includes(info.name)
            : extValue === info.name;
            
          if (matches) {
            const registryName = markerToRegistryName(info.marker);
            extensions.push({
              marker: info.marker,
              value: info.name,
              registryKey: `${registryName}.${info.name}`,
            });
            
            // Add parameters injected by this extension
            for (const param of info.injectedParameters) {
              // Map OpenAPI 'in' values to HTTP request property names
              const locationMap: Record<string, 'headers' | 'query' | 'params'> = {
                header: 'headers',
                query: 'query',
                path: 'params',
              };
              extensionParams.push({
                extensionName: info.name,
                name: param.name,
                location: locationMap[param.in] || 'headers',
                tsType: parameterToTsType(param),
                required: param.required || false,
              });
            }
          }
        }
      }

      // Extract parameters
      const allParams = operation.parameters || [];
      const queryParams = allParams
        .filter((p): p is ParameterObject => !isReference(p) && p.in === 'query')
        .map(p => ({ name: p.name, required: p.required || false }));
      const pathParams = allParams
        .filter((p): p is ParameterObject => !isReference(p) && p.in === 'path')
        .map(p => ({ name: p.name, required: true }));

      // Extract request body
      let requestBody: RouteContext['requestBody'];
      if (operation.requestBody) {
        const reqBody = isReference(operation.requestBody)
          ? null  // Simplified - would need to resolve
          : operation.requestBody;
        
        if (reqBody?.content?.['application/json']?.schema) {
          const schema = reqBody.content['application/json'].schema;
          const schemaName = isReference(schema) 
            ? getRefName(schema.$ref)
            : operationId + 'Body';
          requestBody = { schemaName, required: reqBody.required || false };
        }
      }

      // Extract responses
      const responses: ResponseContext[] = [];
      for (const [statusCode, response] of Object.entries(operation.responses)) {
        const resp = isReference(response) ? null : response;
        if (resp?.content?.['application/json']?.schema) {
          const schema = resp.content['application/json'].schema;
          const schemaName = isReference(schema) ? getRefName(schema.$ref) : undefined;
          responses.push({ statusCode, schemaName });
        } else {
          responses.push({ statusCode });
        }
      }

      // Client URL pattern: /users/{id} -> /users/${params.id}
      const clientUrlPattern = apiPath.replace(/\{([^}]+)\}/g, '${params.$1}');
      // Client URL pattern using input object: /users/{id} -> /users/${input.id}
      const clientUrlPatternInput = apiPath.replace(/\{([^}]+)\}/g, '${input.$1}');
      
      // Calculate type names
      const responseType = responses.length > 0 && responses[0].schemaName 
        ? responses[0].schemaName 
        : 'void';
      const requestType = requestBody?.schemaName;
      // Params type combines both path and query parameters
      const paramsType = (pathParams.length > 0 || queryParams.length > 0) ? `${typeNameBase}Params` : undefined;
      // Unified input type name (matches contract service API)
      const inputType = `${typeNameBase}Input`;
      
      routes.push({
        path: apiPath,
        fastifyPath,
        clientUrlPattern,
        clientUrlPatternInput,
        method,
        httpMethod: method.toUpperCase(),
        operationId,
        service,
        serviceKey,
        serviceMethod,
        summary: operation.summary,
        tags: operation.tags || [],
        isPublished: operation['x-micro-contracts-published'] === true,
        extensions,
        extensionParams,
        queryParams,
        pathParams,
        requestBody,
        responses,
        typeNameBase,
        responseType,
        requestType,
        paramsType,
        inputType,
      });
    }
  }

  return routes;
}

function extractServices(routes: RouteContext[]): ServiceContext[] {
  const serviceMap = new Map<string, ServiceContext>();

  for (const route of routes) {
    if (!serviceMap.has(route.service)) {
      serviceMap.set(route.service, {
        name: route.service,
        key: route.serviceKey,
        methods: [],
      });
    }
    const service = serviceMap.get(route.service)!;
    if (!service.methods.includes(route.serviceMethod)) {
      service.methods.push(route.serviceMethod);
    }
  }

  return Array.from(serviceMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function markerToRegistryName(marker: string): string {
  const name = marker.replace(/^x-/, '');
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'Registry';
}

/**
 * Convert OpenAPI parameter to TypeScript type
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

// =============================================================================
// Screen Extraction
// =============================================================================

/**
 * Build an operationId → route path lookup from spec paths
 */
function buildOperationRouteMap(spec: OpenAPISpec): Map<string, string> {
  const map = new Map<string, string>();
  for (const [apiPath, pathItem] of Object.entries(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (operation?.operationId) {
        map.set(operation.operationId, apiPath);
      }
    }
  }
  return map;
}

/**
 * Extract {param} segments from a route path.
 */
function extractPathParams(route: string): string[] {
  const matches = route.matchAll(/\{(\w+)\}/g);
  return [...matches].map(m => m[1]);
}

/**
 * Resolve raw x-event (string | object | $ref) into InlineEventDefinition.
 */
function resolveInlineEvent(
  raw: string | Record<string, unknown> | undefined,
  eventDefs: Record<string, Record<string, unknown>>,
  defaultType: string,
): InlineEventDefinition | undefined {
  if (raw == null) return undefined;

  if (typeof raw === 'string') {
    return { name: raw, type: defaultType };
  }

  if (typeof raw === 'object' && '$ref' in raw && typeof raw.$ref === 'string') {
    const ref = raw.$ref;
    if (!ref.startsWith('#/components/x-event-defs/')) {
      return { name: ref, type: defaultType };
    }
    const defName = ref.split('/').pop()!;
    const resolved = eventDefs[defName];
    if (!resolved) return { name: defName, type: defaultType };
    return {
      name: (resolved.name as string) ?? defName,
      type: (resolved.type as string) ?? defaultType,
      params: resolved.params as Record<string, string> | undefined,
    };
  }

  return {
    name: (raw.name as string) ?? '',
    type: (raw.type as string) ?? defaultType,
    params: raw.params as Record<string, string> | undefined,
  };
}

/**
 * Auto-derive params from path parameters when no explicit params are set.
 * Only applies to 'get' (screen path params) and 'link' (target route params).
 */
function deriveEventParams(
  event: InlineEventDefinition,
  placement: 'get' | 'link',
  context: { routePath: string; targetRoute?: string },
): InlineEventDefinition {
  if (event.params) return event;

  const route = placement === 'get' ? context.routePath : context.targetRoute;
  if (route) {
    const params = extractPathParams(route);
    if (params.length > 0) {
      event.params = Object.fromEntries(params.map(p => [p, 'string']));
    }
  }
  return event;
}

/**
 * Extract schema $ref name from a mutation operation's request body.
 */
function extractSchemaRef(operation: OperationObject): string {
  if (!operation.requestBody) return '';
  if (isReference(operation.requestBody)) {
    return getRefName(operation.requestBody.$ref);
  }
  const jsonContent = operation.requestBody.content?.['application/json'];
  if (jsonContent?.schema && isReference(jsonContent.schema)) {
    return getRefName(jsonContent.schema.$ref);
  }
  return '';
}

/**
 * Extract screen contexts from OpenAPI spec.
 * Parses GET operations that have x-screen-id into ScreenContext objects.
 */
function extractScreens(spec: OpenAPISpec): ScreenContext[] {
  const screens: ScreenContext[] = [];
  const operationRouteMap = buildOperationRouteMap(spec);
  const components = (spec.components ?? {}) as Record<string, unknown>;
  const eventDefs = (components['x-event-defs'] ?? {}) as Record<string, Record<string, unknown>>;

  for (const [apiPath, pathItem] of Object.entries(spec.paths)) {
    const operation = pathItem.get;
    if (!operation) continue;

    const screenId = operation['x-screen-id'];
    if (!screenId) continue;

    const screenConst = operation['x-screen-const'] || '';
    const screenName = operation['x-screen-name'] || '';
    const operationId = operation.operationId || '';
    const supportsBack = operation['x-back-navigation'] === true;

    // Legacy x-events (backward compat)
    const legacyEvents = operation['x-events'] || [];

    // Inline x-event on GET (screen_view)
    let screenEvent = resolveInlineEvent(
      operation['x-event'] as string | Record<string, unknown> | undefined,
      eventDefs,
      'screen_view',
    );
    if (screenEvent) {
      deriveEventParams(screenEvent, 'get', { routePath: apiPath });
    }

    const requiresAuth = Array.isArray(operation.security)
      ? operation.security.length > 0 && operation.security.some(s => Object.keys(s).length > 0)
      : false;

    let viewModelSchema = operation['x-view-model'] || '';
    if (!viewModelSchema) {
      const response200 = operation.responses?.['200'];
      if (response200 && !isReference(response200)) {
        const jsonContent = response200.content?.['application/json'];
        if (jsonContent?.schema && isReference(jsonContent.schema)) {
          viewModelSchema = getRefName(jsonContent.schema.$ref);
        }
      }
    }

    // Navigation links from 200 response (with optional inline x-event)
    const links: ScreenLink[] = [];
    const response200 = operation.responses?.['200'];
    if (response200 && !isReference(response200)) {
      const responseLinks = (response200 as ResponseObject).links;
      if (responseLinks) {
        for (const [linkName, linkObj] of Object.entries(responseLinks)) {
          if (linkObj.operationId) {
            const targetRoute = operationRouteMap.get(linkObj.operationId) || '';
            let linkEvent = resolveInlineEvent(
              linkObj['x-event'] as string | Record<string, unknown> | undefined,
              eventDefs,
              'user_action',
            );
            if (linkEvent) {
              deriveEventParams(linkEvent, 'link', { routePath: apiPath, targetRoute });
            }
            links.push({
              name: linkName,
              targetRoute,
              targetOperationId: linkObj.operationId,
              event: linkEvent,
            });
          }
        }
      }
    }

    // Mutation operations (post/put/patch/delete)
    const actions: ScreenAction[] = [];
    const mutationMethods = ['post', 'put', 'patch', 'delete'] as const;
    for (const method of mutationMethods) {
      const mutationOp = pathItem[method];
      if (!mutationOp) continue;
      const actionEvent = resolveInlineEvent(
        mutationOp['x-event'] as string | Record<string, unknown> | undefined,
        eventDefs,
        'user_action',
      );
      actions.push({
        method,
        operationId: mutationOp.operationId ?? '',
        summary: mutationOp.summary ?? '',
        schemaRef: extractSchemaRef(mutationOp),
        event: actionEvent,
      });
    }

    // x-interactions
    const rawInteractions = (operation['x-interactions'] ?? []) as InteractionDefinitionRaw[];
    const interactions: ScreenInteraction[] = rawInteractions.map(i => {
      const { name, description, 'x-event': rawEvent, ...extras } = i;
      return {
        name: name ?? '',
        description: description ?? '',
        event: resolveInlineEvent(
          rawEvent as string | Record<string, unknown> | undefined,
          eventDefs,
          'user_action',
        ),
        extras,
      };
    });

    screens.push({
      route: apiPath,
      screenConst,
      screenId,
      screenName,
      operationId,
      supportsBack,
      viewModelSchema,
      links,
      events: legacyEvents,
      screenEvent,
      actions,
      interactions,
      pathParams: extractPathParams(apiPath),
      requiresAuth,
    });
  }

  return screens;
}

// =============================================================================
// Register Handlebars Helpers
// =============================================================================

// Comparison helpers
Handlebars.registerHelper('eq', (a, b) => a === b);
Handlebars.registerHelper('ne', (a, b) => a !== b);
Handlebars.registerHelper('gt', (a, b) => a > b);
Handlebars.registerHelper('gte', (a, b) => a >= b);
Handlebars.registerHelper('lt', (a, b) => a < b);
Handlebars.registerHelper('lte', (a, b) => a <= b);
Handlebars.registerHelper('and', function(...args) {
  const options = args.pop();
  return args.every(Boolean);
});
Handlebars.registerHelper('or', function(...args) {
  const options = args.pop();
  return args.some(Boolean);
});

// Array/Object helpers
Handlebars.registerHelper('length', (arr) => arr?.length || 0);
Handlebars.registerHelper('first', (arr) => arr?.[0]);
Handlebars.registerHelper('last', (arr) => arr?.[arr?.length - 1]);
Handlebars.registerHelper('join', (arr, sep) => arr?.join(sep) || '');
Handlebars.registerHelper('includes', (arr, val) => arr?.includes(val));
Handlebars.registerHelper('keys', (obj) => Object.keys(obj || {}));
Handlebars.registerHelper('values', (obj) => Object.values(obj || {}));

// String helpers
Handlebars.registerHelper('uppercase', (str) => str?.toUpperCase());
Handlebars.registerHelper('lowercase', (str) => str?.toLowerCase());
Handlebars.registerHelper('capitalize', (str) => str?.charAt(0).toUpperCase() + str?.slice(1));
Handlebars.registerHelper('camelCase', (str: string) => {
  return str?.replace(/[-_]([a-z])/g, (_match: string, c: string) => c.toUpperCase());
});
Handlebars.registerHelper('pascalCase', (str: string) => {
  const camel = str?.replace(/[-_]([a-z])/g, (_match: string, c: string) => c.toUpperCase());
  return camel?.charAt(0).toUpperCase() + camel?.slice(1);
});
Handlebars.registerHelper('kebabCase', (str) => {
  return str?.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
});
Handlebars.registerHelper('snakeCase', (str: string) => {
  return str?.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/-/g, '_').toLowerCase();
});

// Ref helper
Handlebars.registerHelper('refName', (ref: string) => {
  return typeof ref === 'string' ? ref.split('/').pop() : '';
});

// JSON helper
Handlebars.registerHelper('json', (obj) => JSON.stringify(obj, null, 2));

// Screen event helpers
Handlebars.registerHelper('hasEvent', (ctx) =>
  !!(ctx?.screenEvent || ctx?.links?.some((l: ScreenLink) => l.event) ||
     ctx?.actions?.some((a: ScreenAction) => a.event) ||
     ctx?.interactions?.some((i: ScreenInteraction) => i.event))
);

Handlebars.registerHelper('eventParamsSignature', (params) => {
  if (!params) return '';
  return Object.entries(params)
    .map(([k, v]) => `${k}: ${v === 'integer' ? 'number' : v}`)
    .join(', ');
});

// Conditional block helpers
Handlebars.registerHelper('ifCond', function(this: unknown, v1, operator, v2, options) {
  switch (operator) {
    case '==': return v1 == v2 ? (options as Handlebars.HelperOptions).fn(this) : (options as Handlebars.HelperOptions).inverse(this);
    case '===': return v1 === v2 ? (options as Handlebars.HelperOptions).fn(this) : (options as Handlebars.HelperOptions).inverse(this);
    case '!=': return v1 != v2 ? (options as Handlebars.HelperOptions).fn(this) : (options as Handlebars.HelperOptions).inverse(this);
    case '!==': return v1 !== v2 ? (options as Handlebars.HelperOptions).fn(this) : (options as Handlebars.HelperOptions).inverse(this);
    case '<': return v1 < v2 ? (options as Handlebars.HelperOptions).fn(this) : (options as Handlebars.HelperOptions).inverse(this);
    case '<=': return v1 <= v2 ? (options as Handlebars.HelperOptions).fn(this) : (options as Handlebars.HelperOptions).inverse(this);
    case '>': return v1 > v2 ? (options as Handlebars.HelperOptions).fn(this) : (options as Handlebars.HelperOptions).inverse(this);
    case '>=': return v1 >= v2 ? (options as Handlebars.HelperOptions).fn(this) : (options as Handlebars.HelperOptions).inverse(this);
    default: return (options as Handlebars.HelperOptions).inverse(this);
  }
});
