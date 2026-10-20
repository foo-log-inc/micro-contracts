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
import { runOverlays, type HttpRequest } from './overlayAdapter.generated.js';
{{/if}}
{{#if streams}}
import { Readable } from 'node:stream';
import { encodeStream } from '{{contractPackage}}/streams/index.js';
{{/if}}
{{#if readsCookies}}
import { parseCookies } from '{{contractPackage}}/http/index.js';
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

/** Answer with an overlay's refusal */
function sendError(reply: FastifyReply, error: types.ProblemDetails): FastifyReply {
  return reply.status(error.status).send(error);
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
{{#if stream}}
  {{!-- Events are serialized as a JSON response is: by the schema of one event --}}
  const {{typeNameBase}}EventSchema = { $ref: '{{stream.eventType}}#' };
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
      {{!-- The error Fastify itself raises for a schema it validates --}}
      throw Object.assign(
        new Error((validateCookies.errors ?? []).map(e => \`cookies\${e.instancePath} \${e.message}\`).join(', ')),
        { statusCode: 400, code: 'FST_ERR_VALIDATION', validation: validateCookies.errors, validationContext: 'cookies' },
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
{{#if stream}}
{{!-- A stream's first event is awaited before anything is sent: a service that fails at once fails through the error handler --}}
    const events = {{serviceKey}}.{{serviceMethod}}(input)[Symbol.asyncIterator]();
    const first = await events.next();
    const serialize = reply.compileSerializationSchema({{typeNameBase}}EventSchema);
    reply.code({{successStatus}}).header('content-type', '{{stream.mediaType}}').header('cache-control', 'no-cache');
    return reply.send(Readable.from(encodeStream('{{stream.format}}', first, events, serialize, '{{stream.discriminator}}')));
{{else if (eq responseType "void")}}
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
 * Cookie parameters are optional: the browser sends cookies, the client does not.
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
{{#if streams}}
import { decodeStream } from '{{contractPackage}}/streams';
{{/if}}

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
{{#if streams}}

/** The text of a response body in order; reading stopped early cancels the body */
async function* bodyText(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let done = false;
  try {
    while (!done) {
      const chunk = await reader.read();
      done = chunk.done;
      const text = decoder.decode(chunk.value, { stream: !done });
      if (text) yield text;
    }
  } finally {
    if (!done) await reader.cancel();
  }
}
{{/if}}

{{#each services}}
// ==========================================================================
// {{name}} API Client
// ==========================================================================
export const {{key}}Api = {
{{#each ../routes}}
{{#if (eq service ../name)}}
  /**
   * {{httpMethod}} {{path}}
   {{#if summary}}* {{summary}}{{/if}}
   {{#if isPublished}}* @published{{/if}}
   */
  async {{#if stream}}*{{/if}}{{serviceMethod}}(input: {{clientInputType}}): {{#if stream}}AsyncGenerator<{{stream.eventType}}>{{else}}Promise<{{responseType}}>{{/if}} {
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
{{#if stream}}
    if (!res.ok) await handleResponse<void>(res);
    yield* decodeStream<{{stream.eventType}}>('{{stream.format}}', bodyText(res));
{{else if (eq responseType "void")}}
    await handleResponse<void>(res);
{{else}}
    return handleResponse<{{responseType}}>(res);
{{/if}}
  },

{{/if}}
{{/each}}
} satisfies {{name}}ServiceApi;

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
  async {{#if stream}}*{{/if}}{{serviceMethod}}(input: types.{{inputType}}): {{#if stream}}AsyncGenerator<types.{{stream.eventType}}>{{else}}Promise<{{#if (eq responseType "void")}}void{{else}}types.{{responseType}}{{/if}}>{{/if}} {
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

import type { OverlayResult, OverlayRegistry } from '{{contractPackage}}/overlays/index.js';
import type { ProblemDetails } from '{{contractPackage}}/schemas/types.js';
import { toProblemDetails } from '{{contractPackage}}/errors/index.js';

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
        \`Register it in the overlay registry the routes are given: { \${name}: ... }\`
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
        error: toProblemDetails({
          status: 400,
          message: \`Missing required parameter: \${missing.join(', ')}\`,
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
// AWS Lambda Templates
// =============================================================================

const STARTER_LAMBDA_ROUTES_TEMPLATE = `/**
 * Auto-generated AWS Lambda handler
 * Generated from: {{spec.info.title}} v{{spec.info.version}}
 * DO NOT EDIT MANUALLY
 *
 * Answers the events of an API Gateway HTTP API (payload format 2.0) and of a
 * Lambda function URL: routes each to its operation, validates the request
 * against the contract's schemas, runs the operation's overlays and calls its
 * service — as the Fastify routes do, without Fastify.
 */

import { Ajv, type ValidateFunction } from 'ajv';
import ajvFormats from 'ajv-formats';
import fastJson from 'fast-json-stringify';
import { allSchemas } from '{{contractPackage}}/schemas/index.js';
import type * as types from '{{contractPackage}}/schemas/types.js';
{{!-- A header schema is not registered: it names headers in lower case, as the event carries them --}}
import { {{#each routes}}{{#if parameterSchemas.header}}{{parameterSchemas.header}}, {{/if}}{{/each~}} } from '{{contractPackage}}/schemas/validators.js';
import type { ServiceRegistry } from '{{contractPackage}}/services/index.js';
import { toProblemDetails } from '{{contractPackage}}/errors/index.js';
import { parseCookies } from '{{contractPackage}}/http/index.js';
{{#if extensionInfo.length}}
import type { OverlayRegistry } from '{{contractPackage}}/overlays/index.js';
import { runOverlays } from './overlayAdapter.generated.js';
{{/if}}
{{#if streams}}
import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { encodeStream } from '{{contractPackage}}/streams/index.js';
{{/if}}

// ==========================================================================
// Events
// ==========================================================================

/** What the handler reads of an API Gateway HTTP API event (payload format 2.0) or a function URL event */
export interface HttpApiEvent {
  rawPath: string;
  rawQueryString: string;
  headers?: Record<string, string | undefined>;
  cookies?: string[];
  body?: string;
  isBase64Encoded: boolean;
  requestContext: { http: { method: string } };
}

/** The response the handler answers an event with */
export interface HttpApiResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface HandlerOptions {
  /** The services answering the operations */
  services: ServiceRegistry;
{{#if extensionInfo.length}}
  /** The overlay handlers run before the services */
  overlays: OverlayRegistry;
{{/if}}
  /** What the event's path carries before the spec's paths, such as an API Gateway stage (\`/prod\`) */
  basePath?: string;
}

// ==========================================================================
// Requests and responses
// ==========================================================================

/** A request as its route reads it: the event's parts, parsed */
interface RouteRequest {
  params: Record<string, string>;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  cookies: ReadonlyMap<string, string>;
  /** The route's cookie parameters, by name */
  cookieParams: Record<string, string>;
  body: unknown;
}

/** A response: its body whole, or (a stream operation's) as the service yields it */
interface Answer {
  statusCode: number;
  headers: Record<string, string>;
  body: string{{#if streams}} | AsyncIterable<string>{{/if}};
}

type Serialize = (value: unknown) => string;

/** How a route answers */
interface Reply {
  /** Answer with a status, and a body serialized by the schema declared for the status */
  send(statusCode: number, output?: unknown): Answer;
{{#if streams}}
  /** Answer with a status, and frames as they come */
  stream(statusCode: number, mediaType: string, frames: AsyncIterable<string>): Answer;
{{/if}}
}

interface RouteDefinition {
  method: string;
  /** The path as the spec writes it, \`{name}\` for a parameter */
  path: string;
  /** The validators of the parts of the request, named as Fastify names them */
  params?: ValidateFunction;
  body?: ValidateFunction;
  querystring?: ValidateFunction;
  headers?: ValidateFunction;
  cookies?: ValidateFunction;
  /** The names of the cookie parameters */
  cookieNames?: string[];
  /** The serializers of the declared responses, by status as Fastify reads it: \`200\`, \`4xx\`, \`default\` */
  response: Record<string, Serialize>;
  handler(request: RouteRequest, reply: Reply): Promise<Answer>;
}

interface Route extends RouteDefinition {
  /** Matches the path, capturing the path parameters in order */
  pattern: RegExp;
  names: string[];
  /** Orders routes as Fastify matches them: a literal segment before a parameter */
  rank: string;
}

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/** An error answered with its status */
function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

/** The serializer of a status, looked up as Fastify looks it up: the status, its range (\`4xx\`), then \`default\` */
function serializerOf(response: Record<string, Serialize>, statusCode: number): Serialize {
  return response[statusCode] ?? response[\`\${String(statusCode)[0]}xx\`] ?? response.default ?? JSON.stringify;
}

function replyOf(response: Record<string, Serialize>): Reply {
  return {
    send: (statusCode, output): Answer => output === undefined
      ? { statusCode, headers: {}, body: '' }
      : { statusCode, headers: { 'content-type': JSON_CONTENT_TYPE }, body: serializerOf(response, statusCode)(output) },
{{#if streams}}
    stream: (statusCode, mediaType, frames) =>
      ({ statusCode, headers: { 'content-type': mediaType, 'cache-control': 'no-cache' }, body: frames }),
{{/if}}
  };
}

/**
 * A thrown error as the contract's error shape, with the status it carries
 * (\`status\` or \`statusCode\`, 400 to 599) as Fastify reads it, or 500.
 */
function problemOf(error: unknown): types.ProblemDetails {
  const { status, statusCode, message } = (typeof error === 'object' && error !== null ? error : {}) as Record<string, unknown>;
  const carried = [status, statusCode].find((code): code is number => typeof code === 'number' && code >= 400 && code <= 599);
  return toProblemDetails({
    status: carried ?? 500,
    message: typeof message === 'string' && message !== '' ? message : 'Internal Server Error',
  });
}

/** The headers an error carries to its response, as Fastify sends them */
function headersOf(error: unknown): Record<string, string> {
  const { headers } = (typeof error === 'object' && error !== null ? error : {}) as { headers?: Record<string, string> };
  return headers ?? {};
}

/** A route of the spec's path: a pattern capturing its parameters, and its rank among routes */
function routeOf(definition: RouteDefinition): Route {
  const names: string[] = [];
  const source = definition.path
    .split(/\\{([^}]+)\\}/)
    .map((part, index) => {
      if (index % 2 === 0) return part.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
      names.push(part);
      return '([^/]+)';
    })
    .join('');
  const rank = definition.path.split('/').map(segment => (segment.includes('{') ? '1' : '0')).join('');
  return { ...definition, pattern: new RegExp(\`^\${source}$\`), names, rank };
}

/** A path parameter, decoded as Fastify decodes it */
function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw httpError(400, \`'\${value}' is not a valid url component\`);
  }
}

/** The query of an event: a key given more than once is an array, as Fastify parses it */
function parseQuery(rawQueryString: string): Record<string, string | string[]> {
  const query = new Map<string, string | string[]>();
  for (const [key, value] of new URLSearchParams(rawQueryString)) {
    const given = query.get(key);
    query.set(key, given === undefined ? value : [given, value].flat());
  }
  return Object.fromEntries(query);
}

/** The JSON body of an event, none when it carries none, parsed as Fastify parses it */
function parseBody(event: HttpApiEvent, contentType: string | undefined): unknown {
  if (!event.body) return undefined;
  if (contentType?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw httpError(415, 'Unsupported Media Type');
  }
  const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body;
  let forbidden = false;
  let body: unknown;
  try {
    body = JSON.parse(text, (key, value: unknown) => {
      // A property that would set an object's prototype is refused
      if (key === '__proto__' || (key === 'constructor' && typeof value === 'object' && value !== null && 'prototype' in value)) {
        forbidden = true;
      }
      return value;
    });
  } catch {
    throw httpError(400, "Body is not valid JSON but content-type is set to 'application/json'");
  }
  if (forbidden) throw httpError(400, 'Object contains forbidden prototype property');
  return body;
}

/** Validate a part of the request, coercing it to its schema in place: one that fails is answered with 400 */
function check(validate: ValidateFunction | undefined, data: unknown, part: string): void {
  if (validate && !validate(data ?? null)) {
    throw httpError(400, (validate.errors ?? []).map(error => \`\${part}\${error.instancePath} \${error.message}\`).join(', '));
  }
}

/** Answer an event a route matched: read and validate the request as Fastify does, then run the route */
async function answer(route: Route, values: string[], event: HttpApiEvent): Promise<Answer> {
  const headers = Object.fromEntries(
    Object.entries(event.headers ?? {}).flatMap(([name, value]) => (value === undefined ? [] : [[name.toLowerCase(), value]])),
  );
  const cookies = parseCookies(event.cookies);
  const request: RouteRequest = {
    params: Object.fromEntries(route.names.map((name, index) => [name, decodeParam(values[index])])),
    query: parseQuery(event.rawQueryString),
    headers,
    cookies,
    cookieParams: Object.fromEntries(
      (route.cookieNames ?? []).flatMap(name => {
        const value = cookies.get(name);
        return value === undefined ? [] : [[name, value]];
      }),
    ),
    body: route.body ? parseBody(event, headers['content-type']) : undefined,
  };
  check(route.params, request.params, 'params');
  check(route.body, request.body, 'body');
  check(route.querystring, request.query, 'querystring');
  check(route.headers, request.headers, 'headers');
  check(route.cookies, request.cookieParams, 'cookies');
  return route.handler(request, replyOf(route.response));
}

// ==========================================================================
// Routes
// ==========================================================================

/** Answer each event with its operation, and an error as the contract's error shape */
function createDispatcher(options: HandlerOptions): (event: HttpApiEvent) => Promise<Answer> {
  // Fastify's default validator options, except removeAdditional (see the README, Validators)
  const ajv = new Ajv({ coerceTypes: 'array', useDefaults: true, removeAdditional: false, addUsedSchema: false, allErrors: false });
  ajvFormats.default(ajv);
  for (const schema of allSchemas) ajv.addSchema(schema);
  // The generated schemas are readonly literals; the serializer's option type declares mutable
  // ones of a narrower shape, though it only reads them
  const schemas = Object.fromEntries(allSchemas.map(schema => [schema.$id, schema])) as unknown as Record<string, fastJson.Schema>;
  const serializers = new Map<string, Serialize>();
  /** The serializer of a registered schema, built once */
  const serializer = (name: string): Serialize => {
    let serialize = serializers.get(name);
    if (!serialize) {
      serialize = fastJson({ $ref: \`\${name}#\` }, { schema: schemas });
      serializers.set(name, serialize);
    }
    return serialize;
  };

  const { {{#each services}}{{key}}{{#unless @last}}, {{/unless}}{{/each}} } = options.services;
{{#if extensionInfo.length}}
  const { overlays } = options;
{{/if}}

  const routes: Route[] = [
{{#each routes}}
    // {{httpMethod}} {{path}}{{#if isPublished}} [PUBLISHED]{{/if}}
    routeOf({
      method: '{{httpMethod}}',
      path: '{{path}}',
{{#if parameterSchemas.path}}
      params: ajv.compile({ $ref: '{{parameterSchemas.path}}#' }),
{{/if}}
{{#if requestBody}}
      body: ajv.compile({ $ref: '{{requestBody.schemaName}}#' }),
{{/if}}
{{#if parameterSchemas.query}}
      querystring: ajv.compile({ $ref: '{{parameterSchemas.query}}#' }),
{{/if}}
{{#if parameterSchemas.header}}
      headers: ajv.compile({{parameterSchemas.header}}),
{{/if}}
{{#if parameterSchemas.cookie}}
      cookies: ajv.compile({ $ref: '{{parameterSchemas.cookie}}#' }),
      cookieNames: [{{#each cookieParams}}'{{name}}', {{/each~}} ],
{{/if}}
      response: { {{#each responseSchemas}}'{{status}}': serializer('{{schemaName}}'), {{/each~}} },
      handler: async (request, reply) => {
{{#if extensions.length}}
        const result = await runOverlays('{{operationId}}', overlays, request);
        if (!result.success) return reply.send(result.error.status, result.error);
{{/if}}
        const input: types.{{inputType}} = {
{{#if pathParams.length}}
          ...(request.params as unknown as types.{{typeNameBase}}Params),
{{/if}}
{{#if queryParams.length}}
          ...(request.query as unknown as types.{{typeNameBase}}Params),
{{/if}}
{{#if cookieParams.length}}
          ...(request.cookieParams as unknown as types.{{typeNameBase}}Params),
{{/if}}
{{#if requestBody}}
          data: request.body as types.{{requestBody.schemaName}},
{{/if}}
        };
{{#if stream}}
{{!-- A stream's first event is awaited before anything is answered: a service that fails at once is answered as an error --}}
        const events = {{serviceKey}}.{{serviceMethod}}(input)[Symbol.asyncIterator]();
        const first = await events.next();
        const frames = encodeStream('{{stream.format}}', first, events, serializer('{{stream.eventType}}'), '{{stream.discriminator}}');
        return reply.stream({{successStatus}}, '{{stream.mediaType}}', frames);
{{else if (eq responseType "void")}}
        await {{serviceKey}}.{{serviceMethod}}(input);
        return reply.send({{successStatus}});
{{else}}
        const output = await {{serviceKey}}.{{serviceMethod}}(input);
        return reply.send({{successStatus}}, output);
{{/if}}
      },
    }),
{{/each}}
  ].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));

  return async (event) => {
    let route: Route | undefined;
    try {
      const method = event.requestContext.http.method.toUpperCase();
      const base = options.basePath ?? '';
      const path = event.rawPath === base ? '/' : event.rawPath.startsWith(\`\${base}/\`) ? event.rawPath.slice(base.length) : undefined;
      const matches = path === undefined ? [] : routes.flatMap(candidate => {
        const match = candidate.pattern.exec(path);
        return match ? [{ route: candidate, values: match.slice(1) }] : [];
      });
      const match = matches.find(candidate => candidate.route.method === method);
      if (!match) {
        if (matches.length === 0) throw httpError(404, \`Route \${method}:\${event.rawPath} not found\`);
        throw Object.assign(httpError(405, \`Method \${method} is not allowed on \${event.rawPath}\`), {
          headers: { allow: [...new Set(matches.map(candidate => candidate.route.method))].join(', ') },
        });
      }
      route = match.route;
      return await answer(match.route, match.values, event);
    } catch (error) {
      const problem = problemOf(error);
      if (problem.status >= 500) console.error(error);
      const answered = replyOf(route?.response ?? {}).send(problem.status, problem);
      return { ...answered, headers: { ...answered.headers, ...headersOf(error) } };
    }
  };
}

// ==========================================================================
// Handlers
// ==========================================================================

/**
 * The Lambda handler, answering each event once its response is complete. A
 * stream operation's events are answered together when its stream ends; to
 * send each as the service yields it, use createStreamHandler.
 */
export function createHandler(options: HandlerOptions): (event: HttpApiEvent) => Promise<HttpApiResult> {
  const dispatch = createDispatcher(options);
  return async (event) => {
    const { statusCode, headers, body } = await dispatch(event);
{{#if streams}}
    if (typeof body !== 'string') {
      let text = '';
      for await (const frame of body) text += frame;
      return { statusCode, headers, body: text };
    }
{{/if}}
    return { statusCode, headers, body };
  };
}
{{#if streams}}

/** The response streaming of the Lambda Node.js runtime: a global there */
declare const awslambda: {
  streamifyResponse<H>(handler: H): H;
  HttpResponseStream: {
    from(responseStream: Writable, prelude: { statusCode: number; headers: Record<string, string> }): Writable;
  };
};

/** A Lambda handler answering through the response stream */
export type StreamHandler = (event: HttpApiEvent, responseStream: Writable) => Promise<void>;

/**
 * The Lambda handler for a function URL whose invoke mode is RESPONSE_STREAM:
 * a stream operation sends each event as its service yields it, and the
 * service's iterator is closed when the client goes away. Other operations
 * are answered as createHandler answers them.
 */
export function createStreamHandler(options: HandlerOptions): StreamHandler {
  const dispatch = createDispatcher(options);
  return awslambda.streamifyResponse<StreamHandler>(async (event, responseStream) => {
    const { statusCode, headers, body } = await dispatch(event);
    await pipeline(Readable.from(body), awslambda.HttpResponseStream.from(responseStream, { statusCode, headers }));
  });
}
{{/if}}
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
 * Get the AWS Lambda starter templates (init --lambda)
 */
export function getLambdaStarterTemplates(): Record<string, string> {
  return {
    'lambda-routes.hbs': STARTER_LAMBDA_ROUTES_TEMPLATE,
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
