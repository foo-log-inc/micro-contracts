# micro-contracts Examples

A sample project for demonstrating micro-contracts functionality.

## Prerequisites

- Node.js 18+
- npm

## Quick Start

```bash
# Install dependencies
npm install
npm run install:all

# Start development servers (server + frontend)
npm run dev
```

- **Server**: http://localhost:3001
- **Frontend**: http://localhost:5173

## Available Commands

### Development

| Command | Description |
|---------|-------------|
| `npm run dev` | Start server (3001) and frontend (5173) concurrently |
| `npm run server:dev` | Start server only |
| `npm run frontend:dev` | Start frontend only |

### Code Generation

| Command | Description |
|---------|-------------|
| `npm run generate` | Regenerate all code from OpenAPI spec |

### Linting

| Command | Description |
|---------|-------------|
| `npm run lint` | Run OpenAPI lint + TypeScript lint |
| `npm run lint:openapi` | Lint source OpenAPI spec (before generation) |
| `npm run lint:openapi:generated` | Lint generated OpenAPI spec (after generation) |
| `npm run lint:ts` | ESLint for TypeScript/TSX |

### Build

| Command | Description |
|---------|-------------|
| `npm run build` | Full build (contract + server + frontend) |
| `npm run build:contract` | Type-check contract packages |
| `npm run build:server` | Build server |
| `npm run build:frontend` | Build frontend |

### AI Guardrails Check

```bash
# Run all checks
npx micro-contracts check

# Run specific checks only
npx micro-contracts check --only lint,typecheck

# Skip specific checks
npx micro-contracts check --skip allowlist
```

### Full Check (for CI)

```bash
npm run check
```

This runs the following in sequence:

1. `lint:openapi` - Lint source OpenAPI spec
2. `generate` - Regenerate code
3. `lint:openapi:generated` - Lint generated OpenAPI spec
4. `lint:ts` - TypeScript lint
5. `build` - Full build

---

## Project Structure

```
examples/
├── spec/                          # OpenAPI specs & templates
│   ├── redocly.yaml               # Global lint rules (Redocly)
│   ├── redocly-plugin.js          # Lint rules the config cannot express
│   ├── default/templates/         # Code generation templates (see below)
│   ├── _shared/
│   │   ├── openapi/               # Shared schemas
│   │   └── overlays/              # Cross-module overlays
│   ├── core/
│   │   ├── openapi/core.yaml      # Core module spec
│   │   └── overlays/              # Module-specific overlays
│   └── billing/
│       ├── openapi/billing.yaml   # Billing module spec
│       └── overlays/
├── packages/
│   ├── contract/                  # Generated contract (internal)
│   └── contract-published/           # Generated contract (public API)
├── server/src/                    # Server implementation
│   ├── core/
│   │   ├── domains/               # Domain implementations
│   │   ├── overlays/              # Overlay handlers
│   │   └── routes.generated.ts    # Generated routes
│   └── billing/
├── frontend/src/                  # Frontend implementation
│   ├── core/api.generated.ts      # Generated API client
│   └── billing/api.generated.ts
├── micro-contracts.config.yaml    # Generator configuration
└── micro-contracts.guardrails.yaml # AI guardrails configuration
```

---

## Templates (`spec/default/templates/`)

The `spec/default/templates/` directory contains Handlebars templates for generating code under `server/` and `frontend/`.

### Template List

| File | Generated File | Description |
|------|----------------|-------------|
| `fastify-routes.hbs` | `server/src/{module}/routes.generated.ts` | Fastify route definitions. Generates HTTP endpoints from OpenAPI and dispatches to Domain methods |
| `fetch-client.hbs` | `frontend/src/{module}/api.generated.ts` | Frontend HTTP client. Executes fetch with the same signature as Domain API |
| `overlay-adapter.hbs` | `server/src/{module}/overlayAdapter.generated.ts` | Overlay execution runtime. Extracts overlay parameters from requests and executes handlers |
| `overlay-stubs.hbs` | (first time only) `server/src/{module}/overlays.ts` | Skeleton implementation of overlay handlers. Used as initial implementation scaffold |
| `domain-stubs.hbs` | (first time only) `server/src/{module}/domains/*.ts` | Skeleton implementation of Domain classes. Used as initial implementation scaffold |

### Generation Source Differences

| Target | Command | Description |
|--------|---------|-------------|
| `spec/default/templates/` | `micro-contracts init` | Creates initial Handlebars template files |
| `packages/contract/` | `micro-contracts generate` | Directly generates type definitions, validators, and Domain interfaces |
| `server/`, `frontend/` | `micro-contracts generate` | Generated from Handlebars templates. Customizable |

### Are templates created by `micro-contracts init`?

