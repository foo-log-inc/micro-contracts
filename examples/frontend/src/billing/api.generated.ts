/**
 * Auto-generated HTTP Client from OpenAPI specification
 * Generated from: Billing API v1.0.0
 * 
 * DO NOT EDIT MANUALLY
 * 
 * Client API matches Service API signature (single input object).
 * Internally maps input to HTTP request (path params, query params, body).
 * Cookie parameters are optional: the browser sends cookies, the client does not.
 */

import type {
  BillingServiceApi,
} from '@project/contract/billing/services';
import type {
  Billing_createInvoiceInput,
  Billing_getInvoiceByIdInput,
  Billing_getInvoiceByIdParams,
  Billing_getInvoicesInput,
  Billing_getInvoicesParams,
  Billing_payInvoiceInput,
  Billing_payInvoiceParams,
  Billing_watchInvoiceInput,
  Billing_watchInvoiceParams,
  CreateInvoiceRequest,
  Invoice,
  InvoiceEvent,
  InvoiceListResponse,
  PayInvoiceRequest,
  PaymentResult,
  ProblemDetails,
} from '@project/contract/billing/schemas';
import { ApiError } from '@project/contract/billing/errors';
import { decodeStream } from '@project/contract/billing/streams';

// BASE_URL derived from OpenAPI servers[0].url: 
// Can be overridden via environment variable (Vite: VITE_API_BASE_URL)
const BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || '';

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

// ==========================================================================
// Billing API Client
// ==========================================================================
export const billingApi = {
  /**
   * GET /api/billing/invoices
   * List all invoices
   * @published
   */
  async getInvoices(input: Billing_getInvoicesInput): Promise<InvoiceListResponse> {
    const searchParams = new URLSearchParams();
    if (input.userId !== undefined) searchParams.set('userId', String(input.userId));
    if (input.status !== undefined) searchParams.set('status', String(input.status));
    const url = `${BASE_URL}/api/billing/invoices` + (searchParams.toString() ? '?' + searchParams : '');
    const res = await fetch(url);
    return handleResponse<InvoiceListResponse>(res);
  },

  /**
   * POST /api/billing/invoices
   * Create a new invoice
   * @published
   */
  async createInvoice(input: Billing_createInvoiceInput): Promise<Invoice> {
    const url = `${BASE_URL}/api/billing/invoices`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.data),
    });
    return handleResponse<Invoice>(res);
  },

  /**
   * GET /api/billing/invoices/{id}
   * Get invoice by ID
   * @published
   */
  async getInvoiceById(input: Billing_getInvoiceByIdInput): Promise<Invoice> {
    const url = `${BASE_URL}/api/billing/invoices/${input.id}`;
    const res = await fetch(url);
    return handleResponse<Invoice>(res);
  },

  /**
   * GET /api/billing/invoices/{id}/events
   * Watch an invoice
   
   */
  async *watchInvoice(input: Billing_watchInvoiceInput): AsyncGenerator<InvoiceEvent> {
    const url = `${BASE_URL}/api/billing/invoices/${input.id}/events`;
    const res = await fetch(url);
    if (!res.ok) await handleResponse<void>(res);
    yield* decodeStream<InvoiceEvent>('sse', bodyText(res));
  },

  /**
   * POST /api/billing/invoices/{id}/pay
   * Pay an invoice
   * @published
   */
  async payInvoice(input: Billing_payInvoiceInput): Promise<PaymentResult> {
    const url = `${BASE_URL}/api/billing/invoices/${input.id}/pay`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.data),
    });
    return handleResponse<PaymentResult>(res);
  },

} satisfies BillingServiceApi;

