# Screen Spec — Frontend Screen Contracts in OpenAPI

The Screen Spec feature repurposes standard OpenAPI constructs (`paths`, `schemas`, `links`, `security`) to declaratively define **frontend screen contracts** — bridging the API layer and UI components. A single YAML file drives frontend types, test scaffolding, and quality analysis.

```
Screen Spec (OpenAPI YAML)
  ├── micro-contracts generate ──┬── ViewModel Types (type-safe)
  │                              ├── Navigation Map (typed routing)
  │                              └── Event Hooks (typed analytics)
  ├── E2E scaffold ─── Playwright test stubs + coverage
  └── Data lineage ─── ViewModel → API → DB traceability
```

> **Important**: This is NOT "auto-generated UI from schema" but rather **screen-level contract definition**, which aligns with micro-contracts' "Contract-first vertical slices" philosophy.

---

## The HTTP-Screen Analogy

Standard OpenAPI semantics map directly to screen specification concepts:

| OpenAPI Construct      | API Usage              | Screen Spec Usage                                       |
| ---------------------- | ---------------------- | ------------------------------------------------------- |
| `paths: /home`         | Endpoint               | React/Vue route                                         |
| `GET /home`            | Fetch resource         | **Render screen** — what the user sees                  |
| `POST /home`           | Create/modify resource | **User action** — what the user can do                  |
| `parameters`           | Filter/identify        | **Screen init params** — route/query params             |
| `responses.200.schema` | Response shape         | **ViewModel** — typed interface for the screen          |
| `requestBody`          | Submitted data shape   | **Action payload** — typed user action interface        |
| `links`                | HATEOAS related resources | **Forward navigation** — statically known screen targets |
| `security`             | Auth requirement       | **Auth guard** — does the screen require login?         |

All standard OpenAPI tooling works out of the box: linters, documentation generators, and diff tools.

---

## Required Extensions (`x-*`)

Only concerns with **no OpenAPI-native representation** need extensions:

| Extension           | Required | Purpose                                   | Justification                                                   |
| ------------------- | -------- | ----------------------------------------- | --------------------------------------------------------------- |
| `x-screen-const`    | Yes*     | Stable constant name (e.g., `HOME`)       | No OpenAPI equivalent for generated symbol names                |
| `x-screen-id`       | Yes      | Traceability ID (e.g., `SCR-001`)         | Links to requirements and E2E annotations                       |
| `x-screen-name`     | Yes*     | Generated symbol name (e.g., `HomePage`)  | Drives `use{Name}Events()`, `wrap{Name}ViewModel()`            |
| `x-back-navigation` | No       | History-based back navigation support     | `links` only cover forward navigation with known targets        |
| `x-event`           | No       | Inline analytics event declaration        | Type auto-inferred from placement; supports string, object, `$ref` |
| `x-interactions`    | No       | In-page interaction bindings              | Declares non-navigation UI interactions (swipe, selection, etc.) |
| `x-view-model`      | No       | Explicit ViewModel schema name            | Alternative to auto-inference from `$ref`                       |
| `x-view-props`      | No       | ViewProps interface name                  | For framework-specific wrapper generation                       |

**Deprecated extensions:**

| Extension   | Status | Migration |
| ----------- | ------ | --------- |
| `x-events`  | Deprecated (v0.14) — removed in v0.15 | Replace with inline `x-event` on GET, links, actions, or interactions |

\* When `x-screen-id` is present, `x-screen-const` and `x-screen-name` are required (enforced by lint).

---

## Quick Start

### 1. Initialize a Screen Module

```bash
npx micro-contracts init myScreens --screens
```

This command generates:
- `spec/myScreens/openapi/myScreens.yaml` — Starter screen spec (2-screen scaffold)
- `spec/default/templates/screen-navigation.hbs` — Navigation map template
- `spec/default/templates/screen-events.hbs` — Event hooks template
- `micro-contracts.config.yaml` — Module config with `screen: true`

### 2. Edit the Screen Spec

Edit `spec/myScreens/openapi/myScreens.yaml` to add your screen definitions.

### 3. Generate Code

