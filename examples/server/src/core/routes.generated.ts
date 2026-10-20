/**
 * Auto-generated Fastify routes
 * Generated from: Core API v1.0.0
 * DO NOT EDIT MANUALLY
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { allSchemas } from '@project/contract/core/schemas/index.js';
import * as types from '@project/contract/core/schemas/types.js';
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

  const { admin, health, tenant, user } = fastify.services.core;
  const handlers = fastify.overlayHandlers;

  // GET /api/users [PUBLISHED]
  fastify.get('/api/users', {
    schema: {
      querystring: { $ref: 'User_getUsersQueryParams#' },
      response: { '200': { $ref: 'UserListResponse#' } },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await runOverlays('getUsers', handlers, toHttpRequest(req));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.User_getUsersInput = {
      ...(req.query as types.User_getUsersParams),
    };
    const output = await user.getUsers(input);
    return reply.code(200).send(output);
  });

  // POST /api/users [PUBLISHED]
  fastify.post('/api/users', {
    schema: {
      body: { $ref: 'CreateUserRequest#' },
      response: { '201': { $ref: 'User#' } },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await runOverlays('createUser', handlers, toHttpRequest(req));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.User_createUserInput = {
      data: req.body as types.CreateUserRequest,
    };
    const output = await user.createUser(input);
    return reply.code(201).send(output);
  });

  // GET /api/users/{id} [PUBLISHED]
  fastify.get('/api/users/:id', {
    schema: {
      params: { $ref: 'User_getUserByIdPathParams#' },
      response: { '200': { $ref: 'User#' } },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await runOverlays('getUserById', handlers, toHttpRequest(req));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.User_getUserByIdInput = {
      ...(req.params as types.User_getUserByIdParams),
    };
    const output = await user.getUserById(input);
    return reply.code(200).send(output);
  });

  // PUT /api/users/{id}
  fastify.put('/api/users/:id', {
    schema: {
      params: { $ref: 'User_updateUserPathParams#' },
      body: { $ref: 'UpdateUserRequest#' },
      response: { '200': { $ref: 'User#' } },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await runOverlays('updateUser', handlers, toHttpRequest(req));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.User_updateUserInput = {
      ...(req.params as types.User_updateUserParams),
      data: req.body as types.UpdateUserRequest,
    };
    const output = await user.updateUser(input);
    return reply.code(200).send(output);
  });

  // DELETE /api/users/{id}
  fastify.delete('/api/users/:id', {
    schema: {
      params: { $ref: 'User_deleteUserPathParams#' },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await runOverlays('deleteUser', handlers, toHttpRequest(req));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.User_deleteUserInput = {
      ...(req.params as types.User_deleteUserParams),
    };
    await user.deleteUser(input);
    return reply.code(204).send();
  });

  // GET /api/tenant/data
  fastify.get('/api/tenant/data', {
    schema: {
      response: { '200': { $ref: 'TenantData#' } },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await runOverlays('getTenantData', handlers, toHttpRequest(req));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.Tenant_getDataInput = {
    };
    const output = await tenant.getData(input);
    return reply.code(200).send(output);
  });

  // POST /api/tenant/data
  fastify.post('/api/tenant/data', {
    schema: {
      body: { $ref: 'CreateTenantDataRequest#' },
      response: { '201': { $ref: 'TenantData#' } },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await runOverlays('createTenantData', handlers, toHttpRequest(req));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.Tenant_createDataInput = {
      data: req.body as types.CreateTenantDataRequest,
    };
    const output = await tenant.createData(input);
    return reply.code(201).send(output);
  });

  // GET /api/admin/stats
  fastify.get('/api/admin/stats', {
    schema: {
      response: { '200': { $ref: 'SystemStats#' } },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await runOverlays('getSystemStats', handlers, toHttpRequest(req));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.Admin_getStatsInput = {
    };
    const output = await admin.getStats(input);
    return reply.code(200).send(output);
  });

  // POST /api/admin/users/{id}/suspend
  fastify.post('/api/admin/users/:id/suspend', {
    schema: {
      params: { $ref: 'Admin_suspendUserPathParams#' },
      body: { $ref: 'SuspendUserRequest#' },
      response: { '200': { $ref: 'User#' } },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const result = await runOverlays('suspendUser', handlers, toHttpRequest(req));
    if (!result.success) return sendError(reply, result.error);
    // Build input object (always required, even if empty)
    const input: types.Admin_suspendUserInput = {
      ...(req.params as types.Admin_suspendUserParams),
      data: req.body as types.SuspendUserRequest,
    };
    const output = await admin.suspendUser(input);
    return reply.code(200).send(output);
  });

  // GET /api/health [PUBLISHED]
  fastify.get('/api/health', {
    schema: {
      response: { '200': { $ref: 'HealthStatus#' } },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    // Build input object (always required, even if empty)
    const input: types.Health_checkInput = {
    };
    const output = await health.check(input);
    return reply.code(200).send(output);
  });

}
