/**
 * Starter Templates for micro-contracts init command
 *
 * These templates are created in spec/default/templates/ and can be customized.
 * examples/spec/default/templates/ holds exactly these files, as init writes
 * them: the example project is generated and type-checked with them.
 */

const STARTER_FASTIFY_ROUTES_TEMPLATE = `/**
 * Auto-generated Fastify routes
 * Generated from: {{spec.info.title}} v{{spec.info.version}}
 * DO NOT EDIT MANUALLY
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { allSchemas } from '{{contractPackage}}/schemas/index.js';
import * as types from '{{contractPackage}}/schemas/types.js';
{{!-- A header schema is given inline: Fastify matches header names case-insensitively only in an inline schema --}}
import { {{#each routes}}{{#if parameterSchemas.header}}{{parameterSchemas.header}}, {{/if}}{{/each~}} } from '{{contractPackage}}/schemas/validators.js';
{{#if extensionInfo.length}}
import { runOverlays, sendError, type HttpRequest } from './overlayAdapter.generated.js';
{{/if}}
{{#if readsCookies}}

/**
 * The cookies of a Cookie header (\`name=value; name=value\`), by name.
 * Of two cookies with one name, the first is kept: it is the more specific.
 */
function parseCookies(header: string | string[] | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const pair of [header ?? []].flat().join('; ').split(';')) {
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator).trim();
    if (separator < 0 || !name || cookies.has(name)) continue;

    let value = pair.slice(separator + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}
{{/if}}
{{#if extensionInfo.length}}

/** The request as the overlays read it */
function toHttpRequest(req: FastifyRequest, cookies: ReadonlyMap<string, string>): HttpRequest {
  return {
    headers: req.headers as Record<string, string | string[] | undefined>,
    params: req.params as Record<string, string>,
    query: req.query as Record<string, unknown>,
    cookies,
    body: req.body,
  };
}
{{/if}}

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  // A component referenced from a shared file is a schema of every module that
  // references it: the first module registers it, and a module defining a
  // different schema under the same id is an error.
  for (const schema of allSchemas) {
    const registered = fastify.getSchema(schema.$id);
    if (registered === undefined) {
      fastify.addSchema(schema);
    } else if (JSON.stringify(registered) !== JSON.stringify(schema)) {
      throw new Error(\`Schema '\${schema.$id}' is already registered with a different definition\`);
    }
  }

  const { {{#each services}}{{key}}{{#unless @last}}, {{/unless}}{{/each}} } = {{servicesPath}};
{{#if extensionInfo.length}}
  const handlers = fastify.overlayHandlers;
{{/if}}

{{#each routes}}
  // {{uppercase method}} {{path}}{{#if isPublished}} [PUBLISHED]{{/if}}
{{#if parameterSchemas.cookie}}
  {{!-- Fastify parses no cookies: the route validates them, with the validator Fastify validates the rest with --}}
  const {{parameterSchemas.cookie}} = { $ref: '{{parameterSchemas.cookie}}#' };
{{/if}}
  fastify.{{method}}('{{fastifyPath}}', {
    schema: {
{{#if parameterSchemas.path}}
      params: { $ref: '{{parameterSchemas.path}}#' },
{{/if}}
{{#if parameterSchemas.query}}
      querystring: { $ref: '{{parameterSchemas.query}}#' },
{{/if}}
{{#if parameterSchemas.header}}
      headers: {{parameterSchemas.header}},
{{/if}}
{{#if requestBody}}
      body: { $ref: '{{requestBody.schemaName}}#' },
{{/if}}
{{#if responseSchemas.length}}
      response: { {{#each responseSchemas}}'{{status}}': { $ref: '{{schemaName}}#' }{{#unless @last}}, {{/unless}}{{/each}} },
{{/if}}
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
{{#if (or cookieParams.length extensions.length)}}
    const cookies = parseCookies(req.headers.cookie);
{{/if}}
{{#if parameterSchemas.cookie}}
    const cookieParams: Record<string, unknown> = {};
    for (const name of [{{#each cookieParams}}'{{name}}', {{/each~}} ]) {
      const value = cookies.get(name);
      if (value !== undefined) cookieParams[name] = value;
    }
    const validateCookies = req.compileValidationSchema({{parameterSchemas.cookie}});
    if (!validateCookies(cookieParams)) {
      throw Object.assign(
        new Error((validateCookies.errors ?? []).map(e => \`cookies\${e.instancePath} \${e.message}\`).join(', ')),
        { statusCode: 400, validation: validateCookies.errors, validationContext: 'cookies' },
      );
    }
{{/if}}
{{#if extensions.length}}
    const result = await runOverlays('{{operationId}}', handlers, toHttpRequest(req, cookies));
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
{{#if cookieParams.length}}
      ...(cookieParams as unknown as types.{{typeNameBase}}Params),
{{/if}}
{{#if requestBody}}
      data: req.body as types.{{requestBody.schemaName}},
{{/if}}
    };
{{!-- The success status is set once the service has returned: an error it throws keeps its own status. --}}
{{#if (eq responseType "void")}}
    await {{serviceKey}}.{{serviceMethod}}(input);
    return reply.code({{successStatus}}).send();
{{else}}
    const output = await {{serviceKey}}.{{serviceMethod}}(input);
    return reply.code({{successStatus}}).send(output);
{{/if}}
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

const STARTER_SERVICE_STUBS_TEMPLATE = `{{!-- Service implementation stubs: a class per service, implementing its generated interface --}}
// Auto-generated service stubs - Edit to implement business logic
import type { {{#each services}}{{name}}ServiceApi{{#unless @last}}, {{/unless}}{{/each}} } from '{{contractPackage}}/services/index.js';
import type * as types from '{{contractPackage}}/schemas/types.js';

{{#each services}}
/**
 * {{name}} Service Implementation
 *
 * Implement the methods below with your business logic.
 * Methods receive HTTP-agnostic input objects.
 */
export class {{name}}Service implements {{name}}ServiceApi {
{{#each ../routes}}
{{#if (eq service ../name)}}
  /**
   * {{httpMethod}} {{path}}{{#if summary}}: {{summary}}{{/if}}
   */
  async {{serviceMethod}}(input: types.{{inputType}}): Promise<{{#if (eq responseType "void")}}void{{else}}types.{{responseType}}{{/if}}> {
    // TODO: Implement {{serviceMethod}}
    throw new Error('Not implemented: {{service}}.{{serviceMethod}}');
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

/** HTTP request abstraction: what a route hands the overlays */
export interface HttpRequest {
  headers: Record<string, string | string[] | undefined>;
  params: Record<string, string>;
  query: Record<string, unknown>;
  /** The cookies the request carries, by name */
  cookies: ReadonlyMap<string, string>;
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

const getCookie = (req: HttpRequest, name: string): string | undefined => req.cookies.get(name);

/** Overlay parameter extractors - each overlay defined once */
const extractors: Record<string, ParamExtractor> = {
{{#each uniqueOverlays}}
  '{{name}}': (req) => ({
{{#each params}}
    '{{name}}': {{#if (eq location "headers")}}getHeader(req, '{{name}}'){{else if (eq location "query")}}getQuery(req, '{{name}}'){{else if (eq location "params")}}getParam(req, '{{name}}'){{else if (eq location "cookies")}}getCookie(req, '{{name}}'){{/if}},
{{/each}}
  }),
{{/each}}
};

/** The parameters each overlay requires: a request without one is refused before the overlay runs */
const requiredParams: Record<string, string[]> = {
{{#each uniqueOverlays}}
  '{{name}}': [{{#each params}}{{#if required}}'{{name}}', {{/if}}{{/each~}} ],
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
    
    // SECURITY: Never skip a required overlay - fail fast if not registered
    if (!handler) {
      throw new Error(
        \`[SECURITY] Overlay handler "\${name}" is required for operation "\${operationId}" but not registered. \` +
        \`Register it in server.ts: fastify.decorate('overlayHandlers', { \${name}: ... })\`
      );
    }
    if (!extract) {
      throw new Error(
        \`[SECURITY] Overlay extractor "\${name}" is missing. This indicates a code generation issue.\`
      );
    }

    // The extractor builds the input the handler is declared with, from the
    // same parameters; looked up by name, TypeScript cannot pair the two.
    const input = extract(req);
    const missing = (requiredParams[name] ?? []).filter(param => input[param] === undefined);
    if (missing.length > 0) {
      return {
        success: false,
        error: {
          type: '/errors/missing_parameter',
          title: \`Missing required parameter: \${missing.join(', ')}\`,
          status: 400,
        },
      };
    }
    const result = await (handler as unknown as (input: Record<string, unknown>) => Promise<OverlayResult<unknown>>)(input);

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
 * Send error response
 */
export function sendError(reply: FastifyReply, error: ProblemDetails): void {
  reply.status(error.status).send(error);
}
`;

const STARTER_OVERLAY_STUBS_TEMPLATE = `{{!-- Overlay handler stubs: a handler per overlay, in the OverlayRegistry --}}
// Auto-generated overlay handler stubs - Edit to implement overlay logic
import type {
  OverlayResult,
{{#each extensionInfo}}
  {{overlayTypeName name}}OverlayInput,
{{/each}}
  OverlayRegistry,
} from '{{contractPackage}}/overlays/index.js';

/**
 * Registry of all overlay handlers
 * Register this with your server framework
 */
export const overlayHandlers: OverlayRegistry = {
{{#each extensionInfo}}
  /**
   * {{name}} overlay handler
   *
   * Runs before every operation the overlay applies to. Return
   * { success: false, error: { status, message, code } } to refuse the request.
{{#if injectedParameters.length}}
   *
   * Input parameters:
{{#each injectedParameters}}
   * - {{name}} (in: {{this.in}}){{#if required}} required{{/if}}
{{/each}}
{{/if}}
   */
  '{{name}}': async (input: {{overlayTypeName name}}OverlayInput): Promise<OverlayResult> => {
    // TODO: Implement {{name}}
    throw new Error('Not implemented: {{name}}');
  },

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
