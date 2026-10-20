/**
 * Auto-generated Overlay Adapter
 * Generated from: Core API v1.0.0
 * DO NOT EDIT MANUALLY
 */

import type { OverlayResult, OverlayRegistry } from '@project/contract/core/overlays/index.js';
import type { ProblemDetails } from '@project/contract/core/schemas/types.js';
import { toProblemDetails } from '@project/contract/core/errors/index.js';

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

/** The parameters each overlay requires: a request without one is refused before the overlay runs */
const requiredParams: Record<string, string[]> = {
  'requireAuth': [],
  'requireAdmin': [],
  'tenantIsolation': ['X-Tenant-Id', ],
  'rateLimit': [],
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
        `Register it in the overlay registry the routes are given: { ${name}: ... }`
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
    const missing = (requiredParams[name] ?? []).filter(param => input[param] === undefined);
    if (missing.length > 0) {
      return {
        success: false,
        error: toProblemDetails({
          status: 400,
          message: `Missing required parameter: ${missing.join(', ')}`,
          code: 'MISSING_PARAMETER',
        }),
      };
    }
    const result = await (handler as unknown as (input: Record<string, unknown>) => Promise<OverlayResult<unknown>>)(input);

    if (!result.success) {
      return { success: false, error: toProblemDetails(result.error ?? { status: 500, message: 'Error' }) };
    }

    if (result.context) {
      Object.assign(context, result.context);
    }
  }

  return { success: true, context };
}
