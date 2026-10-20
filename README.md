# micro-contracts

[![npm version](https://img.shields.io/npm/v/micro-contracts.svg)](https://www.npmjs.com/package/micro-contracts) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![OpenAPI](https://img.shields.io/badge/OpenAPI-3.x-6BA539?logo=openapiinitiative&logoColor=white)](https://www.openapis.org/)

**Contract-first vertical slices for TypeScript Web/API systems.**

micro-contracts is a contract-first toolchain for TypeScript Web/API development. It tackles common failure modes—**frontend/backend contract drift**, **duplicated "common" rules**, and **accidental breaking changes in public APIs**—by treating **OpenAPI as the Single Source of Truth (SSoT)**.

Contracts alone aren't enough—they must be **enforceable**. micro-contracts includes **[Enforceable Guardrails](docs/development-guardrails.md)** that prevent both humans and AI from bypassing the contract-first workflow: generated files may only change by regenerating them (drift and manifest integrity), changes stay inside allowed paths, and the contract itself is linted before anything is generated.

## Design Philosophy

![Architecture](docs/architecture.svg)

The core architecture is organized along two axes:

| Axis | Description | Example |
|------|-------------|---------|
| **Vertical (feature-aligned slices)** | A *module* is a feature-aligned contract boundary. The same contract spans UI (frontend) and API (backend). | `core`, `billing`, `users` |
| **Horizontal (cross-cutting concerns)** | Auth, tenancy, rate limiting, and shared error behavior are applied consistently via **OpenAPI Overlays**. | `x-middleware: [requireAuth, tenantIsolation]` |

### Key Differentiators

| # | Differentiator | What it means |
|---|----------------|---------------|
| 1 | **Vertical Modules + Horizontal Overlays** | Feature-aligned modules as contract boundaries; cross-cutting concerns (auth, rate-limit) injected via [OpenAPI Overlays](https://www.openapis.org/blog/2024/10/22/announcing-overlay-specification). |
| 2 | **OpenAPI as SSoT → Multi-artifact generation** | Single spec generates contract packages, server routes, and frontend clients. No manual sync required. |
| 3 | **Enforceable Guardrails** | Built-in checks prevent bypassing contract-first workflow—allowlist for changed paths, drift detection and manifest integrity for generated artifacts, plus your own commands as gated checks. See **[Guardrails](docs/development-guardrails.md)**. |
| 4 | **Public Surface Governance** | `contract-published` is extracted (not duplicated) from the master contract. `x-micro-contracts-non-exportable` fails generation if internal data leaks. |
| 5 | **Explicit Module Dependencies** | `x-micro-contracts-depend-on` declares cross-module dependencies. `deps/` re-exports only the types the declared operations reach; enables impact analysis. |
| 6 | **Screen Spec** | Declare frontend screen contracts (ViewModel, navigation, analytics events) in OpenAPI. One YAML drives typed navigation maps and event hooks. See **[Screen Spec](docs/screen-spec.md)**. |

---

## Who is this for?

| Scenario | Why micro-contracts helps |
|----------|---------------------------|
| **Modular monolith → microservices** | Same contracts work in monolith or split services; dependency tracking prevents hidden coupling |
| **Multiple teams sharing OpenAPI** | Explicit module dependencies make cross-team impact visible |
| **Published API with compatibility SLA** | `contract-published` extraction + `x-micro-contracts-non-exportable` fail-fast prevents accidental exposure |
| **Cross-cutting concerns at scale** | OpenAPI Overlays inject auth/rate-limit/tenancy and extension properties without copy-paste |

**Not the best fit for:** Single-developer projects, auto-generated UI from schema, multi-language SDK generation (use OpenAPI Generator instead).

---

## Quick Start

> **Prerequisites**: Node.js 18+, TypeScript 5.0+, ESM (`"type": "module"`).

```bash
# 1. Install
npm install --save-dev micro-contracts

# 2. Initialize module structure
npx micro-contracts init core --openapi path/to/your/spec.yaml

# 3. Generate all code
npx micro-contracts generate
```

```typescript
// 4. Use in your server
import { registerRoutes } from './core/routes.generated.js';
await registerRoutes(fastify);
```

> **What `init` creates**: The `init` command creates starter templates for **Fastify** (server) and **fetch API** (client).
> These are scaffolds to get you started — modify them for your framework (Express, Hono, Axios, etc.) or add new output types.
>
> **📦 Full working example**: See [`examples/`](./examples/) for a complete project with multiple modules, overlays, and cross-module dependencies.

---

## Core Concepts

### OpenAPI as Single Source of Truth (SSoT)

```
OpenAPI spec (spec/{module}/openapi/*.yaml)
    ↓ micro-contracts generate
Contract packages (packages/contract/{module}/)
    ├── schemas/types.ts       # Request/Response types
    ├── services/              # Service interfaces
    └── overlays/              # Overlay handler interfaces
    ↓
Server routes + Frontend clients (generated via templates)
```

### Modules vs Services

| Concept | Definition | Example |
|---------|------------|---------|
| **Module** | Logical contract boundary (OpenAPI + Service) | `core`, `billing`, `users` |
| **Service** | Deployment unit (can contain 1+ modules) | `api-server` |

A monolith may have multiple modules in one service. Start with multiple modules in one service and split later as needed.

### Contract Packages

| Package | Description | Compatibility Policy |
|---------|-------------|---------------------|
| `contract` | Master contract (all APIs) | Internal APIs can change freely |
| `contract-published` | Public APIs only (`x-micro-contracts-published: true`) | Must maintain backward compatibility |

**Key insight**: `contract-published` is **extracted from** `contract` (not generated separately). This ensures a single SSoT.

### Cross-cutting Concerns with Overlays

1. Mark operations with `x-middleware` (or custom extensions) in OpenAPI
2. Define overlay that adds params/responses when extension is present
3. Generator applies overlays and produces `openapi.generated.yaml`
4. Generate code from the result

> **📖 Deep Dive**: See **[OpenAPI Overlays (Deep Dive)](docs/overlays-deep-dive.md)** for complete examples and configuration.

### Screen Spec — Frontend Screen Contracts

Standard OpenAPI constructs can also define **frontend screen contracts** — bridging the API layer and UI components. A single YAML file drives ViewModel types, typed navigation maps, and analytics event hooks.

```
Screen Spec (OpenAPI YAML)
  ├── ViewModel Types       (from schemas — zero new template work)
  ├── Navigation Map        (from response links → typed routing)
  ├── Event Hooks           (from inline x-event → typed analytics)
  └── Interaction Bindings  (from x-interactions → typed in-page interactions)
```

Enable with `screen: true` in module config:

```yaml
modules:
  myScreens:
    openapi: spec/screens/screens.yaml
    screen: true
    outputs:
      screen-navigation:
        output: frontend/src/screens/navigation.generated.ts
        template: spec/default/templates/screen-navigation.hbs
      screen-events:
        output: frontend/src/screens/events.generated.ts
        template: spec/default/templates/screen-events.hbs
```

Initialize a screen module with starter files:

```bash
npx micro-contracts init myScreens --screens
```

> **📖 Deep Dive**: See **[Screen Spec](docs/screen-spec.md)** for the full guide — YAML structure, `x-screen-*` extensions, `TemplateContext.screens`, lint rules, and custom template examples.

---

## Directory Structure

```
project/
├── spec/                              # ✅ Human-edited (contract source of truth)
│   ├── redocly.yaml                   #    Global lint rules (Redocly)
│   ├── default/templates/             #    Handlebars templates (customizable)
│   ├── _shared/
│   │   ├── openapi/                   #    Shared schemas (ProblemDetails, etc.)
│   │   └── overlays/                  #    Cross-module overlays
│   └── {module}/
│       ├── openapi/{module}.yaml      #    OpenAPI spec
│       └── overlays/                  #    Module-specific overlays
│
├── packages/                          # ❌ Auto-generated (DO NOT EDIT)
│   ├── contract/{module}/
│   │   ├── schemas/                   #    Types, validators
│   │   ├── services/                  #    Service interfaces
│   │   ├── overlays/                  #    Overlay handler interfaces
│   │   └── deps/                      #    Re-exports from dependencies
│   └── contract-published/{module}/   #    Public API subset
│
├── server/src/{module}/
│   ├── routes.generated.ts            # ❌ Auto-generated (template: fastify-routes.hbs)
│   ├── services/                      # ✅ Human-edited (service implementations)
│   └── overlays/                      # ✅ Human-edited (overlay implementations)
│
└── frontend/src/{module}/
    └── api.generated.ts               # ❌ Auto-generated (template: fetch-client.hbs)
```

> **Note**: `*.generated.ts` files are generated from Handlebars templates in `spec/default/templates/`.
> You can customize or replace templates for different frameworks (Express, Hono, Axios, etc.).
>
> **Why commit generated files?** Generated artifacts are committed to enable code review of contract changes and CI drift detection. If spec changes but generated code doesn't match, CI fails.

---

## OpenAPI Extensions

### Required Extensions

| Extension | Type | Description |
|-----------|------|-------------|
| `x-micro-contracts-service` | string | Service class name (e.g., `User`, `Order`) |
| `x-micro-contracts-method` | string | Method name to call (should match `operationId`) |

### Optional Extensions

| Extension | Type | Description |
|-----------|------|-------------|
| `x-micro-contracts-published` | boolean | Include in `contract-published` (compatibility SLA) |
| `x-micro-contracts-non-exportable` | boolean | Operation- or schema-level. Linting fails when a published endpoint can reach it (`PUBLIC_ENDPOINT_NON_EXPORTABLE`) |
| `x-micro-contracts-depend-on` | string[] | Explicit dependencies on other modules' published APIs |
| `x-private` | boolean | Schema-level. A published endpoint that can reach it fails linting (`PUBLIC_ENDPOINT_PRIVATE_RESPONSE`) |

"Can reach it" covers every way one schema refers to another (properties, array
items, `additionalProperties`, `allOf`/`oneOf`/`anyOf`, `$ref` targets) and every
part of an operation that reaches a schema: request bodies, parameters and
responses of any status code, including through `components.requestBodies`,
`components.parameters` and `components.responses`. `contract-published` contains
exactly what that same reachability finds, so nothing can ship unchecked. The same
reachability enforces `x-micro-contracts-non-exportable`.

### Screen Spec Extensions

Used in modules with `screen: true`. See **[Screen Spec](docs/screen-spec.md)** for details.

| Extension | Type | Placement | Description |
|-----------|------|-----------|-------------|
| `x-screen-const` | string | GET operation | Stable constant name (e.g., `HOME`) |
| `x-screen-id` | string | GET operation | Traceability ID (e.g., `SCR-001`) |
| `x-screen-name` | string | GET operation | Generated symbol name (e.g., `HomePage`) |
| `x-back-navigation` | boolean | GET operation | Supports history-based back navigation |
| `x-event` | string \| object \| `$ref` | GET / links / post,put,patch,delete / x-interactions | Inline analytics event declaration (v0.14+) |
| `x-interactions` | array | GET operation | In-page interaction bindings with optional events (v0.14+) |
| `x-events` | array | GET operation | **Deprecated** — use inline `x-event` instead |

### Example

```yaml
paths:
  /api/users:
    get:
      operationId: getUsers
      x-micro-contracts-service: User
      x-micro-contracts-method: getUsers
      x-micro-contracts-published: true
      x-middleware: [requireAuth]            # Custom extension for overlays
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/UserListResponse'
```

### References into Other Files

A `$ref` may point into another file, relative to the file that holds it, when it points at a component — for example `'../../_shared/openapi/problem-details.yaml#/components/responses/NotFound'`, or a screen spec's ViewModel referencing `'../orders/openapi.yaml#/components/schemas/Order'`. Generation brings the component, and everything it references, into the module's own `components`: types, validators, routes and `openapi.generated.yaml` all use it under its own name. A reference into another file that points at anything other than a component, `#/components/<section>/<name>`, is an error, and so is a component brought in under a name the module already uses for a different definition.

### Module Dependencies

Declare dependencies with `x-micro-contracts-depend-on`:

```yaml
# spec/billing/openapi/billing.yaml
info:
  x-micro-contracts-depend-on:
    - core.User.getUsers
    - core.User.getUserById
```

Import via generated `deps/`:

```typescript
// ✅ Recommended: Import from deps/
import type { User } from '@project/contract/billing/deps/core';

// ❌ Avoid: Direct contract-published import
import type { User } from '@project/contract-published/core/schemas';
```

`deps/<target>.ts` re-exports named types only: those the declared operations
reach, plus their generated input types. Types the target publishes but no
declared operation reaches are not exposed. Each declared operation must exist
in the target module and be `x-micro-contracts-published: true` — otherwise
generation fails, since `contract-published` would not carry it.

---

## Configuration

Create `micro-contracts.config.yaml`. All paths support `{module}` placeholder.

### defaults

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `contract.output` | string | yes | Output directory for contract packages |
| `contract.serviceTemplate` | string | no | Custom Handlebars template for service interface generation |
| `contractPublic.output` | string | yes | Output directory for public contract packages |
| `outputs.<id>.output` | string | yes | Output file path |
| `outputs.<id>.template` | string | yes | Handlebars template file path, used as written (resolved from the working directory) |
| `outputs.<id>.overwrite` | boolean | no | Overwrite existing files (default: `true`) |
| `outputs.<id>.condition` | string | no | `hasPublicEndpoints` \| `hasOverlays` \| `always` (default: `always`) |
| `outputs.<id>.enabled` | boolean | no | Enable/disable this output (default: `true`) |
| `outputs.<id>.config` | object | no | Template-specific configuration passed to context |

| `overlays.shared` | string[] | no | Overlay files applied to all modules |
| `overlays.collision` | string | no | `error` \| `warn` \| `last-wins` (default: `error`) |
| `server.output` | string | no | Output **file** path for generated routes (default: `server/src/{module}/routes.generated.ts`) |
| `server.template` | string | yes if `server` is declared | Handlebars template for the routes file |
| `server.servicesPath` | string | no | Path to the services object in Fastify (default: `fastify.services.{module}`) |
| `frontend.output` | string | no | Output **directory** for the client files (default: `frontend/src/{module}`) |
| `frontend.template` | string | yes if `frontend` is declared | Handlebars template for the client file |
| `frontend.client` | string | no | Client file name (default: `api.generated.ts`) |
| `frontend.service` | string | no | Service re-exports file name (default: `service.generated.ts`) |

`server` and `frontend` are the built-in equivalents of an `outputs` entry, kept for
existing configs. They generate only when declared, and only when no `outputs` entry
is configured — `outputs` supersedes them for a module. Prefer `outputs`.

An `outputs` entry is a template rendered to a path — nothing about it is
server-specific or frontend-specific — so `--server-only` / `--frontend-only`
apply to the built-in sections only. Select outputs with `--output`.

### modules.\<name\>

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `openapi` | string | yes | Path to OpenAPI spec file |
| `screen` | boolean | no | Enable screen spec mode (`x-screen-*` extensions, `TemplateContext.screens`) |
| `contract.output` | string | no | Override contract output directory |
| `contract.serviceTemplate` | string | no | Override custom service interface template |
| `contractPublic.output` | string | no | Override public contract output directory |
| `outputs.<id>.enabled` | boolean | no | Enable/disable specific output for this module |
| `outputs.<id>.*` | — | no | Override any output config field |
| `overlays` | string[] | no | Module-specific overlay files |
| `dependsOn` | string[] | no | Dependencies (`{module}.{service}.{method}`) |
| `server.*` | — | no | Override any `defaults.server` field |
| `server.enabled` | boolean | no | Disable built-in server generation for this module |
| `frontend.*` | — | no | Override any `defaults.frontend` field |
| `frontend.enabled` | boolean | no | Disable built-in frontend generation for this module |

Unknown keys are rejected: a mistyped key fails the run instead of being ignored.

### Example

```yaml
defaults:
  contract:
    output: packages/contract/{module}
  contractPublic:
    output: packages/contract-published/{module}
  outputs:
    server-routes:
      output: server/src/{module}/routes.generated.ts
      template: spec/default/templates/fastify-routes.hbs
    frontend-api:
      output: frontend/src/{module}/api.generated.ts
      template: spec/default/templates/fetch-client.hbs
  overlays:
    shared:
      - spec/_shared/overlays/middleware.overlay.yaml

modules:
  core:
    openapi: openapi/core.yaml
  billing:
    openapi: openapi/billing.yaml
    dependsOn:
      - core.User.getUsers
    outputs:
      frontend-api:
        enabled: false
```

---

## CLI Reference

> **Machine-readable contract**: The full CLI specification is available as [`cli-contract.yaml`](cli-contract.yaml) ([CLI Contracts](https://www.npmjs.com/package/cli-contracts) format). For the detailed reference with exit codes, output contracts, and AI agent policies, see **[CLI Reference (full)](docs/cli-reference.md)**.

### generate

Generate code from OpenAPI specifications.

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to config file |
| `-m, --module <names>` | Module names, comma-separated (default: all) |
| `--contracts-only` | Generate contract packages only |
| `--output <ids>` | Output ids to generate, comma-separated; glob patterns allowed (e.g. `'*routes*'`). Fails when a pattern matches no output |
| `--server-only` | Generate the built-in `server` section only (not valid with an `outputs` configuration) |
| `--frontend-only` | Generate the built-in `frontend` section only (not valid with an `outputs` configuration) |
| `--skip-lint` | Skip linting before generation |
| `--no-manifest` | Skip manifest generation |
| `--manifest-dir <path>` | Directory for manifest (default: the deepest directory holding every configured output) |
| `--force` | Bypass input hash cache and always regenerate |
| `--no-cache` | Run without reading or writing input hash cache |

A run that generates a subset (`--output`, `--module`, or any `--*-only`) does not
record the input hash, so the next full run regenerates rather than reporting no
changes.

The manifest (`.generated-manifest.json`) lives in the deepest directory holding every
location the config generates to — the project root when outputs sit both in
`packages/` and next to the server code — and records the files there that the
`generated:` patterns of `micro-contracts.guardrails.yaml` match. A full run records the input hash
only when the manifest records every file of every configured output, so an output
outside that directory or outside the `generated:` patterns leaves the hash out and
generate names the file that did. The cache skips a run only when the manifest
carries the input hash and finds each recorded file intact; without the hash, every
run regenerates.

### init \<module\>

Initialize a new module structure with starter templates.

| Option | Description |
|--------|-------------|
| `-d, --dir <path>` | Base directory (default: `src`) |
| `-i, --openapi <path>` | OpenAPI spec to process (auto-adds extensions) |
| `-o, --output <path>` | Output path for processed OpenAPI |
| `--skip-templates` | Skip creating starter templates |
| `--screens` | Initialize as screen spec module (generates screen templates and starter spec) |

### lint \<input\>

Lint OpenAPI specification.

| Option | Description |
|--------|-------------|
| `--strict` | Treat warnings as errors |

Every operation requires `x-micro-contracts-service` and `x-micro-contracts-method`,
and both must be valid TypeScript identifiers: they key route collection and service
grouping, and are emitted verbatim into generated type names. Operations missing them
would be dropped from every artifact, so they are errors (`MISSING_X_SERVICE`,
`MISSING_X_METHOD`, `INVALID_X_SERVICE`, `INVALID_X_METHOD`). In screen spec mode
(`screen: true`) operations are consumed via `TemplateContext.screens` and these rules
do not apply.

An operation's success response is its lowest 2xx status code, else its `2XX` range, else
`default`: the service returns that response's body and the generated route answers with
that status (200 for `2XX` and `default`). An operation that declares none of them is an
error: declare the response a successful call returns. Its request body and success response
must be in a media type generated code carries — `application/json` — since a body in any
other media type would be dropped from every generated artifact; one declared otherwise is an
error: remove that media type, and declare the body as `application/json`. A response of any
other status, which documents an error, may use any media type; generated code has a schema
only for an `application/json` one.

`<input>` is linted under the rules of the module in `micro-contracts.config.yaml` whose
`openapi` it is — the rules `generate` applies to it — and as a service API spec when no
module declares it.

### check

Run guardrail checks.

| Option | Description |
|--------|-------------|
| `--only <checks>` | Run only specific checks (comma-separated) |
| `--skip <checks>` | Skip specific checks (comma-separated) |
| `--gate <gates>` | Run checks for specific gates only (1-5) |
| `-v, --verbose` | Enable verbose output |
| `--fix` | Auto-fix issues where possible |
| `-g, --guardrails <path>` | Path to `micro-contracts.guardrails.yaml` |
| `-d, --generated-dir <path>` | Directory holding the manifest (default: the one `generate` writes it to) |
| `--changed-files <path>` | Path to file containing changed files (for CI) |
| `--list` | List available checks |
| `--list-gates` | List available gates |

### pipeline

Run full guardrails pipeline: **Gate 1,2 → Generate → Gate 3,4,5**.

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to config file |
| `-v, --verbose` | Enable verbose output |
| `--skip <checks>` | Skip specific checks (comma-separated) |
| `--continue-on-error` | Continue running even if a step fails |
| `-g, --guardrails <path>` | Path to `micro-contracts.guardrails.yaml` |
| `-d, --generated-dir <path>` | Directory holding the manifest (default: the one `generate` writes it to) |
| `--no-manifest` | Skip manifest generation |
| `--skip-lint` | Skip linting before generation |
| `--contracts-only` | Generate contract packages only |
| `--output <ids>` | Output ids to generate, comma-separated; glob patterns allowed (e.g. `'*routes*'`). Fails when a pattern matches no output |
| `--server-only` | Generate the built-in `server` section only (not valid with an `outputs` configuration) |
| `--frontend-only` | Generate the built-in `frontend` section only (not valid with an `outputs` configuration) |
| `--force` | Bypass input hash cache and always regenerate |
| `--no-cache` | Run without reading or writing input hash cache |

A run that generates a subset (`--output`, `--module`, or any `--*-only`) does not
record the input hash, so the next full run regenerates rather than reporting no
changes.

The cache reads the same manifest as `generate`, under the same conditions.

> See **[Enforceable Guardrails](docs/development-guardrails.md)** for gate details and CI configuration.

### deps

Analyze module dependencies.

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to config file |
| `-m, --module <name>` | Module to analyze |
| `--graph` | Output dependency graph (Mermaid) |
| `--impact <ref>` | Analyze impact of changing a specific API |
| `--who-depends-on <ref>` | Find modules that depend on a specific API |
| `--validate` | Validate dependencies against OpenAPI declarations |

### guardrails-init

Create a `micro-contracts.guardrails.yaml` configuration file.

| Option | Description |
|--------|-------------|
| `-o, --output <path>` | Output path (default: `micro-contracts.guardrails.yaml`) |

### manifest

Generate or verify manifest for generated artifacts.

| Option | Description |
|--------|-------------|
| `-d, --dir <path>` | Directory to scan (default: the one `generate` writes the manifest to) |
| `--verify` | Verify existing manifest |
| `-o, --output <path>` | Output manifest path |

### audit-openapi

Run LLM-based OpenAPI design quality audit. Evaluates path design, module boundary alignment, schema bloat, and cross-cutting concern coverage. Requires `agent-contracts-runtime`.

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to config file |
| `-m, --module <name>` | Module name to audit (default: all) |
| `-a, --adapter <name>` | SDK adapter (`claude`, `openai`, `gemini`, `mock`) |
| `--model <name>` | LLM model override |
| `--show-prompt` | Output the constructed prompt without calling LLM |
| `--fail-on <level>` | Minimum severity for non-zero exit (`warning`, `error`, `critical`) |
| `-o, --output <file>` | Write result to a file |
| `--report-format <fmt>` | Output format (`json`, `text`, `yaml`; default: `text`) |

### review-published

Review published API surface for internal type leakage and backward compatibility risks.

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to config file |
| `-m, --module <name>` | Module name to review (default: all) |
| `-a, --adapter <name>` | SDK adapter (`claude`, `openai`, `gemini`, `mock`) |
| `--model <name>` | LLM model override |
| `--show-prompt` | Output the constructed prompt without calling LLM |
| `--fail-on <level>` | Minimum severity for non-zero exit |
| `-o, --output <file>` | Write result to a file |
| `--report-format <fmt>` | Output format (default: `text`) |

### propose-overlays

Propose cross-cutting overlay candidates for authentication, tenancy, rate limiting, and audit logging.

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to config file |
| `-m, --module <name>` | Module name to analyze (default: all) |
| `-a, --adapter <name>` | SDK adapter (`claude`, `openai`, `gemini`, `mock`) |
| `--model <name>` | LLM model override |
| `--show-prompt` | Output the constructed prompt without calling LLM |
| `--fail-on <level>` | Minimum severity for non-zero exit |
| `-o, --output <file>` | Write result to a file |
| `--report-format <fmt>` | Output format (default: `json`) |

### audit-guardrails

Audit guardrails configuration for drift detection and lint rule coverage. File permission and editing checks have been moved to `artifact-contracts`.

| Option | Description |
|--------|-------------|
| `-c, --config <path>` | Path to config file |
| `-g, --guardrails <path>` | Path to micro-contracts.guardrails.yaml |
| `-a, --adapter <name>` | SDK adapter (`claude`, `openai`, `gemini`, `mock`) |
| `--model <name>` | LLM model override |
| `--show-prompt` | Output the constructed prompt without calling LLM |
| `--fail-on <level>` | Minimum severity for non-zero exit |
| `-o, --output <file>` | Write result to a file |
| `--report-format <fmt>` | Output format (default: `text`) |

> LLM commands require [`agent-contracts-runtime`](https://www.npmjs.com/package/agent-contracts-runtime) as a peer dependency. Install it to use these commands, or use `--show-prompt` to inspect the prompt without calling the LLM.

---

## Generated Code

### Service Interface

```typescript
// packages/contract/core/services/UserServiceApi.ts
export interface UserServiceApi {
  getUsers(input: UserService_getUsersInput): Promise<UserListResponse>;
  getUserById(input: UserService_getUserByIdInput): Promise<User>;
}
```

### Service Implementation

```typescript
// server/src/core/services/UserService.ts
import type { UserServiceApi } from '@project/contract/core/services/UserServiceApi.js';

export class UserService implements UserServiceApi {
  async getUsers(input) {
    // Input is HTTP-agnostic: { limit?: number, offset?: number }
    return { users: [...], total: 100 };
  }
}
```

### Validators

`schemas/validators.ts` holds every schema as the JSON Schema Fastify validates requests and
serializes responses with, plus the path, query, header and cookie parameter schemas of each
operation (`<Service>_<method>PathParams`, `…QueryParams`, `…HeaderParams`, `…CookieParams`)
and its inline request body and response schemas (`…Body`; `…Response` for the success
response, and `…404Response`, `…4XXResponse` or `…DefaultResponse` for another).
`schemas/types.ts` names the inline body types the same way. A header parameter schema names headers in lower case, as a
request delivers them, and is not in `allSchemas`: the starter routes give it to Fastify
inline (`schema.headers`), since Fastify matches header names case-insensitively only in an
inline schema. Fastify does not parse cookies, so a starter route reads the cookie parameters
from the Cookie header and validates them against `…CookieParams` with the validator Fastify
validates the rest with (`request.compileValidationSchema`). A request missing a required
header or cookie, or carrying one that does not match its schema, is answered with 400 before
the service runs. The service's input holds the path, query and cookie parameters; headers
are validated only.

Every validation keyword of the contract is kept. Only what JSON Schema spells differently is
translated (`$ref`, `nullable`, OpenAPI 3.0's boolean `exclusiveMinimum` /
`exclusiveMaximum`), and what never validates is left out: `x-*` extensions, the annotations
`example`, `examples`, `xml`, `externalDocs` and `discriminator`, and `$id` / `$schema` (each
schema is named by its component name). A `oneOf` selects its member by validating each one,
so a member is chosen by its `discriminator` tag when each member fixes the tag with `enum` or
`const`.

The starter routes (`fastify-routes.hbs`) register, for each operation, the schema of every
declared response whose body is `application/json`: the success response's under the status
the route answers with, any other under its status code — a range as Fastify reads it (`4XX`
as `4xx`), and `default`. Fastify serializes every response with the schema of its status, an
error included, so a property the contract does not declare for that status is not sent. The
server's error handler must therefore send the shape the contract declares for the error's
status — as the example's ProblemDetails handler (`examples/server/src/server.ts`) does: a body
missing a required property fails serialization and is answered with 500, which is what
Fastify's default error handler does for a `ProblemDetails` response.

Validate with Fastify's default validator options except `removeAdditional`, set to `false`.
Ajv validates each member of a `oneOf` or `anyOf` against the value itself, and with
`removeAdditional: true` — Fastify's default — validating a member removes every property that
member's `additionalProperties: false` does not allow, whether or not the member matches: a
valid value is rejected, or reaches the service with properties missing. With `false`, a
property a schema does not allow is rejected rather than removed — and a property a schema
without `additionalProperties: false` does not declare reaches the service, so a service reads
the fields its input declares rather than storing the value it receives as a whole.

```typescript
const fastify = Fastify({ ajv: { customOptions: { removeAdditional: false } } });
```

Fastify validates with Ajv on JSON Schema draft-07. A contract using the keywords JSON Schema
2019-09 / 2020-12 added — `prefixItems`, `dependentRequired`, `dependentSchemas`,
`minContains` / `maxContains`, `unevaluatedProperties` / `unevaluatedItems` — stops Fastify
from starting (`strict mode: unknown keyword`). To use them, validate with Ajv on the 2020-12
dialect, with the options above (add `ajv` and `ajv-formats` to your dependencies). A validator set this way does not read `fastify.addSchema`, so it is given
the generated schemas itself; the generated routes still register them with Fastify, which
serializes responses with them.

```typescript
import Fastify from 'fastify';
import { Ajv2020 } from 'ajv/dist/2020.js';
import ajvFormats from 'ajv-formats';
import { allSchemas } from '@project/contract/core/schemas/index.js';

// Fastify's default validator options with removeAdditional: false, on the 2020-12 dialect.
const ajv = new Ajv2020({ coerceTypes: 'array', useDefaults: true, removeAdditional: false, allErrors: false });
ajvFormats.default(ajv);
// A custom validator does not read fastify.addSchema: give it every module's schemas, once each.
for (const schema of allSchemas) {
  if (!ajv.getSchema(schema.$id)) ajv.addSchema(schema);
}

const fastify = Fastify();
fastify.setValidatorCompiler(({ schema }) => ajv.compile(schema));
```

---

## Related Documentation

| Document | Description |
|----------|-------------|
| **[Examples](./examples/)** | Complete working project with multiple modules, overlays, and cross-module dependencies |
| **[CLI Reference](docs/cli-reference.md)** | Full CLI reference with exit codes, output contracts, and AI agent policies |
| **[CLI Contract](cli-contract.yaml)** | Machine-readable CLI specification ([CLI Contracts](https://www.npmjs.com/package/cli-contracts) format) |
| **[Screen Spec](docs/screen-spec.md)** | Frontend screen contracts — ViewModel, navigation, analytics events in OpenAPI |
| **[OpenAPI Overlays (Deep Dive)](docs/overlays-deep-dive.md)** | Complete overlay examples, JSONPath patterns, template context |
| **[Enforceable Guardrails (AI-ready)](docs/development-guardrails.md)** | CI integration, security checks, allowlist configuration |

---

## Comparison with Similar Tools

| Aspect | micro-contracts | OpenAPI Generator | ts-rest |
|--------|-----------------|-------------------|---------|
| **Primary focus** | Contract governance (server + frontend + CI) | Multi-language SDK generation | TypeScript-first contract |
| **SSoT** | OpenAPI | OpenAPI | TypeScript |
| **Multi-artifact generation** | ✅ contract + routes + clients | △ SDK-focused (different goal) | ✅ Strong client/server alignment |
| **Enforceable guardrails** | ✅ Built-in (drift, no direct edit, CI gates) | ❌ Requires separate design | ❌ Requires separate design |
| **Public API governance** | ✅ `contract-published` + fail-fast | ❌ Manual | ❌ N/A |
| **Module dependencies** | ✅ `x-micro-contracts-depend-on` + `deps/` | ❌ Manual | ❌ Manual |
| **Cross-cutting concerns** | ✅ OpenAPI Overlays | ❌ Manual | △ Code-level implementation |


---

## License

MIT