```bash
npx micro-contracts generate
```

Generated artifacts:
- `packages/contract/myScreens/schemas/types.ts` — ViewModel TypeScript types
- `frontend/src/screens/navigation.generated.ts` — Navigation map
- `frontend/src/screens/events.generated.ts` — Analytics event hooks

---

## Configuration

### `micro-contracts.config.yaml`

Screen modules are enabled with the `screen: true` flag:

```yaml
modules:
  myScreens:
    openapi: spec/myScreens/openapi/myScreens.yaml
    screen: true
    outputs:
      frontend-api:
        enabled: false      # Not needed for screen modules
      screen-navigation:
        output: frontend/src/screens/navigation.generated.ts
        template: screen-navigation.hbs
      screen-events:
        output: frontend/src/screens/events.generated.ts
        template: screen-events.hbs
```

Effects of `screen: true`:
- Suppresses `x-micro-contracts-service` / `x-micro-contracts-method` lint warnings
- Populates `TemplateContext.screens` with pre-parsed `ScreenContext[]`
- Enables screen-specific lint rules (`x-screen-id` requires `x-screen-const`/`x-screen-name`)

---

## Screen Spec YAML Structure

### Basic Example (inline `x-event`)

```yaml
openapi: '3.1.0'
info:
  title: App Screen Specification
  version: '1.0.0'
  description: Screen contracts — not a server API
servers:
  - url: /
    description: Screen routes (client-side)

paths:
  /home:
    get:
      operationId: renderHomePage
      security: [{session: []}]
      x-screen-const: HOME
      x-screen-id: SCR-001
      x-screen-name: HomePage
      x-back-navigation: false
      x-event: home_view                   # → type: "screen_view" (auto-inferred)
      x-interactions:
        - name: daySwipe
          description: Horizontal day-by-day swipe
          x-event:
            name: day_swipe
            params:
              direction: string
      summary: Render home page
      responses:
        '200':
          description: Home page ViewModel
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/HomePageViewModel'
          links:
            goToSettings:
              operationId: renderSettingsPage
            goToDetail:
              operationId: renderDetailPage
              x-event:                      # → type: "user_action" (auto-inferred)
                $ref: '#/components/x-event-defs/itemTap'
    post:
      operationId: actionHomePage
      x-event: mode_switch                  # → type: "user_action" (auto-inferred)
      responses:
        '200':
          description: OK

components:
  x-event-defs:
    itemTap:
      name: item_tap
      params:
        itemId: string
```

### `x-event` — Three Forms

```yaml
# 1. String form (most common)
x-event: home_view

# 2. Object form (type override / extra params)
x-event:
  name: oauth_callback_result
  type: system
  params:
    success: boolean

# 3. $ref form (reusable definitions)
x-event:
  $ref: '#/components/x-event-defs/itemTap'
```

`$ref` resolves to `#/components/x-event-defs/*` (local references only).

### `x-event` Placement and Type Inference

| Placement | Inferred `type` | Params auto-derivation |
|-----------|-----------------|------------------------|
| `get` operation | `screen_view` | From path parameters (e.g., `/calendar/{yearMonth}` → `{ yearMonth: string }`) |
| `responses.200.links.*` | `user_action` | From target route's path parameters |
| `post` / `put` / `patch` / `delete` | `user_action` | None — specify explicitly in `params` |
| `x-interactions.*` | `user_action` | None — specify explicitly in `params` |

`type` can be overridden explicitly in object form. Recognized values: `screen_view`, `user_action`, `system`.

### `x-interactions`

Declares in-page interaction bindings that don't map to HTTP operations or link navigations.

```yaml
x-interactions:
  - name: daySwipe
    description: Horizontal day-by-day swipe navigation
    x-event:
      name: day_swipe
      params:
        direction: string
  - name: itemSelect
    description: Select an item from choices
    x-event:
      name: item_select
      params:
        itemId: string
    module: '@ui/selector'    # project-specific field (passed through)
```

Required field: `name`. All other fields are optional. Project-specific fields (e.g., `module`, `factory`) are passed through to templates in `extras`.

