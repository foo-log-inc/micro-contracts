/**
 * Auto-generated JSON Schemas from OpenAPI specification
 * Generated from: Billing API v1.0.0
 * DO NOT EDIT MANUALLY
 */

export const Invoice = {
    "$id": "Invoice",
    "type": "object",
    "required": [
      "id",
      "userId",
      "amount",
      "status",
      "createdAt"
    ],
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
    }
  } as const;

export const InvoiceListResponse = {
    "$id": "InvoiceListResponse",
    "type": "object",
    "required": [
      "invoices",
      "total"
    ],
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
    }
  } as const;

export const CreateInvoiceRequest = {
    "$id": "CreateInvoiceRequest",
    "type": "object",
    "required": [
      "userId",
      "amount"
    ],
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
    }
  } as const;

export const PayInvoiceRequest = {
    "$id": "PayInvoiceRequest",
    "type": "object",
    "required": [
      "paymentMethodId"
    ],
    "properties": {
      "paymentMethodId": {
        "type": "string"
      },
      "savePaymentMethod": {
        "type": "boolean",
        "default": false
      }
    }
  } as const;

export const PaymentResult = {
    "$id": "PaymentResult",
    "type": "object",
    "required": [
      "success",
      "transactionId"
    ],
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
    }
  } as const;

export const ValidationError = {
    "$id": "ValidationError",
    "type": "object",
    "required": [
      "pointer",
      "detail"
    ],
    "properties": {
      "pointer": {
        "type": "string",
        "description": "JSON Pointer to the invalid field"
      },
      "detail": {
        "type": "string",
        "description": "Error message for this field"
      }
    }
  } as const;

export const ProblemDetails = {
    "$id": "ProblemDetails",
    "type": "object",
    "description": "RFC 9457 Problem Details for HTTP APIs",
    "required": [
      "type",
      "title",
      "status"
    ],
    "properties": {
      "type": {
        "type": "string",
        "format": "uri-reference",
        "description": "A URI reference that identifies the problem type"
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
        "format": "uri",
        "description": "A URI reference to the specific occurrence"
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
    }
  } as const;

// Operation parameter and request body schemas
export const Billing_getInvoicesQueryParams = {
    "$id": "Billing_getInvoicesQueryParams",
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

export const Billing_getInvoiceByIdPathParams = {
    "$id": "Billing_getInvoiceByIdPathParams",
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

export const Billing_payInvoicePathParams = {
    "$id": "Billing_payInvoicePathParams",
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
  Billing_getInvoicesQueryParams,
  Billing_getInvoiceByIdPathParams,
  Billing_payInvoicePathParams,
] as const;