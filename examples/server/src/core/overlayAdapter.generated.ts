/**
 * Auto-generated Overlay Adapter
 * Generated from: Core API v1.0.0
 * DO NOT EDIT MANUALLY
 */

import type { FastifyReply } from 'fastify';
import type { OverlayResult, OverlayRegistry } from '@project/contract/core/overlays/index.js';
import type { ProblemDetails } from '@project/contract/core/schemas/types.js';

// ==========================================================================
// Types
// ==========================================================================

/** HTTP request abstraction */
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
  'requireAuth': (req) => ({
    'Authorization': getHeader(req, 'Authorization'),
  }),
  'requireAdmin': (req) => ({
  }),
  'tenantIsolation': (req) => ({
    'X-Tenant-Id': getHeader(req, 'X-Tenant-Id'),
  }),
  'rateLimit': (req) => ({
    'X-RateLimit-Limit': getHeader(req, 'X-RateLimit-Limit'),
    'X-RateLimit-Remaining': getHeader(req, 'X-RateLimit-Remaining'),
  }),
};

// ==========================================================================
// Endpoint → Overlay Mapping
// ==========================================================================

/** Which overlays apply to each endpoint */
export const endpointOverlays: Record<string, string[]> = {
  'getUsers': ['requireAuth'],
  'createUser': ['requireAuth'],
  'getUserById': ['requireAuth'],
  'updateUser': ['requireAuth'],
  'deleteUser': ['requireAuth', 'requireAdmin'],
  'getTenantData': ['requireAuth', 'tenantIsolation', 'rateLimit'],
  'createTenantData': ['requireAuth', 'tenantIsolation', 'rateLimit'],
  'getSystemStats': ['requireAuth', 'requireAdmin'],
  'suspendUser': ['requireAuth', 'requireAdmin'],
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
        `[SECURITY] Overlay handler "${name}" is required for operation "${operationId}" but not registered. ` +
        `Register it in server.ts: fastify.decorate('overlayHandlers', { ${name}: ... })`
      );
    }
    if (!extract) {
      throw new Error(
        `[SECURITY] Overlay extractor "${name}" is missing. This indicates a code generation issue.`
      );
    }

    // The extractor builds the input the handler is declared with, from the
    // same parameters; looked up by name, TypeScript cannot pair the two.
    const input = extract(req);
    const result = await (handler as unknown as (input: Record<string, unknown>) => Promise<OverlayResult<unknown>>)(input);

    if (!result.success) {
      return {
        success: false,
        error: {
          type: `/errors/${result.error?.code?.toLowerCase() ?? 'error'}`,
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
  const headers = req.headers as Record<string, string | string[] | undefined>;
  return {
    headers,
    params: req.params as Record<string, string>,
    query: req.query as Record<string, unknown>,
    cookies: parseCookies(headers.cookie),
    body: req.body,
  };
}

/**
 * The cookies of a Cookie header (`name=value; name=value`), by name.
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

/**
 * Send error response
 */
export function sendError(reply: FastifyReply, error: ProblemDetails): void {
  reply.status(error.status).send(error);
}