### Reusable Event Definitions

```yaml
components:
  x-event-defs:
    itemTap:
      name: item_tap
      params:
        itemId: string
```

Referenced with `$ref: '#/components/x-event-defs/itemTap'` from any `x-event` placement.

### Field Reference

**`operationId`** — Unique identifier referenced by generated code. The naming convention `render` + screen name + `Page` is recommended.

**`security`** — Auth guard. `[{session: []}]` means authentication is required; `[]` means no authentication needed.

**`x-screen-const`** — SCREAMING_SNAKE_CASE name used for constant access like `SCREENS.HOME`.

**`x-screen-id`** — Unique ID for requirements and test traceability. The format `SCR-{domain}-{number}` is recommended.

**`x-screen-name`** — PascalCase name for generated symbols like `useHomePageEvents()`.

**`x-back-navigation`** — When `true`, declares that the screen supports browser back or UI back button navigation. Unlike forward navigation covered by `links`, the back destination is determined at runtime.

**`x-event`** — Inline analytics event. Type is auto-inferred from placement. Supports string, object (with `name`, `type?`, `params?`), and `$ref` forms. Params are auto-derived from path parameters for `get` and `links` placements; for actions and interactions, specify params explicitly.

**`x-interactions`** — Array of in-page interaction bindings. Each entry has `name` (required), `description` (recommended), optional `x-event`, and any project-specific fields.

**`responses.200.links`** — Forward navigation targets. References target screens by `operationId`. Each link may have an optional `x-event`.

**`POST` / `PUT` / `PATCH` / `DELETE` operations** — Mutation operations on the same path define user actions (form submissions, button taps, deletions, etc.). Each may have an optional `x-event`.

---

## TemplateContext.screens

When `screen: true` is enabled, `TemplateContext` includes a pre-parsed `screens: ScreenContext[]`. This eliminates the need to iterate over deeply nested `spec.paths` in templates.

```typescript
interface ScreenContext {
  route: string;                         // '/home'
  screenConst: string;                   // 'HOME'
  screenId: string;                      // 'SCR-001'
  screenName: string;                    // 'HomePage'
  operationId: string;                   // 'renderHomePage'
  supportsBack: boolean;                 // false
  viewModelSchema: string;               // 'HomePageViewModel'
  links: ScreenLink[];                   // forward navigation targets
  requiresAuth: boolean;                 // true
  pathParams: string[];                  // ['yearMonth'] for /calendar/{yearMonth}

  // Inline x-event (v0.14+)
  screenEvent?: InlineEventDefinition;   // GET x-event (screen_view)
  actions: ScreenAction[];               // post/put/patch/delete with events
  interactions: ScreenInteraction[];     // x-interactions with events

  /** @deprecated Use screenEvent / links[].event / actions[].event instead */
  events: ScreenEventDefinition[];       // legacy x-events (backward compat)
}

interface ScreenLink {
  name: string;                          // 'goToSettings'
  targetRoute: string;                   // '/settings'
  targetOperationId: string;             // 'renderSettingsPage'
  event?: InlineEventDefinition;         // link x-event (user_action)
}

interface ScreenAction {
  method: string;                        // 'post', 'put', 'patch', 'delete'
  operationId: string;                   // 'actionHomePage'
  summary: string;
  schemaRef: string;                     // request body $ref name
  event?: InlineEventDefinition;         // action x-event (user_action)
}

interface ScreenInteraction {
  name: string;                          // 'daySwipe'
  description: string;                   // 'Horizontal day-by-day swipe'
  event?: InlineEventDefinition;         // interaction x-event (user_action)
  extras: Record<string, unknown>;       // project-specific fields
}

interface InlineEventDefinition {
  name: string;                          // 'home_view'
  type: string;                          // 'screen_view' | 'user_action' | 'system'
  params?: Record<string, string>;       // auto-derived or explicit
}
```

### Template Usage Comparison

**Using `screens[]` (recommended):**

```handlebars
{{#each screens}}
  {{screenConst}}: { id: '{{screenId}}', route: '{{route}}' },
{{/each}}
```

