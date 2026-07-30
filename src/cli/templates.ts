/**
 * Starter Templates for micro-contracts init command
 * 
 * These templates are created in spec/default/templates/ and can be customized.
 * Keep in sync with examples/spec/default/templates/
 */

const STARTER_FASTIFY_ROUTES_TEMPLATE = `/**
 * Auto-generated Fastify routes
 * Generated from: {{spec.info.title}} v{{spec.info.version}}
 * DO NOT EDIT MANUALLY
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { allSchemas } from '{{contractPackage}}/schemas/index.js';
import * as types from '{{contractPackage}}/schemas/types.js';
{{#if extensionInfo.length}}
import { runOverlays, toHttpRequest, sendError } from './overlayAdapter.generated.js';
{{/if}}

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  for (const schema of allSchemas) {
    fastify.addSchema(schema);
  }

  const { {{#each services}}{{key}}{{#unless @last}}, {{/unless}}{{/each}} } = {{servicesPath}};
{{#if extensionInfo.length}}
  const handlers = fastify.overlayHandlers;
{{/if}}

{{#each routes}}
  // {{uppercase method}} {{path}}{{#if isPublished}} [PUBLISHED]{{/if}}
  fastify.{{method}}('{{fastifyPath}}', {
    schema: {
{{#if paramsType}}
      params: { $ref: '{{typeNameBase}}Params#' },
{{/if}}
{{#if requestBody}}
      body: { $ref: '{{requestBody.schemaName}}#' },
{{/if}}
{{#if responses.length}}
      response: { {{#each responses}}{{#if schemaName}}{{statusCode}}: { $ref: '{{schemaName}}#' }{{#unless @last}}, {{/unless}}{{/if}}{{/each}} },
{{/if}}
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
{{#if extensions.length}}
    const result = await runOverlays('{{operationId}}', handlers, toHttpRequest(req));
    if (!result.success) return sendError(reply, result.error);
{{/if}}
    // Build input object (always required, even if empty)
    const input: types.{{inputType}} = {
{{#if pathParams.length}}
      ...(req.params as types.{{typeNameBase}}Params),
{{/if}}
{{#if queryParams.length}}
      ...(req.query as types.{{typeNameBase}}Params),
{{/if}}
{{#if requestBody}}
      data: req.body as types.{{requestBody.schemaName}},
{{/if}}
    };
    return {{serviceKey}}.{{serviceMethod}}(input);
  });

{{/each}}
}
`;

const STARTER_FETCH_CLIENT_TEMPLATE = `/**
 * Auto-generated HTTP Client from OpenAPI specification
 * Generated from: {{title}} v{{version}}
 * 
 * DO NOT EDIT MANUALLY
 * 
 * Client API matches Service API signature (single input object).
 * Internally maps input to HTTP request (path params, query params, body).
 */

import type {
{{#each serviceTypes}}
  {{this}},
{{/each}}
} from '{{contractPackage}}/services';
import type {
{{#each schemaTypes}}
  {{this}},
{{/each}}
} from '{{contractPackage}}/schemas';
import { ApiError } from '{{contractPackage}}/errors';

// BASE_URL derived from OpenAPI servers[0].url: {{baseUrl}}
// Can be overridden via environment variable (Vite: VITE_API_BASE_URL)
const BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || '{{baseUrl}}';

/**
 * Handle HTTP response with typed error handling
 */
async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const problem = await res.json() as ProblemDetails;
    throw new ApiError(
      res.status,
      problem,
      res.headers.get('x-request-id') ?? undefined
    );
  }
  // Handle 204 No Content and empty responses
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json();
}

{{#each services}}
// ==========================================================================
// {{name}} API Client
// ==========================================================================
export const {{key}}Api: {{name}}ServiceApi = {
{{#each ../routes}}
{{#if (eq service ../name)}}
  /**
   * {{httpMethod}} {{path}}
   {{#if summary}}* {{summary}}{{/if}}
   {{#if isPublished}}* @published{{/if}}
   */
  async {{serviceMethod}}(input: {{inputType}}): Promise<{{responseType}}> {
{{#if queryParams.length}}
    const searchParams = new URLSearchParams();
{{#each queryParams}}
    if (input.{{name}} !== undefined) searchParams.set('{{name}}', String(input.{{name}}));
{{/each}}
{{/if}}
{{#if pathParams.length}}
    const url = \`\${BASE_URL}{{clientUrlPatternInput}}\`{{#if queryParams.length}} + (searchParams.toString() ? '?' + searchParams : ''){{/if}};
{{else}}
    const url = \`\${BASE_URL}{{path}}\`{{#if queryParams.length}} + (searchParams.toString() ? '?' + searchParams : ''){{/if}};
{{/if}}
{{#if (eq httpMethod "GET")}}
    const res = await fetch(url);
{{else if requestType}}
    const res = await fetch(url, {
      method: '{{httpMethod}}',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.data),
    });
{{else}}
    const res = await fetch(url, { method: '{{httpMethod}}' });
{{/if}}
{{#if (eq responseType "void")}}
    await handleResponse<void>(res);
{{else}}
    return handleResponse<{{responseType}}>(res);
{{/if}}
  },

{{/if}}
{{/each}}
};

{{/each}}
`;

