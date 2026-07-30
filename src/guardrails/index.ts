/**
 * Guardrails module
 * 
 * Provides AI-driven development guardrails for protecting generated artifacts
 * and enforcing change policies.
 */

// Types
export type {
  GuardrailsConfig,
  ChecksConfig,
  CheckCommandConfig,
  AllowlistResult,
  AllowlistViolation,
  DriftResult,
  GeneratedManifest,
  GeneratedFileInfo,
  ManifestResult,
  ManifestMismatch,
  CheckOptions,
  CheckResult,
  CheckSummary,
  CheckDefinition,
  GateNumber,
} from './types.js';

// Config
export {
  DEFAULT_GUARDRAILS,
  findGuardrailsConfig,
  loadGuardrailsConfig,
  loadGuardrailsConfigWithPath,
  generateGuardrailsTemplate,
  createGuardrailsConfig,
} from './config.js';

export type { LoadedGuardrailsConfig } from './config.js';

// Allowlist
export {
  getChangedFiles,
  verifyAllowlist,
  runAllowlistCheck,
  formatAllowlistResult,
} from './allowlist.js';

// Drift
export {
  checkUncommittedChanges,
  runDriftCheck,
  formatDriftResult,
} from './drift.js';

// Manifest
export {
  hashFile,
  getGeneratedFiles,
  generateManifest,
  writeManifest,
  loadManifest,
  verifyManifest,
  canSkipGeneration,
  runManifestCheck,
  formatManifestResult,
} from './manifest.js';

export type { GenerateManifestResult } from './manifest.js';

// Lint
export { findOpenAPISpecs } from './lint.js';

// Check runner
export {
  formatVerdict,
  runAllChecks,
  formatCheckResults,
  formatSingleCheckResult,
  formatCheckStart,
  formatCheckSummary,
  getAvailableChecks,
  GATE_DESCRIPTIONS,
} from './runner.js';

export type { CheckSummaryWithGates } from './runner.js';

// Glob matching (shared with output selection)
export { matchGlob, matchWithNegation } from '../glob.js';
