/**
 * Auto-generated Fastify routes
 * Generated from: Billing API v1.0.0
 * DO NOT EDIT MANUALLY
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { allSchemas } from '@project/contract/billing/schemas/index.js';
import * as types from '@project/contract/billing/schemas/types.js';
import { Billing_getInvoicesHeaderParams, Billing_createInvoiceHeaderParams, Billing_getInvoiceByIdHeaderParams, Billing_watchInvoiceHeaderParams, Billing_payInvoiceHeaderParams, } from '@project/contract/billing/schemas/validators.js';
import { runOverlays, type HttpRequest } from './overlayAdapter.generated.js';
import { Readable } from 'node:stream';
import { encodeStream } from '@project/contract/billing/streams/index.js';
import { parseCookies } from '@project/contract/billing/http/index.js';

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

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  // A component referenced from a shared file is a schema of every module that
  // references it: the first module registers it, and a module defining a
  // different schema under the same id is an error.
  for (const schema of allSchemas) {
    const registered = fastify.getSchema(schema.$id);
    if (registered === undefined) {
      fastify.addSchema(schema);
    } else if (JSON.stringify(registered) !== JSON.stringify(schema)) {
      throw new Error(`Schema '${schema.$id}' is already registered with a different definition`);
    }
  }

  const { billing } = fastify.services.billing;
  const handlers = fastify.overlayHandlers;

  // GET /api/billing/invoices [PUBLISHED]
  fastify.get('/api/billing/invoices', {
    schema: {
      querystring: { $ref: 'Billing_getInvoicesQueryParams#' },
      headers: Billing_getInvoicesHeaderParams,
      response: { '200': { $ref: 'InvoiceListResponse#' } },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const cookies = parseCookies(req.headers.cookie);
    const result = await runOverlays('getInvoices', handlers, toHttpRequest(req, cookies));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.Billing_getInvoicesInput = {
      ...(req.query as types.Billing_getInvoicesParams),
    };
    const output = await billing.getInvoices(input);
    return reply.code(200).send(output);
  });

  // POST /api/billing/invoices [PUBLISHED]
  fastify.post('/api/billing/invoices', {
    schema: {
      headers: Billing_createInvoiceHeaderParams,
      body: { $ref: 'CreateInvoiceRequest#' },
      response: { '201': { $ref: 'Invoice#' } },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const cookies = parseCookies(req.headers.cookie);
    const result = await runOverlays('createInvoice', handlers, toHttpRequest(req, cookies));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.Billing_createInvoiceInput = {
      data: req.body as types.CreateInvoiceRequest,
    };
    const output = await billing.createInvoice(input);
    return reply.code(201).send(output);
  });

  // GET /api/billing/invoices/{id} [PUBLISHED]
  fastify.get('/api/billing/invoices/:id', {
    schema: {
      params: { $ref: 'Billing_getInvoiceByIdPathParams#' },
      headers: Billing_getInvoiceByIdHeaderParams,
      response: { '200': { $ref: 'Invoice#' } },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const cookies = parseCookies(req.headers.cookie);
    const result = await runOverlays('getInvoiceById', handlers, toHttpRequest(req, cookies));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.Billing_getInvoiceByIdInput = {
      ...(req.params as types.Billing_getInvoiceByIdParams),
    };
    const output = await billing.getInvoiceById(input);
    return reply.code(200).send(output);
  });

  // GET /api/billing/invoices/{id}/events
  const Billing_watchInvoiceEventSchema = { $ref: 'InvoiceEvent#' };
  fastify.get('/api/billing/invoices/:id/events', {
    schema: {
      params: { $ref: 'Billing_watchInvoicePathParams#' },
      headers: Billing_watchInvoiceHeaderParams,
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const cookies = parseCookies(req.headers.cookie);
    const result = await runOverlays('watchInvoice', handlers, toHttpRequest(req, cookies));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.Billing_watchInvoiceInput = {
      ...(req.params as types.Billing_watchInvoiceParams),
    };
    const events = billing.watchInvoice(input)[Symbol.asyncIterator]();
    const first = await events.next();
    const serialize = reply.compileSerializationSchema(Billing_watchInvoiceEventSchema);
    reply.code(200).header('content-type', 'text/event-stream').header('cache-control', 'no-cache');
    return reply.send(Readable.from(encodeStream('sse', first, events, serialize, 'type')));
  });

  // POST /api/billing/invoices/{id}/pay [PUBLISHED]
  fastify.post('/api/billing/invoices/:id/pay', {
    schema: {
      params: { $ref: 'Billing_payInvoicePathParams#' },
      headers: Billing_payInvoiceHeaderParams,
      body: { $ref: 'PayInvoiceRequest#' },
      response: { '200': { $ref: 'PaymentResult#' } },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const cookies = parseCookies(req.headers.cookie);
    const result = await runOverlays('payInvoice', handlers, toHttpRequest(req, cookies));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.Billing_payInvoiceInput = {
      ...(req.params as types.Billing_payInvoiceParams),
      data: req.body as types.PayInvoiceRequest,
    };
    const output = await billing.payInvoice(input);
    return reply.code(200).send(output);
  });

}
