/**
 * Auto-generated TypeScript types from OpenAPI specification
 * Generated from: Billing API v1.0.0
 * DO NOT EDIT MANUALLY
 */

/**
 * RFC 9457 Problem Details for HTTP APIs
 * @see https://www.rfc-editor.org/rfc/rfc9457.html
 */
export interface ProblemDetails {
  /** A URI reference that identifies the problem type */
  type: string;
  /** A short, human-readable summary */
  title: string;
  /** The HTTP status code */
  status: number;
  /** A human-readable explanation specific to this occurrence */
  detail?: string;
  /** A URI reference to the specific occurrence */
  instance?: string;
  /** Application-specific error code (SCREAMING_SNAKE_CASE) */
  code?: string;
  /** Request trace ID for debugging */
  traceId?: string;
  /** Detailed validation errors */
  errors?: ValidationError[];
  /** Additional properties */
  [key: string]: unknown;
}

/**
 * Validation error detail
 */
export interface ValidationError {
  /** JSON Pointer to the invalid field */
  pointer: string;
  /** Error message for this field */
  detail: string;
}

export interface Invoice {
  id: string;
  /** Reference to core.User */
  userId: string;
  amount: number;
  currency?: string;
  status: ('draft' | 'pending' | 'paid' | 'overdue');
  description?: string;
  createdAt: string;
  paidAt?: string;
}

export interface InvoiceListResponse {
  invoices: Invoice[];
  total: number;
}

export interface CreateInvoiceRequest {
  /** User ID from core module */
  userId: string;
  amount: number;
  currency?: string;
  description?: string;
}

export interface PayInvoiceRequest {
  paymentMethodId: string;
  savePaymentMethod?: boolean;
}

export interface PaymentResult {
  success: boolean;
  transactionId: string;
  paidAt?: string;
}

// Operation-specific types
export interface Billing_getInvoicesParams {
  /** Filter by user ID */
  userId?: string;
  /** Filter by invoice status */
  status?: ('draft' | 'pending' | 'paid' | 'overdue');
}

export type Billing_getInvoicesInput = Billing_getInvoicesParams;

export type Billing_createInvoiceInput = { data: CreateInvoiceRequest };

export interface Billing_getInvoiceByIdParams {
  id: string;
}

export type Billing_getInvoiceByIdInput = Billing_getInvoiceByIdParams;

export interface Billing_payInvoiceParams {
  id: string;
}

export type Billing_payInvoiceInput = Billing_payInvoiceParams & { data: PayInvoiceRequest };
