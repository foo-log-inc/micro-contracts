/**
 * micro-contracts library entry point.
 *
 * An explicit list, not `export *`: re-exporting whole modules made every
 * internal helper part of the public API, which meant an export nothing
 * referenced could not be told apart from one a consumer depends on — and
 * unreachable code accumulated behind that ambiguity.
 *
 * Adding a name here is a public commitment. Everything absent stays internal,
 * and `npm run lint:exports` reports internal exports nothing references.
 */

// ── Generation ────────────────────────────────────────────
export {
  generate,
  loadConfig,
  findConfigFile,
  loadOpenAPISpec,
  collectInputFiles,
  computeInputHash,
} from './generator/index.js';
export type { GenerateOptions } from './generator/index.js';

// ── Linting ───────────────────────────────────────────────
export { lintSpec, formatLintResults } from './generator/index.js';
export type { LintOptions, LintResult } from './generator/linter.js';

// ── Artifact generators, for consumers driving generation themselves ──
export {
  generateTypes,
  generateSchemas,
  generateServiceInterfaces,
  buildTemplateContext,
  renderTemplate,
} from './generator/index.js';
export type {
  TemplateContext,
  ScreenContext,
  ScreenLink,
  ScreenAction,
  ScreenInteraction,
} from './generator/index.js';

// ── Overlays ──────────────────────────────────────────────
export { processOverlays, generateExtensionInterfaces } from './generator/index.js';
export type { ExtensionInfo, OverlayConfig, OverlayResult } from './generator/overlayProcessor.js';

// ── Configuration ─────────────────────────────────────────
export {
  isMultiModuleConfig,
  resolveModuleConfig,
  validateConfigKeys,
  expandPlaceholders,
} from './types.js';
export type {
  MultiModuleConfig,
  ModuleConfig,
  ModuleDefaults,
  ResolvedModuleConfig,
  ServerConfig,
  FrontendConfig,
  OutputConfig,
  ResolvedOutputConfig,
  GeneratorConfig,
} from './types.js';

// ── OpenAPI documents ─────────────────────────────────────
export { isReference, getRefName, extractDependencies } from './types.js';
export type {
  OpenAPISpec,
  PathItem,
  OperationObject,
  ParameterObject,
  RequestBodyObject,
  ResponseObject,
  SchemaObject,
  ReferenceObject,
  MediaTypeObject,
  LinkObject,
  OpenAPIType,
  LintError,
  DependencyRef,
  ModuleDependencies,
  InlineEventDefinition,
  InlineEventRaw,
  InteractionDefinitionRaw,
  ScreenEventDefinition,
} from './types.js';
