/**
 * Auto-generated AWS Lambda handler
 * Generated from: Billing API v1.0.0
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
import { allSchemas } from '@project/contract/billing/schemas/index.js';
import type * as types from '@project/contract/billing/schemas/types.js';
import { Billing_getInvoicesHeaderParams, Billing_createInvoiceHeaderParams, Billing_getInvoiceByIdHeaderParams, Billing_watchInvoiceHeaderParams, Billing_payInvoiceHeaderParams, } from '@project/contract/billing/schemas/validators.js';
import type { ServiceRegistry } from '@project/contract/billing/services/index.js';
import { toProblemDetails } from '@project/contract/billing/errors/index.js';
import { parseCookies } from '@project/contract/billing/http/index.js';
import type { OverlayRegistry } from '@project/contract/billing/overlays/index.js';
import { runOverlays } from './overlayAdapter.generated.js';
import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { encodeStream } from '@project/contract/billing/streams/index.js';

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
  /** The overlay handlers run before the services */
  overlays: OverlayRegistry;
  /** What the event's path carries before the spec's paths, such as an API Gateway stage (`/prod`) */
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
  body: string | AsyncIterable<string>;
}

type Serialize = (value: unknown) => string;

/** How a route answers */
interface Reply {
  /** Answer with a status, and a body serialized by the schema declared for the status */
  send(statusCode: number, output?: unknown): Answer;
  /** Answer with a status, and frames as they come */
  stream(statusCode: number, mediaType: string, frames: AsyncIterable<string>): Answer;
}

