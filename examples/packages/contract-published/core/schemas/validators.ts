/**
 * Auto-generated JSON Schemas from OpenAPI specification
 * Generated from: Core API v1.0.0
 * DO NOT EDIT MANUALLY
 */

export const User = {
    "$id": "User",
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "uuid"
      },
      "email": {
        "type": "string",
        "format": "email"
      },
      "name": {
        "type": "string"
      },
      "role": {
        "type": "string",
        "enum": [
          "user",
          "admin"
        ]
      },
      "status": {
        "type": "string",
        "enum": [
          "active",
          "suspended"
        ]
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      },
      "updatedAt": {
        "type": "string",
        "format": "date-time"
      },
      "internalNotes": {
        "type": "string"
      }
    },
    "required": [
      "id",
      "email",
      "name",
      "role",
      "createdAt"
    ]
  } as const;

export const UserListResponse = {
    "$id": "UserListResponse",
    "type": "object",
    "properties": {
      "users": {
        "type": "array",
        "items": {
          "$ref": "User#"
        }
      },
      "total": {
        "type": "integer"
      },
      "hasMore": {
        "type": "boolean"
      }
    },
    "required": [
      "users",
      "total"
    ]
  } as const;

export const CreateUserRequest = {
    "$id": "CreateUserRequest",
    "type": "object",
    "properties": {
      "email": {
        "type": "string",
        "format": "email"
      },
      "name": {
        "type": "string",
        "minLength": 1,
        "maxLength": 100
      },
      "role": {
        "type": "string",
        "enum": [
          "user",
          "admin"
        ],
        "default": "user"
      }
    },
    "required": [
      "email",
      "name"
    ]
  } as const;

export const HealthStatus = {
    "$id": "HealthStatus",
    "type": "object",
    "properties": {
      "status": {
        "type": "string",
        "enum": [
          "healthy",
          "degraded",
          "unhealthy"
        ]
      },
      "version": {
        "type": "string"
      },
      "timestamp": {
        "type": "string",
        "format": "date-time"
      }
    },
    "required": [
      "status"
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

// Operation parameter and request body schemas
export const User_getUsersQueryParams = {
    "$id": "User_getUsersQueryParams",
    "type": "object",
    "properties": {
      "limit": {
        "type": "integer",
        "default": 20,
        "maximum": 100
      },
      "offset": {
        "type": "integer",
        "default": 0
      }
    }
  } as const;

export const User_getUserByIdPathParams = {
    "$id": "User_getUserByIdPathParams",
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "format": "uuid"
      }
    },
    "required": [
      "id"
    ]
  } as const;


// All schemas for registration
export const allSchemas = [
  User,
  UserListResponse,
  CreateUserRequest,
  HealthStatus,
  ValidationError,
  ProblemDetails,
  User_getUsersQueryParams,
  User_getUserByIdPathParams,
] as const;