const STARTER_SERVICE_STUBS_TEMPLATE = `{{!-- Service implementation stubs template --}}
{{!-- Generates skeleton implementations for service methods --}}
// Auto-generated service stubs - Edit to implement business logic
import type { {{#each services}}{{this}}ServiceApi{{#unless @last}}, {{/unless}}{{/each}} } from '{{config.contractPackage}}/services';
import type * as types from '{{config.contractPackage}}/schemas/types';

{{#each services}}
/**
 * {{this}} Service Implementation
 * 
 * Implement the methods below with your business logic.
 * Generated methods receive HTTP-agnostic input objects.
 */
export class {{this}}Service implements {{this}}ServiceApi {
{{#each ../operations}}
{{#if (eq service ../this)}}
  /**
   * {{summary}}
   * {{method}} {{path}}
   */
  async {{serviceMethod}}({{#if inputType}}input: types.{{inputType}}{{/if}}): Promise<types.{{responseType}}> {
    // TODO: Implement {{serviceMethod}}
    throw new Error('Not implemented: {{serviceMethod}}');
  }

{{/if}}
{{/each}}
}

{{/each}}
`;

const STARTER_OVERLAY_ADAPTER_TEMPLATE = `/**
 * Auto-generated Overlay Adapter
 * Generated from: {{spec.info.title}} v{{spec.info.version}}
 * DO NOT EDIT MANUALLY
 */

import type { FastifyReply } from 'fastify';
import type { OverlayResult, OverlayRegistry } from '{{contractPackage}}/overlays/index.js';
import type { ProblemDetails } from '{{contractPackage}}/schemas/types.js';

// ==========================================================================
// Types
// ==========================================================================

/** HTTP request abstraction */
export interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
}

/** Parameter extractor function */
type ParamExtractor = (req: HttpRequest) => Record<string, unknown>;

// ==========================================================================
// Parameter Extractors (one per overlay, shared across endpoints)
// ==========================================================================

const getHeader = (req: HttpRequest, name: string): string | undefined =>
  req.headers[name.toLowerCase()] as string | undefined;

const getQuery = (req: HttpRequest, name: string): unknown => req.query[name];

const getParam = (req: HttpRequest, name: string): string | undefined => req.params[name];

/** Overlay parameter extractors - each overlay defined once */
const extractors: Record<string, ParamExtractor> = {
{{#each uniqueOverlays}}
  '{{name}}': (req) => ({
{{#each params}}
    '{{name}}': {{#if (eq location "headers")}}getHeader(req, '{{name}}'){{else if (eq location "query")}}getQuery(req, '{{name}}'){{else}}getParam(req, '{{name}}'){{/if}},
{{/each}}
  }),
{{/each}}
};

// ==========================================================================
// Endpoint → Overlay Mapping
// ==========================================================================

/** Which overlays apply to each endpoint */
export const endpointOverlays: Record<string, string[]> = {
{{#each routes}}
{{#if extensions.length}}
  '{{operationId}}': [{{#each extensions}}'{{value}}'{{#unless @last}}, {{/unless}}{{/each}}],
{{/if}}
{{/each}}
};

// ==========================================================================
// Overlay Execution
// ==========================================================================

/**
 * Execute overlays for an endpoint
 */
export async function runOverlays(
  operationId: string,
  handlers: OverlayRegistry,
  req: HttpRequest
): Promise<{ success: true; context: Record<string, unknown> } | { success: false; error: ProblemDetails }> {
  const overlayNames = endpointOverlays[operationId] || [];
  const context: Record<string, unknown> = {};

  for (const name of overlayNames) {
    const extract = extractors[name];
    const handler = handlers[name as keyof OverlayRegistry];
    
    if (!extract || !handler) continue;

    const input = extract(req);
    const result = await (handler as (input: Record<string, unknown>) => Promise<OverlayResult<unknown>>)(input);

    if (!result.success) {
      return {
        success: false,
        error: {
          type: \`/errors/\${result.error?.code?.toLowerCase() ?? 'error'}\`,
          title: result.error?.message ?? 'Error',
          status: result.error?.status ?? 500,
        },
      };
    }

    if (result.context) {
      Object.assign(context, result.context);
    }
  }

  return { success: true, context };
}

/**
 * Build HttpRequest from Fastify request
 */
export function toHttpRequest(req: { headers: unknown; params: unknown; query: unknown; body: unknown }): HttpRequest {
  return {
    headers: req.headers as Record<string, string | string[] | undefined>,
    params: req.params as Record<string, string>,
    query: req.query as Record<string, unknown>,
    body: req.body,
  };
}

/**
 * Send error response
 */
export function sendError(reply: FastifyReply, error: ProblemDetails): void {
  reply.status(error.status).send(error);
}
`;

