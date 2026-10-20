/**
 * Auto-generated HTTP Client from OpenAPI specification
 * Generated from: Core API v1.0.0
 * 
 * DO NOT EDIT MANUALLY
 * 
 * This client is generated from a custom template.
 * Customize spec/core/templates/client.hbs to change the output.
 */

import type {
  AdminServiceApi,
  HealthServiceApi,
  TenantServiceApi,
  UserServiceApi,
} from '@project/contract/core/services';
import type {
  Admin_getStatsInput,
  Admin_suspendUserInput,
  Admin_suspendUserParams,
  CreateTenantDataRequest,
  CreateUserRequest,
  HealthStatus,
  Health_checkInput,
  ProblemDetails,
  Session,
  SuspendUserRequest,
  SystemStats,
  TenantData,
  Tenant_createDataInput,
  Tenant_getDataInput,
  UpdateUserRequest,
  User,
  UserListResponse,
  User_createUserInput,
  User_deleteUserInput,
  User_deleteUserParams,
  User_getSessionClientInput,
  User_getSessionInput,
  User_getSessionParams,
  User_getUserByIdInput,
  User_getUserByIdParams,
  User_getUsersInput,
  User_getUsersParams,
  User_updateUserInput,
  User_updateUserParams,
} from '@project/contract/core/schemas';
import { ApiError } from '@project/contract/core/errors';

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

// ==========================================================================
// Admin API Client
// ==========================================================================
export const adminApi = {
  /**
   * GET /api/admin/stats
   * Get system statistics
   
   */
  async getStats(input: Admin_getStatsInput): Promise<SystemStats> {
    const url = `${BASE_URL}/api/admin/stats`;
    const res = await fetch(url);
    return handleResponse<SystemStats>(res);
  },

  /**
   * POST /api/admin/users/{id}/suspend
   * Suspend user account
   
   */
  async suspendUser(input: Admin_suspendUserInput): Promise<User> {
    const url = `${BASE_URL}/api/admin/users/${input.id}/suspend`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.data),
    });
    return handleResponse<User>(res);
  },

} satisfies AdminServiceApi;

// ==========================================================================
// Health API Client
// ==========================================================================
export const healthApi = {
  /**
   * GET /api/health
   * Health check
   * @published
   */
  async check(input: Health_checkInput): Promise<HealthStatus> {
    const url = `${BASE_URL}/api/health`;
    const res = await fetch(url);
    return handleResponse<HealthStatus>(res);
  },

} satisfies HealthServiceApi;

// ==========================================================================
// Tenant API Client
// ==========================================================================
export const tenantApi = {
  /**
   * GET /api/tenant/data
   * Get tenant-scoped data
   
   */
  async getData(input: Tenant_getDataInput): Promise<TenantData> {
    const url = `${BASE_URL}/api/tenant/data`;
    const res = await fetch(url);
    return handleResponse<TenantData>(res);
  },

  /**
   * POST /api/tenant/data
   * Create tenant data
   
   */
  async createData(input: Tenant_createDataInput): Promise<TenantData> {
    const url = `${BASE_URL}/api/tenant/data`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.data),
    });
    return handleResponse<TenantData>(res);
  },

} satisfies TenantServiceApi;

// ==========================================================================
// User API Client
// ==========================================================================
export const userApi = {
  /**
   * GET /api/users
   * Get users list
   * @published
   */
  async getUsers(input: User_getUsersInput): Promise<UserListResponse> {
    const searchParams = new URLSearchParams();
    if (input.limit !== undefined) searchParams.set('limit', String(input.limit));
    if (input.offset !== undefined) searchParams.set('offset', String(input.offset));
    const url = `${BASE_URL}/api/users` + (searchParams.toString() ? '?' + searchParams : '');
    const res = await fetch(url);
    return handleResponse<UserListResponse>(res);
  },

  /**
   * POST /api/users
   * Create new user
   * @published
   */
  async createUser(input: User_createUserInput): Promise<User> {
    const url = `${BASE_URL}/api/users`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.data),
    });
    return handleResponse<User>(res);
  },

  /**
   * GET /api/users/{id}
   * Get user by ID
   * @published
   */
  async getUserById(input: User_getUserByIdInput): Promise<User> {
    const url = `${BASE_URL}/api/users/${input.id}`;
    const res = await fetch(url);
    return handleResponse<User>(res);
  },

  /**
   * PUT /api/users/{id}
   * Update user
   
   */
  async updateUser(input: User_updateUserInput): Promise<User> {
    const url = `${BASE_URL}/api/users/${input.id}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.data),
    });
    return handleResponse<User>(res);
  },

  /**
   * DELETE /api/users/{id}
   * Delete user
   
   */
  async deleteUser(input: User_deleteUserInput): Promise<void> {
    const url = `${BASE_URL}/api/users/${input.id}`;
    const res = await fetch(url, { method: 'DELETE' });
    await handleResponse<void>(res);
  },

  /**
   * GET /api/session
   * Current session
   
   */
  async getSession(input: User_getSessionClientInput): Promise<Session> {
    const url = `${BASE_URL}/api/session`;
    const res = await fetch(url);
    return handleResponse<Session>(res);
  },

} satisfies UserServiceApi;

