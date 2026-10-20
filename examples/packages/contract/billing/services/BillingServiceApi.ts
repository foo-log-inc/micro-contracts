/**
 * Billing Service API Interface
 * Auto-generated from OpenAPI specification
 * DO NOT EDIT MANUALLY
 */

import type {
  Billing_createInvoiceInput,
  Billing_getInvoiceByIdInput,
  Billing_getInvoicesInput,
  Billing_payInvoiceInput,
  Billing_watchInvoiceInput,
  Invoice,
  InvoiceEvent,
  InvoiceListResponse,
  PaymentResult,
} from '../schemas/types.js';

export interface BillingServiceApi {
  /**
   * GET /api/billing/invoices
   */
  getInvoices(input: Billing_getInvoicesInput): Promise<InvoiceListResponse>;

  /**
   * POST /api/billing/invoices
   */
  createInvoice(input: Billing_createInvoiceInput): Promise<Invoice>;

  /**
   * GET /api/billing/invoices/{id}
   */
  getInvoiceById(input: Billing_getInvoiceByIdInput): Promise<Invoice>;

  /**
   * GET /api/billing/invoices/{id}/events
   * @internal Not included in public contract
   */
  watchInvoice(input: Billing_watchInvoiceInput): AsyncIterable<InvoiceEvent>;

  /**
   * POST /api/billing/invoices/{id}/pay
   */
  payInvoice(input: Billing_payInvoiceInput): Promise<PaymentResult>;

}