**Iterating `spec.paths` directly (not recommended):**

```handlebars
{{#each spec.paths}}
{{#each this}}
{{#unless (eq @key "parameters")}}
{{#unless (eq @key "servers")}}
{{#unless (eq @key "summary")}}
{{#unless (eq @key "description")}}
{{#if this.x-screen-id}}
  {{this.x-screen-const}}: { id: '{{this.x-screen-id}}', route: '{{@../key}}' },
{{/if}}
{{/unless}}
{{/unless}}
{{/unless}}
{{/unless}}
{{/each}}
{{/each}}
```

---

## Default Templates

### screen-navigation.hbs

Generates a navigation map. Outputs a `SCREENS` constant and `*_PAGE_LINKS` for each screen.

Example output:

```typescript
const _OP_ROUTES = {
  renderHomePage: '/home',
  renderSettingsPage: '/settings',
  renderChatPage: '/chat',
} as const;

export const SCREENS = {
  HOME: { id: 'SCR-001' as const, route: _OP_ROUTES.renderHomePage, supportsBack: false } as const,
  SETTINGS: { id: 'SCR-002' as const, route: _OP_ROUTES.renderSettingsPage, supportsBack: true } as const,
} as const;

export const HOME_PAGE_LINKS = {
  goToSettings: _OP_ROUTES.renderSettingsPage,
  goToChat: _OP_ROUTES.renderChatPage,
} as const;
```

### screen-events.hbs (inline x-event)

Generates analytics event hooks using the new inline `x-event` structure. Templates can use `screenEvent`, `links[].event`, `actions[].event`, and `interactions[].event`.

Example template:

```handlebars
{{#each screens}}
{{#if screenEvent}}
export function use{{screenName}}ScreenView() {
  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    trackEvent('{{screenEvent.name}}', '{{screenEvent.type}}', {});
  }, []);
}
{{/if}}

{{#each links}}
{{#if this.event}}
export function navigateVia{{capitalize this.name}}(
  {{eventParamsSignature this.event.params}}
) {
  trackEvent('{{this.event.name}}', '{{this.event.type}}',
    { {{#each this.event.params}}{{@key}}{{#unless @last}}, {{/unless}}{{/each}} });
  return '{{this.targetRoute}}';
}
{{/if}}
{{/each}}

{{#each actions}}
{{#if this.event}}
export function track{{capitalize this.operationId}}Event(
  {{eventParamsSignature this.event.params}}
) {
  trackEvent('{{this.event.name}}', '{{this.event.type}}',
    { {{#each this.event.params}}{{@key}}{{#unless @last}}, {{/unless}}{{/each}} });
}
{{/if}}
{{/each}}
{{/each}}
```

### Handlebars Helpers

| Helper | Description | Example |
|--------|-------------|---------|
| `hasEvent` | Returns `true` if the screen has any events (screenEvent, link events, action events, or interaction events) | `{{#if (hasEvent this)}}...{{/if}}` |
| `eventParamsSignature` | Expands params map to TypeScript argument list | `{{eventParamsSignature screenEvent.params}}` → `yearMonth: string` |

### Legacy screen-events.hbs (deprecated x-events)

The legacy `x-events` array is still available in `events` for backward compatibility:

```typescript
export function useHomePageEvents() {
  return {
    trackView: () =>
      trackEvent('home_view', 'screen_view', {}),
    trackSignOut: () =>
      trackEvent('sign_out', 'user_action', {}),
  };
}
```

---

## Lint Rules

`micro-contracts lint` performs the following screen-specific checks:

