/**
 * Guardrails type definitions
 * 
 * These types define the structure for AI-driven development guardrails
 * that protect generated artifacts and enforce change policies.
 */

/**
 * Guardrails configuration file structure (guardrails.yaml)
 */
export interface GuardrailsConfig {
  /**
   * Paths that can be edited in normal development PRs
   * Supports glob patterns and negation (prefix with !)
   */
  allowed?: string[];

  /**
   * Paths that require special approval (e.g., security config, CI)
   * Supports glob patterns and negation (prefix with !)
   */
  protected?: string[];

  /**
   * Paths for generated artifacts (committed but only modified via generate)
   * Supports glob patterns and negation (prefix with !)
   */
  generated?: string[];

  /**
   * Check command configurations
   * Define custom commands for each guardrail check
   */
  checks?: ChecksConfig;
}

/**
 * Configuration for guardrail check commands
 */
export interface ChecksConfig {
  /** Checks by name; every one runs its own command */
  [key: string]: CheckCommandConfig | undefined;
}

/**
 * Gate numbers for guardrail checks
 * 
 * Gate 1: Change Allowlist (allowlist)
 * Gate 2: OpenAPI Contract Validation (spec-lint, spec-breaking)
 * Gate 3: Generated Artifact Integrity (drift, manifest)
 * Gate 4: Code Quality (code-lint, code-typecheck, code-test)
 * Gate 5: Doc Consistency & Static Analysis (docs-sync, docs-links, security)
 */
export type GateNumber = 1 | 2 | 3 | 4 | 5;

/**
 * Configuration for a single check command
 */
export interface CheckCommandConfig {
  /**
   * Command template to run.
   * Supports placeholders:
   * - {files} - space-separated list of target files (auto-detected)
   * - {cwd} - current working directory
   * 
   * @example
   * command: "npx @stoplight/spectral-cli lint {files} --ruleset spec/spectral.yaml"
   */
  command: string;

  /**
   * Whether this check is enabled (default: true)
   */
  enabled?: boolean;

  /**
   * Gate number this check belongs to (1-5)
   * Used with --gate option to run checks by gate
   * 
   * Gate 1: Change Allowlist
   * Gate 2: OpenAPI Contract Validation
   * Gate 3: Generated Artifact Integrity
   * Gate 4: Code Quality
   * Gate 5: Doc Consistency & Static Analysis
   */
  gate?: GateNumber;
}

/**
 * Result of allowlist verification
 */
export interface AllowlistResult {
  valid: boolean;
  violations: AllowlistViolation[];
}

/**
 * A single allowlist violation
 */
export interface AllowlistViolation {
  file: string;
  reason: 'protected' | 'not-in-allowlist';
}

/**
 * Result of drift check
 */
export interface DriftResult {
  valid: boolean;
  changedFiles: string[];
  error?: string;
}

/**
 * Generated artifact manifest structure
 */
export interface GeneratedManifest {
  /** Manifest format version */
  version: string;
  /** Timestamp when manifest was last updated (only changes when files change) */
  updatedAt?: string;
  /** Version of micro-contracts that generated this */
  generatorVersion: string;
  /** SHA-256 hash of all input files (config, specs, templates, overlays) + package version */
  inputHash?: string;
  /** Map of relative file paths to their metadata */
  files: Record<string, GeneratedFileInfo>;
}

/**
 * Metadata for a single generated file
 */
export interface GeneratedFileInfo {
  /** SHA-256 hash of file content */
  sha256: string;
  /** Source file that generated this (e.g., OpenAPI spec path) */
  source?: string;
}

/**
 * Result of manifest verification
 */
export interface ManifestResult {
  valid: boolean;
  mismatches: ManifestMismatch[];
  manifestPath?: string;
}

/**
 * A single manifest mismatch
 */
export interface ManifestMismatch {
  file: string;
  reason: 'missing' | 'hash-mismatch' | 'extra';
  expected?: string;
  actual?: string;
}

/**
 * Options for check command
 */
export interface CheckOptions {
  /** Run specific checks only */
  only?: string[];
  /** Skip specific checks */
  skip?: string[];
  /** Run checks for specific gates only (1-5) */
  gates?: GateNumber[];
  /** Enable verbose output */
  verbose?: boolean;
  /** Enable auto-fix where possible */
  fix?: boolean;
  /** Path to guardrails.yaml */
  guardrailsPath?: string;
  /** Path to generated files directory */
  generatedDir?: string;
  /** File containing list of changed files (for CI) */
  changedFilesPath?: string;
  /** Callback called when each check completes (for streaming output) */
  onCheckComplete?: (result: CheckResult, check: CheckDefinition) => void;
  /** Callback called before each check starts (for streaming output) */
  onCheckStart?: (check: CheckDefinition) => void;
}

/**
 * Result of a single check
 */
export interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  duration: number;
  message?: string;
  details?: string[];
}

/**
 * Overall check summary
 */
export interface CheckSummary {
  passed: number;
  failed: number;
  skipped: number;
  results: CheckResult[];
}

/**
 * Check definition
 */
export interface CheckDefinition {
  name: string;
  description: string;
  /** Gate number this check belongs to (1-5) */
  gate?: GateNumber;
  run: (options: CheckOptions) => Promise<CheckResult>;
}

