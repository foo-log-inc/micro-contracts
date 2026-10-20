/**
 * Auto-generated JSON Schemas from OpenAPI specification
 * Generated from: Core API v1.0.0
 * DO NOT EDIT MANUALLY
 */

export const User = {
    "$id": "User",
    "type": "object",
    "required": [
      "id",
      "email",
      "name",
      "role",
      "createdAt"
    ],
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
    }
  } as const;

export const UserListResponse = {
    "$id": "UserListResponse",
    "type": "object",
    "required": [
      "users",
      "total"
    ],
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
    }
  } as const;

export const CreateUserRequest = {
    "$id": "CreateUserRequest",
    "type": "object",
    "required": [
      "email",
      "name"
    ],
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
    }
  } as const;

export const UpdateUserRequest = {
    "$id": "UpdateUserRequest",
    "type": "object",
    "properties": {
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
        ]
      }
    }
  } as const;

export const TenantData = {
    "$id": "TenantData",
    "type": "object",
    "required": [
      "id",
      "tenantId",
      "data"
    ],
    "properties": {
      "id": {
        "type": "string",
        "format": "uuid"
      },
      "tenantId": {
        "type": "string",
        "format": "uuid"
      },
      "data": {
        "type": "object",
        "additionalProperties": true
      },
      "createdAt": {
        "type": "string",
        "format": "date-time"
      }
    }
  } as const;

export const CreateTenantDataRequest = {
    "$id": "CreateTenantDataRequest",
    "type": "object",
    "required": [
      "data"
    ],
    "properties": {
      "data": {
        "type": "object",
        "additionalProperties": true
      }
    }
  } as const;

export const SystemStats = {
    "$id": "SystemStats",
    "type": "object",
    "required": [
      "userCount",
      "activeUsers",
      "tenantCount"
    ],
    "properties": {
      "userCount": {
        "type": "integer"
      },
      "activeUsers": {
        "type": "integer"
      },
      "tenantCount": {
        "type": "integer"
      },
      "uptime": {
        "type": "number",
        "description": "Uptime in seconds"
      }
    }
  } as const;

export const SuspendUserRequest = {
    "$id": "SuspendUserRequest",
    "type": "object",
    "required": [
      "reason"
    ],
    "properties": {
      "reason": {
        "type": "string",
        "minLength": 10,
        "maxLength": 500
      }
    }
  } as const;

export const HealthStatus = {
    "$id": "HealthStatus",
    "type": "object",
    "required": [
      "status"
    ],
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

// Operation parameter, request body and response schemas
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

export const User_updateUserPathParams = {
    "$id": "User_updateUserPathParams",
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

export const User_deleteUserPathParams = {
    "$id": "User_deleteUserPathParams",
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

export const Admin_suspendUserPathParams = {
    "$id": "Admin_suspendUserPathParams",
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
  UpdateUserRequest,
  TenantData,
  CreateTenantDataRequest,
  SystemStats,
  SuspendUserRequest,
  HealthStatus,
  ValidationError,
  ProblemDetails,
  User_getUsersQueryParams,
  User_getUserByIdPathParams,
  User_updateUserPathParams,
  User_deleteUserPathParams,
  Admin_suspendUserPathParams,
] as const;