const STARTER_OVERLAY_STUBS_TEMPLATE = `{{!-- Extension implementation stubs template --}}
{{!-- Generates skeleton implementations for overlay handlers --}}
// Auto-generated extension stubs - Edit to implement overlay logic
import type {
  OverlayResult,
{{#each extensionTypes}}
  {{this}}OverlayInput,
  {{this}}Overlay,
{{/each}}
  OverlayRegistry,
} from '{{config.contractPackage}}/overlays';

{{#each extensions}}
/**
 * {{name}} overlay handler
 * 
 * Called when an endpoint has x-middleware: [{{name}}]
 * Returns OverlayResult with success/error status
 */
export async function {{camelCase name}}(
  input: {{pascalCase name}}OverlayInput
): Promise<OverlayResult> {
  // TODO: Implement {{name}} logic
{{#if injectedParameters}}
  // Input parameters:
{{#each injectedParameters}}
  // - {{name}}: {{schema.type}}{{#if required}} (required){{/if}}
{{/each}}
{{/if}}

  // Example implementation:
  // if (!validateSomething(input)) {
  //   return {
  //     success: false,
  //     error: { status: 4xx, message: 'Error message', code: 'ERROR_CODE' },
  //   };
  // }

  return { success: true, context: { /* optional context for service */ } };
}

{{/each}}
/**
 * Registry of all overlay handlers
 * Register this with your server framework
 */
export const overlayHandlers: OverlayRegistry = {
{{#each extensions}}
  {{camelCase name}}: {{camelCase name}},
{{/each}}
};
`;

// =============================================================================
// Screen Spec Templates
// =============================================================================

const STARTER_SCREEN_NAVIGATION_TEMPLATE = `/**
 * Auto-generated screen navigation map from OpenAPI screen specification
 * Generated from: {{title}} v{{version}}
 * DO NOT EDIT MANUALLY
 */

const _OP_ROUTES = {
{{#each screens}}
  {{operationId}}: '{{route}}',
{{/each}}
} as const;

export const SCREENS = {
{{#each screens}}
  {{screenConst}}: { id: '{{screenId}}' as const, route: _OP_ROUTES.{{operationId}}, supportsBack: {{supportsBack}} } as const,
{{/each}}
} as const;

{{#each screens}}
{{#if links.length}}
export const {{screenConst}}_PAGE_LINKS = {
{{#each links}}
  {{name}}: _OP_ROUTES.{{targetOperationId}},
{{/each}}
} as const;

{{/if}}
{{/each}}
`;

const STARTER_SCREEN_EVENTS_TEMPLATE = `/**
 * Auto-generated analytics event hooks from OpenAPI screen specification
 * Generated from: {{title}} v{{version}}
 * DO NOT EDIT MANUALLY
 */

import { trackEvent } from '@/lib/analytics';

{{#each screens}}
{{#if events.length}}
export function use{{screenName}}Events() {
  return {
{{#each events}}
{{#if this.params}}
    {{this.method}}: ({{#each this.params}}{{@key}}: {{#if (eq this 'integer')}}number{{else}}{{this}}{{/if}}{{#unless @last}}, {{/unless}}{{/each}}) =>
      trackEvent('{{this.name}}', '{{this.type}}', { {{#each this.params}}{{@key}}{{#unless @last}}, {{/unless}}{{/each}} }),
{{else}}
    {{this.method}}: () =>
      trackEvent('{{this.name}}', '{{this.type}}', {}),
{{/if}}
{{/each}}
  };
}

{{/if}}
{{/each}}
`;

/**
 * Get all starter templates
 */
export function getStarterTemplates(): Record<string, string> {
  return {
    'fastify-routes.hbs': STARTER_FASTIFY_ROUTES_TEMPLATE,
    'fetch-client.hbs': STARTER_FETCH_CLIENT_TEMPLATE,
    'service-stubs.hbs': STARTER_SERVICE_STUBS_TEMPLATE,
    'overlay-adapter.hbs': STARTER_OVERLAY_ADAPTER_TEMPLATE,
    'overlay-stubs.hbs': STARTER_OVERLAY_STUBS_TEMPLATE,
  };
}

/**
 * Get screen spec starter templates
 */
export function getScreenStarterTemplates(): Record<string, string> {
  return {
    'screen-navigation.hbs': STARTER_SCREEN_NAVIGATION_TEMPLATE,
    'screen-events.hbs': STARTER_SCREEN_EVENTS_TEMPLATE,
  };
}
