/**
 * Server Entry Point - Composition Root
 * 
 * This is the ONLY file that knows about:
 * - Framework (Fastify)
 * - Wiring (connecting services and middleware to routes)
 * 
 * Service and middleware implementations are framework-agnostic.
 * 
 * @see https://github.com/example/micro-contracts/tree/main/examples
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

// Import service implementations (framework-agnostic)
import { UserService, AdminService, TenantService, HealthService } from './core/services/index.js';
import { BillingService } from './billing/services/index.js';

// Import overlay implementations (framework-agnostic)
import * as coreOverlays from './core/overlays/index.js';
import * as billingOverlays from './billing/overlays/index.js';

// Import generated routes
import { registerRoutes as registerCoreRoutes } from './core/routes.generated.js';
import { registerRoutes as registerBillingRoutes } from './billing/routes.generated.js';

// Import auto-generated service registries
import type { ServiceRegistry as CoreServiceRegistry } from '@project/contract/core/services/index.js';
import type { ServiceRegistry as BillingServiceRegistry } from '@project/contract/billing/services/index.js';

// Import auto-generated overlay registries
import type { OverlayRegistry as CoreOverlayRegistry } from '@project/contract/core/overlays/index.js';
import type { OverlayRegistry as BillingOverlayRegistry } from '@project/contract/billing/overlays/index.js';

// =============================================================================
// Type Definitions (using auto-generated types)
// =============================================================================

// All services type - composed from auto-generated registries
interface AllServices {
  core: CoreServiceRegistry;
  billing: BillingServiceRegistry;
}

// Combined overlay registry (shared + module-specific)
type CombinedOverlayRegistry = CoreOverlayRegistry & BillingOverlayRegistry;

// =============================================================================
// Fastify Type Augmentation
// =============================================================================

declare module 'fastify' {
  interface FastifyInstance {
    services: AllServices;
    overlayHandlers: CombinedOverlayRegistry;
  }
}

// =============================================================================
// Build Server
// =============================================================================

async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: true,
    // Fastify's default validator options, except removeAdditional: removing
    // properties while trying each member of a oneOf / anyOf rejects or
    // changes valid values (see the README, Validators).
    ajv: {
      customOptions: {
        removeAdditional: false,
      },
    },
  });

  // =========================================================================
  // CORS (for development - allow frontend to call API)
  // =========================================================================
  
  await fastify.register(cors, {
    origin: true, // Allow all origins in development
  });

  // =========================================================================
  // Initialize Services
  // =========================================================================
  
  // Core module services (no external dependencies)
  const userService = new UserService();
  const adminService = new AdminService();
  const tenantService = new TenantService();
  const healthService = new HealthService();
  
  // Billing module services (depends on core.User)
  // Note: BillingService receives CoreUserServiceDeps interface
  const billingService = new BillingService(userService);

  // =========================================================================
  // Composition Root: Wire services
  // =========================================================================
  
  fastify.decorate('services', {
    core: {
      user: userService,
      admin: adminService,
      tenant: tenantService,
      health: healthService,
    },
    billing: {
      billing: billingService,
    },
  });

  // =========================================================================
  // Composition Root: Wire overlay handlers (shared + module-specific)
  // =========================================================================
  
  fastify.decorate('overlayHandlers', {
    // Shared overlays (from core)
    requireAuth: coreOverlays.requireAuth,
    requireAdmin: coreOverlays.requireAdmin,
    tenantIsolation: coreOverlays.tenantIsolation,
    rateLimit: coreOverlays.rateLimit,
    // Module-specific overlays
    validatePaymentMethod: billingOverlays.validatePaymentMethod,
  });

  // =========================================================================
  // Register Generated Routes
  // =========================================================================
  
  await registerCoreRoutes(fastify);
  await registerBillingRoutes(fastify);

  // =========================================================================
  // Error Handler (ProblemDetails format)
  // =========================================================================
  
  fastify.setErrorHandler((error, request, reply) => {
    const err = error as Error & { statusCode?: number };
    const statusCode = err.statusCode ?? 500;
    
    reply.status(statusCode).send({
      type: `/errors/${statusCode === 500 ? 'internal' : 'error'}`,
      title: err.message || 'Internal Server Error',
      status: statusCode,
      detail: err.message,
      traceId: request.id,
    });
  });

  return fastify;
}

// =============================================================================
// Start Server
// =============================================================================

async function main() {
  const server = await buildServer();
  
  try {
    const port = parseInt(process.env.PORT || '3001', 10);
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`\n🚀 Server running at http://localhost:${port}`);
    console.log(`\nCore module endpoints:`);
    console.log(`  curl http://localhost:${port}/api/health`);
    console.log(`  curl -H "Authorization: Bearer test" http://localhost:${port}/api/users`);
    console.log(`  curl -H "Authorization: Bearer admin" http://localhost:${port}/api/admin/stats`);
    console.log(`\nBilling module endpoints (cross-module dependency demo):`);
    console.log(`  curl -H "Authorization: Bearer test" -H "X-Tenant-Id: 3f0e4f5e-1111-4222-8333-444455556666" http://localhost:${port}/api/billing/invoices`);
    console.log(`  curl -X POST -H "Authorization: Bearer test" -H "X-Tenant-Id: 3f0e4f5e-1111-4222-8333-444455556666" -H "Content-Type: application/json" -d '{"userId":"1","amount":99.99}' http://localhost:${port}/api/billing/invoices`);
  } catch (err: unknown) {
    server.log.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
