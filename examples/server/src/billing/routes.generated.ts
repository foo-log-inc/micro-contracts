/**
 * Auto-generated Fastify routes
 * Generated from: Billing API v1.0.0
 * DO NOT EDIT MANUALLY
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { allSchemas } from '@project/contract/billing/schemas/index.js';
import * as types from '@project/contract/billing/schemas/types.js';
import { runOverlays, toHttpRequest, sendError } from './overlayAdapter.generated.js';

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
      response: { 200: { $ref: 'InvoiceListResponse#' },  },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await runOverlays('getInvoices', handlers, toHttpRequest(req));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.Billing_getInvoicesInput = {
      ...(req.query as types.Billing_getInvoicesParams),
    };
    return billing.getInvoices(input);
  });

  // POST /api/billing/invoices [PUBLISHED]
  fastify.post('/api/billing/invoices', {
    schema: {
      body: { $ref: 'CreateInvoiceRequest#' },
      response: { 201: { $ref: 'Invoice#' },  },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await runOverlays('createInvoice', handlers, toHttpRequest(req));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.Billing_createInvoiceInput = {
      data: req.body as types.CreateInvoiceRequest,
    };
    return billing.createInvoice(input);
  });

  // GET /api/billing/invoices/{id} [PUBLISHED]
  fastify.get('/api/billing/invoices/:id', {
    schema: {
      params: { $ref: 'Billing_getInvoiceByIdPathParams#' },
      response: { 200: { $ref: 'Invoice#' },  },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await runOverlays('getInvoiceById', handlers, toHttpRequest(req));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.Billing_getInvoiceByIdInput = {
      ...(req.params as types.Billing_getInvoiceByIdParams),
    };
    return billing.getInvoiceById(input);
  });

  // POST /api/billing/invoices/{id}/pay [PUBLISHED]
  fastify.post('/api/billing/invoices/:id/pay', {
    schema: {
      params: { $ref: 'Billing_payInvoicePathParams#' },
      body: { $ref: 'PayInvoiceRequest#' },
      response: { 200: { $ref: 'PaymentResult#' },  },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await runOverlays('payInvoice', handlers, toHttpRequest(req));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.Billing_payInvoiceInput = {
      ...(req.params as types.Billing_payInvoiceParams),
      data: req.body as types.PayInvoiceRequest,
    };
    return billing.payInvoice(input);
  });

}