**All templates are created by `micro-contracts init`.**

```bash
# Initialize a new project
npx micro-contracts init

# The following are created:
# spec/default/templates/
#   ├── fastify-routes.hbs
#   ├── fetch-client.hbs
#   ├── domain-stubs.hbs
#   ├── overlay-adapter.hbs
#   └── overlay-stubs.hbs
```

### Customizing Templates

Templates can be customized for project-specific requirements:

- **Module-specific templates**: Place in `spec/{module}/templates/` to apply only to that module
- **Default templates**: `spec/default/templates/` applies to all modules (fallback when no module-specific template exists)

```
spec/
├── default/templates/          # Common to all modules (fallback)
│   └── fastify-routes.hbs
└── billing/templates/          # billing module only (priority)
    └── fastify-routes.hbs      # billing-specific customization
```

### Available Template Variables

The following variables are available in templates:

- `{{routes}}` - Array of route information
- `{{domains}}` - Array of Domain information
- `{{contractPackage}}` - Path to contract package
- `{{domainsPath}}` - Path to Fastify's domains object
- `{{extensionInfo}}` - Overlay information
- Other Handlebars helpers (`uppercase`, `camelCase`, `pascalCase`, `kebabCase`, `snakeCase`, `eq`, `if`, `each`, etc.)

---

## API Endpoints

The following is an auto-generated list of APIs from OpenAPI spec.

<!--@embedoc:api_list module="all"-->
| Module | Method | Path | Summary | Public | Middleware | Implementation |
| --- | --- | --- | --- | --- | --- | --- |
| core | GET | /api/users | Get users list | ✅ | requireAuth | [UserDomain.getUsers](server/src/core/domains/UserDomain.ts) |
| core | POST | /api/users | Create new user | ✅ | requireAuth | [UserDomain.createUser](server/src/core/domains/UserDomain.ts) |
| core | GET | /api/users/{id} | Get user by ID | ✅ | requireAuth | [UserDomain.getUserById](server/src/core/domains/UserDomain.ts) |
| core | PUT | /api/users/{id} | Update user |  | requireAuth | [UserDomain.updateUser](server/src/core/domains/UserDomain.ts) |
| core | DELETE | /api/users/{id} | Delete user |  | requireAuth, requireAdmin | [UserDomain.deleteUser](server/src/core/domains/UserDomain.ts) |
| core | GET | /api/tenant/data | Get tenant-scoped data |  | requireAuth, tenantIsolation, rateLimit | [TenantDomain.getData](server/src/core/domains/TenantDomain.ts) |
| core | POST | /api/tenant/data | Create tenant data |  | requireAuth, tenantIsolation, rateLimit | [TenantDomain.createData](server/src/core/domains/TenantDomain.ts) |
| core | GET | /api/admin/stats | Get system statistics |  | requireAuth, requireAdmin | [AdminDomain.getStats](server/src/core/domains/AdminDomain.ts) |
| core | POST | /api/admin/users/{id}/suspend | Suspend user account |  | requireAuth, requireAdmin | [AdminDomain.suspendUser](server/src/core/domains/AdminDomain.ts) |
| core | GET | /api/health | Health check | ✅ |  | [HealthDomain.check](server/src/core/domains/HealthDomain.ts) |
| billing | GET | /api/billing/invoices | List all invoices | ✅ | requireAuth, tenantIsolation | [Billing.getInvoices](server/src/billing/domains/Billing.ts) |
| billing | POST | /api/billing/invoices | Create a new invoice | ✅ | requireAuth, tenantIsolation | [Billing.createInvoice](server/src/billing/domains/Billing.ts) |
| billing | GET | /api/billing/invoices/{id} | Get invoice by ID | ✅ | requireAuth, tenantIsolation | [Billing.getInvoiceById](server/src/billing/domains/Billing.ts) |
| billing | POST | /api/billing/invoices/{id}/pay | Pay an invoice | ✅ | requireAuth, tenantIsolation | [Billing.payInvoice](server/src/billing/domains/Billing.ts) |
<!--@embedoc:end-->

---

## Middleware Cautions

The following cautions are defined in [`spec/_shared/overlays/middleware.overlay.yaml`](spec/_shared/overlays/middleware.overlay.yaml).

<!--@embedoc:overlay_cautions-->
### ⚠️ Auth Token Format

**[WARNING]**

Send the `Authorization` header in `Bearer <token>` format.
Accessing without a token returns 401 Unauthorized.

### 🚨 Tenant Isolation Requirement

**[CRITICAL]**

Endpoints using `tenantIsolation` middleware require
the `X-Tenant-Id` header to be sent.
Missing header returns 400 Bad Request.

### ℹ️ Rate Limit Handling

**[INFO]**