interface RouteDefinition {
  method: string;
  /** The path as the spec writes it, `{name}` for a parameter */
  path: string;
  /** The validators of the parts of the request, named as Fastify names them */
  params?: ValidateFunction;
  body?: ValidateFunction;
  querystring?: ValidateFunction;
  headers?: ValidateFunction;
  cookies?: ValidateFunction;
  /** The names of the cookie parameters */
  cookieNames?: string[];
  /** The serializers of the declared responses, by status as Fastify reads it: `200`, `4xx`, `default` */
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

/** The serializer of a status, looked up as Fastify looks it up: the status, its range (`4xx`), then `default` */
function serializerOf(response: Record<string, Serialize>, statusCode: number): Serialize {
  return response[statusCode] ?? response[`${String(statusCode)[0]}xx`] ?? response.default ?? JSON.stringify;
}

function replyOf(response: Record<string, Serialize>): Reply {
  return {
    send: (statusCode, output): Answer => output === undefined
      ? { statusCode, headers: {}, body: '' }
      : { statusCode, headers: { 'content-type': JSON_CONTENT_TYPE }, body: serializerOf(response, statusCode)(output) },
    stream: (statusCode, mediaType, frames) =>
      ({ statusCode, headers: { 'content-type': mediaType, 'cache-control': 'no-cache' }, body: frames }),
  };
}

/**
 * A thrown error as the contract's error shape, with the status it carries
 * (`status` or `statusCode`, 400 to 599) as Fastify reads it, or 500.
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
    .split(/\{([^}]+)\}/)
    .map((part, index) => {
      if (index % 2 === 0) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(part);
      return '([^/]+)';
    })
    .join('');
  const rank = definition.path.split('/').map(segment => (segment.includes('{') ? '1' : '0')).join('');
  return { ...definition, pattern: new RegExp(`^${source}$`), names, rank };
}

/** A path parameter, decoded as Fastify decodes it */
function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw httpError(400, `'${value}' is not a valid url component`);
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
    throw httpError(400, (validate.errors ?? []).map(error => `${part}${error.instancePath} ${error.message}`).join(', '));
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
      serialize = fastJson({ $ref: `${name}#` }, { schema: schemas });
      serializers.set(name, serialize);
    }
    return serialize;
  };

  const { billing } = options.services;
  const { overlays } = options;

  const routes: Route[] = [
    // GET /api/billing/invoices [PUBLISHED]
    routeOf({
      method: 'GET',
      path: '/api/billing/invoices',
      querystring: ajv.compile({ $ref: 'Billing_getInvoicesQueryParams#' }),
      headers: ajv.compile(Billing_getInvoicesHeaderParams),
      response: { '200': serializer('InvoiceListResponse'), },
      handler: async (request, reply) => {
        const result = await runOverlays('getInvoices', overlays, request);
        if (!result.success) return reply.send(result.error.status, result.error);
        const input: types.Billing_getInvoicesInput = {
          ...(request.query as unknown as types.Billing_getInvoicesParams),
        };
        const output = await billing.getInvoices(input);
        return reply.send(200, output);
      },
    }),
    // POST /api/billing/invoices [PUBLISHED]
    routeOf({
      method: 'POST',
      path: '/api/billing/invoices',
      body: ajv.compile({ $ref: 'CreateInvoiceRequest#' }),
      headers: ajv.compile(Billing_createInvoiceHeaderParams),
      response: { '201': serializer('Invoice'), },
      handler: async (request, reply) => {
        const result = await runOverlays('createInvoice', overlays, request);
        if (!result.success) return reply.send(result.error.status, result.error);
        const input: types.Billing_createInvoiceInput = {
          data: request.body as types.CreateInvoiceRequest,
        };
        const output = await billing.createInvoice(input);
        return reply.send(201, output);
      },
    }),
    // GET /api/billing/invoices/{id} [PUBLISHED]
    routeOf({
      method: 'GET',
      path: '/api/billing/invoices/{id}',
      params: ajv.compile({ $ref: 'Billing_getInvoiceByIdPathParams#' }),
      headers: ajv.compile(Billing_getInvoiceByIdHeaderParams),
      response: { '200': serializer('Invoice'), },
      handler: async (request, reply) => {
        const result = await runOverlays('getInvoiceById', overlays, request);
        if (!result.success) return reply.send(result.error.status, result.error);
        const input: types.Billing_getInvoiceByIdInput = {
          ...(request.params as unknown as types.Billing_getInvoiceByIdParams),
        };
        const output = await billing.getInvoiceById(input);
        return reply.send(200, output);
      },
    }),
    // GET /api/billing/invoices/{id}/events
    routeOf({
      method: 'GET',
      path: '/api/billing/invoices/{id}/events',
      params: ajv.compile({ $ref: 'Billing_watchInvoicePathParams#' }),
      headers: ajv.compile(Billing_watchInvoiceHeaderParams),
      response: { },
      handler: async (request, reply) => {
        const result = await runOverlays('watchInvoice', overlays, request);
        if (!result.success) return reply.send(result.error.status, result.error);
        const input: types.Billing_watchInvoiceInput = {
          ...(request.params as unknown as types.Billing_watchInvoiceParams),
        };
        const events = billing.watchInvoice(input)[Symbol.asyncIterator]();
        const first = await events.next();
        const frames = encodeStream('sse', first, events, serializer('InvoiceEvent'), 'type');
        return reply.stream(200, 'text/event-stream', frames);
      },
    }),
    // POST /api/billing/invoices/{id}/pay [PUBLISHED]
    routeOf({
      method: 'POST',
      path: '/api/billing/invoices/{id}/pay',
      params: ajv.compile({ $ref: 'Billing_payInvoicePathParams#' }),
      body: ajv.compile({ $ref: 'PayInvoiceRequest#' }),
      headers: ajv.compile(Billing_payInvoiceHeaderParams),
      response: { '200': serializer('PaymentResult'), },
      handler: async (request, reply) => {
        const result = await runOverlays('payInvoice', overlays, request);
        if (!result.success) return reply.send(result.error.status, result.error);
        const input: types.Billing_payInvoiceInput = {
          ...(request.params as unknown as types.Billing_payInvoiceParams),
          data: request.body as types.PayInvoiceRequest,
        };
        const output = await billing.payInvoice(input);
        return reply.send(200, output);
      },
    }),
  ].sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));

  return async (event) => {
    let route: Route | undefined;
    try {
      const method = event.requestContext.http.method.toUpperCase();
      const base = options.basePath ?? '';
      const path = event.rawPath === base ? '/' : event.rawPath.startsWith(`${base}/`) ? event.rawPath.slice(base.length) : undefined;
      const matches = path === undefined ? [] : routes.flatMap(candidate => {
        const match = candidate.pattern.exec(path);
        return match ? [{ route: candidate, values: match.slice(1) }] : [];
      });
      const match = matches.find(candidate => candidate.route.method === method);
      if (!match) {
        if (matches.length === 0) throw httpError(404, `Route ${method}:${event.rawPath} not found`);
        throw Object.assign(httpError(405, `Method ${method} is not allowed on ${event.rawPath}`), {
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
    if (typeof body !== 'string') {
      let text = '';
      for await (const frame of body) text += frame;
      return { statusCode, headers, body: text };
    }
    return { statusCode, headers, body };
  };
}

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
