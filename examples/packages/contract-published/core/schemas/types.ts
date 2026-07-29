/**
 * Auto-generated TypeScript types from OpenAPI specification
 * Generated from: Core API v1.0.0
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

export interface User {
  id: string;
  email: string;
  name: string;
  role: ('user' | 'admin');
  status?: ('active' | 'suspended');
  createdAt: string;
  updatedAt?: string;
  internalNotes?: string;
}

export interface UserListResponse {
  users: User[];
  total: number;
  hasMore?: boolean;
}

export interface CreateUserRequest {
  email: string;
  name: string;
  role?: ('user' | 'admin');
}

export interface HealthStatus {
  status: ('healthy' | 'degraded' | 'unhealthy');
  version?: string;
  timestamp?: string;
}

// Operation-specific types
export interface User_getUsersParams {
  limit?: number;
  offset?: number;
}

export type User_getUsersInput = User_getUsersParams;

export type User_createUserInput = { data: CreateUserRequest };

export interface User_getUserByIdParams {
  id: string;
}

export type User_getUserByIdInput = User_getUserByIdParams;

export type Health_checkInput = Record<string, never>;