For endpoints with `rateLimit` middleware,
check the `X-RateLimit-Remaining` response header.
When limit is exceeded, 429 Too Many Requests is returned
with `Retry-After` header indicating retry time.

### ⚠️ Admin Endpoint Access Control

**[WARNING]**

Endpoints with `requireAdmin` middleware are accessible
only to users with admin role (`role: admin`).
Non-admin users receive 403 Forbidden.

<!--@embedoc:end-->

---

## Middleware Overlay Definition

The following is an excerpt from the actual overlay definition. The cautions above are synced from this definition.

<!--@embedoc:code_snippet file="spec/_shared/overlays/middleware.overlay.yaml" start="1" end="45" lang="yaml"-->
```yaml
# Cross-cutting concerns overlay
# Injects parameters and responses based on x-middleware markers
overlay: 1.0.0
info:
  title: Middleware Extension Overlay
  version: 1.0.0
  description: |
    This overlay injects cross-cutting concerns based on x-middleware markers:
    - requireAuth: Adds Authorization header + 401 response
    - requireAdmin: Adds 401 + 403 responses  
    - tenantIsolation: Adds X-Tenant-Id header + 400 response
    - rateLimit: Adds X-RateLimit-Limit header + 429 response

# Cautions (implementation notes)
# This data is auto-synced to README.md via embedoc
x-micro-contracts-cautions:
  - id: auth-token-format
    severity: warning
    title: "Auth Token Format"
    message: |
      Send the `Authorization` header in `Bearer <token>` format.
      Accessing without a token returns 401 Unauthorized.

  - id: tenant-isolation
    severity: error
    title: "Tenant Isolation Requirement"
    message: |
      Endpoints using `tenantIsolation` middleware require
      the `X-Tenant-Id` header to be sent.
      Missing header returns 400 Bad Request.

  - id: rate-limit-handling
    severity: info
    title: "Rate Limit Handling"
    message: |
      For endpoints with `rateLimit` middleware,
      check the `X-RateLimit-Remaining` response header.
      When limit is exceeded, 429 Too Many Requests is returned
      with `Retry-After` header indicating retry time.

  - id: admin-endpoints
    severity: warning
    title: "Admin Endpoint Access Control"
    message: |
      Endpoints with `requireAdmin` middleware are accessible
```

📄 Source: `spec/_shared/overlays/middleware.overlay.yaml` (lines 1-45)
<!--@embedoc:end-->

---

## API Usage Examples

### Core Module

```bash
# Health check
curl http://localhost:3001/api/health

# Users (requires auth)
curl -H "Authorization: Bearer test" http://localhost:3001/api/users

# Admin stats (requires admin auth)
curl -H "Authorization: Bearer admin" http://localhost:3001/api/admin/stats
```

### Billing Module

```bash
# Get invoices (requires auth + tenant)
curl -H "Authorization: Bearer test" -H "X-Tenant-Id: tenant-1" \
  http://localhost:3001/api/billing/invoices

# Create invoice
curl -X POST -H "Authorization: Bearer test" -H "X-Tenant-Id: tenant-1" \
  -H "Content-Type: application/json" \
  -d '{"userId":"1","amount":99.99}' \
  http://localhost:3001/api/billing/invoices
```

---

## Workflow

### 1. Edit OpenAPI Spec

Edit `spec/{module}/openapi/*.yaml`

### 2. Lint & Generate

```bash
npm run lint:openapi   # Lint spec
npm run generate       # Generate code
npm run lint:openapi:generated  # Lint generated spec
```

### 3. Implement

- **Server**: Implement domain logic in `server/src/{module}/domains/`
- **Overlay**: Implement overlay handlers in `server/src/{module}/overlays/`

### 4. Build & Test

```bash
npm run lint:ts  # TypeScript lint
npm run build    # Build
npm run dev      # Verify operation
```

### 5. Sync Documentation

```bash
# Update README.md with embedoc
npx embedoc build
```

---

## Documentation Sync

This project uses [embedoc](../../embedoc.js/) to automatically sync information from OpenAPI spec and overlay files to README.md.

### Configuration Files

- [`embedoc.config.yaml`](./embedoc.config.yaml) - embedoc configuration
- [`embeds/`](./embeds/) - Embed scripts

### Synced Content

| Section | Source | Embed |
|---------|--------|-------|
| API Endpoints | `spec/*/openapi/*.yaml` | `api_list` |
| Middleware Cautions | `spec/_shared/overlays/middleware.overlay.yaml` | `overlay_cautions` |
| Code Snippets | Any file | `code_snippet` |

### How to Update

```bash
# Update embedoc markers in README.md
npx embedoc build

# Verify changes
git diff README.md
```

---

## License

MIT
