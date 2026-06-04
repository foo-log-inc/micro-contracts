# micro-contracts CLI

Contract-first OpenAPI toolchain for TypeScript Web/API systems. Generates contract packages, server routes, and frontend clients from OpenAPI specifications with enforceable guardrails.

**Version:** 0.15.0

## Table of Contents

- [micro-contracts](#micro-contracts)
  - [generate](#micro-contracts-generate)
  - [lint](#micro-contracts-lint)
  - [init](#micro-contracts-init)
  - [check](#micro-contracts-check)
  - [pipeline](#micro-contracts-pipeline)
  - [deps](#micro-contracts-deps)
  - [insights](#micro-contracts-insights)
  - [guardrails-init](#micro-contracts-guardrails-init)
  - [manifest](#micro-contracts-manifest)
  - [audit-openapi](#micro-contracts-audit-openapi)
  - [review-published](#micro-contracts-review-published)
  - [propose-overlays](#micro-contracts-propose-overlays)
  - [audit-guardrails](#micro-contracts-audit-guardrails)

---

## micro-contracts

Contract-first OpenAPI toolchain for TypeScript.

### Global Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--version` | -V | No |  | Print version and exit. |
| `--help` | -h | No |  | Show help and exit. |

### generate

Generate code from OpenAPI specifications.

Loads the multi-module config, applies overlays, runs Spectral linting (unless skipped), and generates contract packages, server routes, frontend clients, and documentation from OpenAPI specs. Supports input-hash caching to skip unnecessary regeneration.

**Usage:**

```
micro-contracts generate
```
```
micro-contracts generate -c my-config.yaml
```
```
micro-contracts generate -m core,billing
```
```
micro-contracts generate --contracts-only
```
```
micro-contracts generate --force
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--config` | -c | No |  | Path to config file (micro-contracts.config.yaml). |
| `--module` | -m | No |  | Module names, comma-separated. Generates all modules if omitted. |
| `--contracts-only` |  | No | `false` | Generate contract packages only. |
| `--server-only` |  | No | `false` | Generate server routes only. |
| `--frontend-only` |  | No | `false` | Generate frontend clients only. |
| `--docs-only` |  | No | `false` | Generate documentation only. |
| `--skip-lint` |  | No | `false` | Skip Spectral linting before generation. |
| `--manifest` |  | No | `true` | Generate manifest after generation. Enabled by default when guardrails.yaml has a generated section. Use --no-manifest to disable. |
| `--manifest-dir` |  | No | `"packages/"` | Directory for manifest output. |
| `--force` |  | No | `false` | Bypass input hash cache and always regenerate. |
| `--cache` |  | No | `true` | Enable input hash caching. Enabled by default. Use --no-cache to disable both reading and writing cache. |

#### Exit Codes

**Exit 0:** Generation succeeded.

- **stdout:** format=`text`

- **Generated files:**
  - `packages/contract/{module}/**/*.ts` (text/x-typescript)
  - `packages/contract-published/{module}/**/*.ts` (text/x-typescript) *(optional)*

**Exit 1:** Generation failed (config not found, spec invalid, or generation error).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  risk_level: medium
  requires_confirmation: false
  idempotent: true
  side_effects: 
    - file_write
  recommended_before_use: 
    - Ensure micro-contracts.config.yaml exists.
    - Verify OpenAPI specs are valid.
```

---

### lint

Lint OpenAPI specification.

Validates an OpenAPI specification for x-micro-contracts extension violations and structural issues using Spectral rules.

**Usage:**

```
micro-contracts lint spec/core/openapi/core.yaml
```
```
micro-contracts lint spec/core/openapi/core.yaml --strict
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `input` | Yes | Path to OpenAPI spec file. |

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--strict` |  | No | `false` | Treat warnings as errors. |

#### Exit Codes

**Exit 0:** Spec is valid. No lint errors found.

- **stdout:** format=`text`

**Exit 1:** Lint failed. Errors or warnings (in strict mode) found.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  risk_level: low
  requires_confirmation: false
  idempotent: true
  side_effects: 

```

---

### init

Initialize a new module structure with starter templates.

Creates the directory structure, starter Handlebars templates, shared schemas, Spectral rules, and optional config file for a new module. Can also process an existing OpenAPI spec to auto-add x-micro-contracts extensions.

**Usage:**

```
micro-contracts init core
```
```
micro-contracts init core --openapi path/to/spec.yaml
```
```
micro-contracts init myScreens --screens
```
```
micro-contracts init users --skip-templates
```

#### Arguments

| Name | Required | Description |
|---|---|---|
| `name` | Yes | Module name (e.g., core, users, billing). |

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--dir` | -d | No | `"src"` | Base directory for server/frontend files. |
| `--openapi` | -i | No |  | OpenAPI spec to process (auto-adds x-micro-contracts-service/method extensions). |
| `--output` | -o | No |  | Output path for processed OpenAPI. Defaults to spec/{name}/openapi/{name}.yaml. |
| `--skip-templates` |  | No | `false` | Skip creating starter Handlebars templates. |
| `--screens` |  | No | `false` | Initialize as screen spec module (generates screen templates and starter spec). |

#### Exit Codes

**Exit 0:** Module initialized successfully.

- **stdout:** format=`text`

- **Generated files:**
  - `spec/{name}/openapi/{name}.yaml` (application/yaml) *(optional)*
  - `spec/default/templates/*.hbs` (text/x-handlebars-template) *(optional)*
  - `micro-contracts.config.yaml` (application/yaml) *(optional)*

**Exit 1:** Initialization failed (OpenAPI file not found or write error).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  risk_level: medium
  requires_confirmation: false
  idempotent: true
  side_effects: 
    - file_write
    - directory_create
```

---

### check

Run guardrail checks.

Runs AI guardrail checks against generated code and config. Supports gating (1-5), selective check execution, auto-fix, and CI integration via changed-files input.

**Usage:**

```
micro-contracts check
```
```
micro-contracts check --gate 1,2
```
```
micro-contracts check --only drift,manifest
```
```
micro-contracts check --fix
```
```
micro-contracts check --list
```
```
micro-contracts check --list-gates
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--only` |  | No |  | Run only specific checks (comma-separated check names). |
| `--skip` |  | No |  | Skip specific checks (comma-separated check names). |
| `--gate` |  | No |  | Run checks for specific gates only (comma-separated, 1-5). |
| `--verbose` | -v | No | `false` | Enable verbose output. |
| `--fix` |  | No | `false` | Auto-fix issues where possible. |
| `--guardrails` | -g | No |  | Path to guardrails.yaml. |
| `--generated-dir` | -d | No | `"packages/"` | Path to generated files directory. |
| `--changed-files` |  | No |  | Path to file containing list of changed files (for CI). |
| `--list` |  | No | `false` | List available checks and exit. |
| `--list-gates` |  | No | `false` | List available gates and exit. |

#### Exit Codes

**Exit 0:** All checks passed (or --list/--list-gates output).

- **stdout:** format=`text`

**Exit 1:** One or more checks failed.

- **stdout:** format=`text`

- **stderr:** format=`text` *(optional)*

#### Extensions

```yaml
x-agent: 
  risk_level: low
  requires_confirmation: false
  idempotent: true
  side_effects: 

  recommended_before_use: 
    - Run generate first so generated files exist.
```

---

### pipeline

Run full guardrails pipeline.

Executes the complete contract-first pipeline in order: Gate 1,2 (pre-generation checks) → Generate → Gate 3,4,5 (post-generation checks). Supports --continue-on-error to run all steps regardless of failures.

**Usage:**

```
micro-contracts pipeline
```
```
micro-contracts pipeline --verbose
```
```
micro-contracts pipeline --continue-on-error
```
```
micro-contracts pipeline --contracts-only --skip-lint
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--config` | -c | No |  | Path to config file (micro-contracts.config.yaml). |
| `--verbose` | -v | No | `false` | Enable verbose output (show detailed logs). |
| `--skip` |  | No |  | Skip specific checks (comma-separated). |
| `--continue-on-error` |  | No | `false` | Continue running even if a step fails. |
| `--guardrails` | -g | No |  | Path to guardrails.yaml. |
| `--generated-dir` | -d | No | `"packages/"` | Path to generated files directory. |
| `--manifest` |  | No | `true` | Generate manifest after generation. Enabled by default. Use --no-manifest to disable. |
| `--skip-lint` |  | No | `false` | Skip Spectral linting before generation. |
| `--contracts-only` |  | No | `false` | Generate contract packages only. |
| `--server-only` |  | No | `false` | Generate server routes only. |
| `--frontend-only` |  | No | `false` | Generate frontend clients only. |
| `--docs-only` |  | No | `false` | Generate documentation only. |
| `--force` |  | No | `false` | Bypass input hash cache and always regenerate. |
| `--cache` |  | No | `true` | Enable input hash caching. Enabled by default. Use --no-cache to disable both reading and writing cache. |

#### Exit Codes

**Exit 0:** Pipeline completed successfully. All gates passed and generation succeeded.

- **stdout:** format=`text`

**Exit 1:** Pipeline failed. One or more steps had errors.

- **stdout:** format=`text`

- **stderr:** format=`text` *(optional)*

#### Extensions

```yaml
x-agent: 
  risk_level: medium
  requires_confirmation: false
  idempotent: true
  side_effects: 
    - file_write
  recommended_before_use: 
    - Ensure micro-contracts.config.yaml and guardrails.yaml exist.
    - Verify OpenAPI specs are valid.
```

---

### deps

Analyze module dependencies.

Reads x-micro-contracts-depend-on declarations from OpenAPI specs and config dependsOn fields. Can output dependency graphs (Mermaid), impact analysis, reverse lookups, and validation results.

**Usage:**

```
micro-contracts deps
```
```
micro-contracts deps --graph
```
```
micro-contracts deps --module billing
```
```
micro-contracts deps --impact core.User.getUsers
```
```
micro-contracts deps --who-depends-on core
```
```
micro-contracts deps --validate
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--config` | -c | No |  | Path to config file. |
| `--module` | -m | No |  | Module to analyze. |
| `--graph` |  | No | `false` | Output dependency graph in Mermaid format. |
| `--impact` |  | No |  | Analyze impact of changing a specific API (e.g., core.User.getUsers). |
| `--who-depends-on` |  | No |  | Find modules that depend on a specific API. |
| `--validate` |  | No | `false` | Validate dependencies against OpenAPI declarations. |

#### Exit Codes

**Exit 0:** Dependency analysis completed successfully.

- **stdout:** format=`text`

**Exit 1:** Analysis failed or validation errors found.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  risk_level: low
  requires_confirmation: false
  idempotent: true
  side_effects: 

```

---

### insights

Emit ExternalInsight JSON for agent-contracts-analyzer.

Reads x-micro-contracts-depend-on from OpenAPI specs and outputs structured dependency edges and anchor mappings as JSON on stdout. Used by agent-contracts-analyzer CommandProvider integration.

**Usage:**

```
micro-contracts insights --format json
```
```
micro-contracts insights --format json --project-root .
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--format` |  | No | `"json"` | Output format (json only). |
| `--project-root` |  | No | `"."` | Project root directory containing micro-contracts.config.yaml. |
| `--config` | -c | No |  | Path to config file (micro-contracts.config.yaml). |

#### Exit Codes

**Exit 0:** ExternalInsight JSON written to stdout.

- **stdout:** format=`json`

**Exit 1:** Insights generation failed.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  risk_level: low
  requires_confirmation: false
  idempotent: true
  side_effects: 

```

---

### guardrails-init

Create a guardrails.yaml configuration file.

Generates a starter guardrails.yaml with default check configuration. Fails if the target file already exists.

**Usage:**

```
micro-contracts guardrails-init
```
```
micro-contracts guardrails-init -o custom-guardrails.yaml
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--output` | -o | No | `"guardrails.yaml"` | Output path for guardrails.yaml. |

#### Exit Codes

**Exit 0:** guardrails.yaml created successfully.

- **stdout:** format=`text`

- **Generated files:**
  - `{options.output}` (application/yaml)

**Exit 1:** Failed to create (file already exists or write error).

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  risk_level: low
  requires_confirmation: false
  idempotent: false
  side_effects: 
    - file_write
```

---

### manifest

Generate or verify manifest for generated artifacts.

Scans a directory of generated files and produces a .generated-manifest.json containing file hashes. In verify mode, checks that existing files match the manifest.

**Usage:**

```
micro-contracts manifest
```
```
micro-contracts manifest -d packages/
```
```
micro-contracts manifest --verify
```
```
micro-contracts manifest -o custom-manifest.json
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--dir` | -d | No | `"packages/"` | Directory to scan. |
| `--verify` |  | No | `false` | Verify existing manifest instead of generating. |
| `--output` | -o | No |  | Output manifest path. Defaults to {dir}/.generated-manifest.json. |

#### Exit Codes

**Exit 0:** Manifest generated or verification passed.

- **stdout:** format=`text`

- **Generated files:**
  - `{options.dir}/.generated-manifest.json` (application/json) *(optional)*

**Exit 1:** Directory not found, manifest generation failed, or verification failed.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  risk_level: low
  requires_confirmation: false
  idempotent: true
  side_effects: 
    - file_write
```

---

### audit-openapi

Run LLM-based OpenAPI design quality audit.

Performs a semantic review of OpenAPI specification design quality using an LLM agent. Evaluates path design, module boundary alignment, schema bloat, CRUD vs use-case orientation, and cross-cutting concern coverage. Requires agent-contracts-runtime.

**Usage:**

```
micro-contracts audit-openapi
```
```
micro-contracts audit-openapi -m core
```
```
micro-contracts audit-openapi --adapter cursor --report-format text
```
```
micro-contracts audit-openapi --show-prompt
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--config` | -c | No |  | Path to config file (micro-contracts.config.yaml). |
| `--module` | -m | No |  | Module name to audit (default is all modules). |
| `--adapter` | -a | No |  | SDK adapter to use for LLM execution. |
| `--model` |  | No |  | LLM model override. |
| `--fail-on` |  | No | `"error"` | Minimum severity that causes a non-zero exit. |
| `--output` | -o | No |  | Write result to a file instead of stdout. |
| `--report-format` |  | No | `"text"` | Output format for the audit report. |

#### Exit Codes

**Exit 0:** Audit completed, no blocking findings.

- **stdout:** format=`{options.report-format}`

**Exit 1:** Unexpected error.

- **stderr:** format=`text`

**Exit 3:** Input validation failed (config not found, spec invalid).

- **stderr:** format=`text`

**Exit 10:** Completed with blocking findings.

- **stdout:** format=`{options.report-format}`

**Exit 11:** Runtime dependency missing (agent-contracts-runtime).

- **stderr:** format=`text`

**Exit 12:** LLM provider or adapter error.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  expectedDurationMs: 120000
  retryableExitCodes: 
    - 12
```

---

### review-published

Review published API surface for internal leakage.

Analyzes the published (public-facing) API specification for internal type leakage, backward compatibility risks, and x-micro-contracts-non-exportable violations. Requires agent-contracts-runtime.

**Usage:**

```
micro-contracts review-published
```
```
micro-contracts review-published -m billing
```
```
micro-contracts review-published --adapter claude --report-format json
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--config` | -c | No |  | Path to config file (micro-contracts.config.yaml). |
| `--module` | -m | No |  | Module name to review (default is all modules). |
| `--adapter` | -a | No |  | SDK adapter to use for LLM execution. |
| `--model` |  | No |  | LLM model override. |
| `--fail-on` |  | No | `"error"` | Minimum severity that causes a non-zero exit. |
| `--output` | -o | No |  | Write result to a file instead of stdout. |
| `--report-format` |  | No | `"text"` | Output format for the review report. |

#### Exit Codes

**Exit 0:** Review completed, no blocking findings.

- **stdout:** format=`{options.report-format}`

**Exit 1:** Unexpected error.

- **stderr:** format=`text`

**Exit 3:** Input validation failed.

- **stderr:** format=`text`

**Exit 10:** Completed with blocking findings.

- **stdout:** format=`{options.report-format}`

**Exit 11:** Runtime dependency missing (agent-contracts-runtime).

- **stderr:** format=`text`

**Exit 12:** LLM provider or adapter error.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  expectedDurationMs: 120000
  retryableExitCodes: 
    - 12
```

---

### propose-overlays

Propose cross-cutting overlay candidates.

Analyzes the OpenAPI specification and proposes cross-cutting overlay candidates for authentication, tenancy, rate limiting, audit logging, and other patterns. Verifies proposals do not conflict with existing overlay definitions. Requires agent-contracts-runtime.

**Usage:**

```
micro-contracts propose-overlays
```
```
micro-contracts propose-overlays -m core
```
```
micro-contracts propose-overlays --adapter openai --report-format json
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--config` | -c | No |  | Path to config file (micro-contracts.config.yaml). |
| `--module` | -m | No |  | Module name to analyze (default is all modules). |
| `--adapter` | -a | No |  | SDK adapter to use for LLM execution. |
| `--model` |  | No |  | LLM model override. |
| `--fail-on` |  | No | `"error"` | Minimum severity that causes a non-zero exit. |
| `--output` | -o | No |  | Write result to a file instead of stdout. |
| `--report-format` |  | No | `"json"` | Output format for the proposal report. |

#### Exit Codes

**Exit 0:** Proposal generated successfully.

- **stdout:** format=`{options.report-format}`

**Exit 1:** Unexpected error.

- **stderr:** format=`text`

**Exit 3:** Input validation failed.

- **stderr:** format=`text`

**Exit 10:** Completed with blocking findings.

- **stdout:** format=`{options.report-format}`

**Exit 11:** Runtime dependency missing (agent-contracts-runtime).

- **stderr:** format=`text`

**Exit 12:** LLM provider or adapter error.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  expectedDurationMs: 120000
  retryableExitCodes: 
    - 12
```

---

### audit-guardrails

Audit guardrails configuration for drift and lint coverage.

Checks that guardrails.yaml configuration covers all generated output directories for drift detection and that OpenAPI lint rules are properly configured. Note: file permission and editing checks have been moved to artifact-contracts. Requires agent-contracts-runtime.

**Usage:**

```
micro-contracts audit-guardrails
```
```
micro-contracts audit-guardrails --adapter mock --report-format json
```

#### Options

| Option | Aliases | Required | Default | Description |
|---|---|---|---|---|
| `--config` | -c | No |  | Path to config file (micro-contracts.config.yaml). |
| `--guardrails` | -g | No |  | Path to guardrails.yaml. |
| `--adapter` | -a | No |  | SDK adapter to use for LLM execution. |
| `--model` |  | No |  | LLM model override. |
| `--fail-on` |  | No | `"error"` | Minimum severity that causes a non-zero exit. |
| `--output` | -o | No |  | Write result to a file instead of stdout. |
| `--report-format` |  | No | `"text"` | Output format for the audit report. |

#### Exit Codes

**Exit 0:** Audit completed, no blocking findings.

- **stdout:** format=`{options.report-format}`

**Exit 1:** Unexpected error.

- **stderr:** format=`text`

**Exit 3:** Input validation failed (guardrails.yaml not found).

- **stderr:** format=`text`

**Exit 10:** Completed with blocking findings.

- **stdout:** format=`{options.report-format}`

**Exit 11:** Runtime dependency missing (agent-contracts-runtime).

- **stderr:** format=`text`

**Exit 12:** LLM provider or adapter error.

- **stderr:** format=`text`

#### Extensions

```yaml
x-agent: 
  expectedDurationMs: 120000
  retryableExitCodes: 
    - 12
```

---
