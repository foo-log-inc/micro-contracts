/**
 * Auto-generated JSON Schemas from OpenAPI specification
 * Generated from: Billing API v1.0.0
 * DO NOT EDIT MANUALLY
 */

export const Invoice = {
    "$id": "Invoice",
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      },
      "userId": {
        "type": "string",
        "description": "Reference to core.User"
      },
      "amount": {
        "type": "number",
        "format": "double"
      },
      "currency": {
        "type": "string",
        "default": "USD"
      },
      "status": {
        "type": "string",
        "enum": [
          "draft",
          "pending",
          "paid",
          "overdue"
        ]
      },
      "description": {
        "type": "string"
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "paidAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "id",
      "userId",
      "amount",
      "status",
      "createdAt"
    ]
  } as const;

export const InvoiceListResponse = {
    "$id": "InvoiceListResponse",
    "type": "object",
    "properties": {
      "invoices": {
        "type": "array",
        "items": {
          "$ref": "Invoice#"
        }
      },
      "total": {
        "type": "integer"
      }
    },
    "required": [
      "invoices",
      "total"
    ]
  } as const;

export const CreateInvoiceRequest = {
    "$id": "CreateInvoiceRequest",
    "type": "object",
    "properties": {
      "userId": {
        "type": "string",
        "description": "User ID from core module"
      },
      "amount": {
        "type": "number",
        "format": "double"
      },
      "currency": {
        "type": "string",
        "default": "USD"
      },
      "description": {
        "type": "string"
      }
    },
    "required": [
      "userId",
      "amount"
    ]
  } as const;

export const PayInvoiceRequest = {
    "$id": "PayInvoiceRequest",
    "type": "object",
    "properties": {
      "paymentMethodId": {
        "type": "string"
      },
      "savePaymentMethod": {
        "type": "boolean",
        "default": false
      }
    },
    "required": [
      "paymentMethodId"
    ]
  } as const;

export const PaymentResult = {
    "$id": "PaymentResult",
    "type": "object",
    "properties": {
      "success": {
        "type": "boolean"
      },
      "transactionId": {
        "type": "string"
      },
      "paidAt": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "success",
      "transactionId"
    ]
  } as const;

export const ValidationError = {
    "$id": "ValidationError",
    "type": "object",
    "properties": {
      "pointer": {
        "type": "string",
        "description": "JSON Pointer to the invalid field"
      },
      "detail": {
        "type": "string",
        "description": "Error message for this field"
      }
    },
    "required": [
      "pointer",
      "detail"
    ]
  } as const;

export const ProblemDetails = {
    "$id": "ProblemDetails",
    "type": "object",
    "description": "RFC 9457 Problem Details for HTTP APIs",
    "properties": {
      "type": {
        "type": "string",
        "description": "A URI reference that identifies the problem type",
        "format": "uri-reference"
      },
      "title": {
        "type": "string",
        "description": "A short, human-readable summary"
      },
      "status": {
        "type": "integer",
        "description": "The HTTP status code"
      },
      "detail": {
        "type": "string",
        "description": "A human-readable explanation specific to this occurrence"
      },
      "instance": {
        "type": "string",
        "description": "A URI reference to the specific occurrence",
        "format": "uri"
      },
      "code": {
        "type": "string",
        "description": "Application-specific error code (SCREAMING_SNAKE_CASE)"
      },
      "traceId": {
        "type": "string",
        "description": "Request trace ID for debugging"
      },
      "errors": {
        "type": "array",
        "description": "Detailed validation errors",
        "items": {
          "$ref": "ValidationError#"
        }
      }
    },
    "required": [
      "type",
      "title",
      "status"
    ]
  } as const;

// Parameter schemas
export const Billing_getInvoicesParams = {
    "$id": "Billing_getInvoicesParams",
    "type": "object",
    "properties": {
      "userId": {
        "type": "string"
      },
      "status": {
        "type": "string",
        "enum": [
          "draft",
          "pending",
          "paid",
          "overdue"
        ]
      }
    }
  } as const;

export const Billing_getInvoiceByIdParams = {
    "$id": "Billing_getInvoiceByIdParams",
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  } as const;

export const Billing_payInvoiceParams = {
    "$id": "Billing_payInvoiceParams",
    "type": "object",
    "properties": {
      "id": {
        "type": "string"
      }
    },
    "required": [
      "id"
    ]
  } as const;


// All schemas for registration
export const allSchemas = [
  Invoice,
  InvoiceListResponse,
  CreateInvoiceRequest,
  PayInvoiceRequest,
  PaymentResult,
  ValidationError,
  ProblemDetails,
  Billing_getInvoicesParams,
  Billing_getInvoiceByIdParams,
  Billing_payInvoiceParams,
] as const;