| Code                             | Level   | Description                                                    |
| -------------------------------- | ------- | -------------------------------------------------------------- |
| `SCREEN_MISSING_CONST`           | Error   | `x-screen-id` present but `x-screen-const` missing            |
| `SCREEN_MISSING_NAME`            | Error   | `x-screen-id` present but `x-screen-name` missing             |
| `SCREEN_MISSING_OPERATION_ID`    | Error   | Screen operation missing `operationId`                         |
| `SCREEN_INVALID_X_EVENT`         | Error   | `x-event` is not a string, `{name}` object, or `{$ref}`       |
| `SCREEN_UNKNOWN_EVENT_REF`       | Error   | `x-event` `$ref` has no matching `components.x-event-defs` entry |
| `SCREEN_CONFLICTING_EVENT_DEFS`  | Error   | `x-events` and `x-event` coexist on the same operation        |
| `SCREEN_INVALID_INTERACTIONS`    | Error   | `x-interactions` is not an array                               |
| `SCREEN_INVALID_INTERACTION`     | Error   | `x-interactions` entry missing `name`                          |
| `SCREEN_DEPRECATED_X_EVENTS`     | Warning | `x-events` (flat list) is deprecated — use inline `x-event`   |
| `SCREEN_INVALID_EVENTS`          | Error   | `x-events` is not an array (legacy validation)                 |
| `SCREEN_INVALID_EVENT`           | Error   | `x-events` item missing `name` or `type` (legacy validation)  |

In `screen: true` modules, `MISSING_X_SERVICE` / `MISSING_X_METHOD` warnings are suppressed (screen specs do not need service/method declarations).

---

## Custom Templates

You can extend the default templates or create new ones for additional generated artifacts. All `ScreenContext` fields are available in templates.

### ViewProps Template Example

`spec/default/templates/screen-view-props.hbs`:

```handlebars
{{#each screens}}
export interface {{screenName}}ViewProps {
  // ViewModel: {{viewModelSchema}}
  // Screen ID: {{screenId}}
}
{{/each}}
```

Add to config:

```yaml
outputs:
  screen-view-props:
    output: frontend/src/screens/view-props.generated.ts
    template: screen-view-props.hbs
```

### Available Template Context

| Field             | Type      | Description                                        |
| ----------------- | --------- | -------------------------------------------------- |
| `screens`         | array     | `ScreenContext[]` — array of screen definitions    |
| `screens[].screenEvent` | object? | `InlineEventDefinition` — GET screen_view event |
| `screens[].actions` | array   | `ScreenAction[]` — mutation operations with events |
| `screens[].interactions` | array | `ScreenInteraction[]` — interaction bindings with events |
| `screens[].pathParams` | string[] | Path parameter names for this route              |
| `screens[].links[].event` | object? | `InlineEventDefinition` — link navigation event |
| `spec`            | object    | Raw OpenAPI spec (for direct access when needed)   |
| `title`           | string    | OpenAPI title                                      |
| `version`         | string    | OpenAPI version                                    |
| `moduleName`      | string    | Module name                                        |
| `contractPackage` | string    | Contract package import path                       |
| `schemaNames`     | string[]  | All schema names                                   |

---

## Tiered Integration

### Tier 1 — Core (built into micro-contracts)

- Type definitions: `x-screen-*`, `x-event`, `x-interactions` on `OperationObject`
- Screen context extraction: `TemplateContext.screens` (with `screenEvent`, `actions`, `interactions`, `pathParams`)
- `$ref` resolution: `components.x-event-defs` local references
- Params auto-derivation: path params for `get` and `links` placements
- Lint rules: Screen spec consistency, inline event validation, interaction validation
- `init --screens`: Starter file generation
- Default templates: `screen-navigation.hbs`, `screen-events.hbs`
- Handlebars helpers: `hasEvent`, `eventParamsSignature`

### Tier 2 — Optional Packages / Official Recipes (future)

| Package                        | Purpose                                                                  |
| ------------------------------ | ------------------------------------------------------------------------ |
| `@micro-contracts/e2e-scaffold`| Parse screen spec to generate Playwright test stubs with coverage         |
| ViewProp / data-testid pattern | Derive stable test IDs from ViewModel fields + `x-screen-const`         |

### Tier 3 — Documentation Only (future)

| Pattern                   | Description                                                          |
| ------------------------- | -------------------------------------------------------------------- |
| Design tool integration   | Link screen IDs to design tool frames via `x-pen-node` or similar   |
| Requirements traceability | Link screens to user stories via `x-satisfies`                      |
| Data lineage declarations | Declare upstream API/DB origins on ViewModel schemas via `x-lineage-source` |
