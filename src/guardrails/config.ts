/**
 * Guardrails configuration parser
 * 
 * Handles loading and validation of guardrails.yaml configuration files.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type { GuardrailsConfig } from './types.js';

/**
 * Default guardrails configuration
 */
export const DEFAULT_GUARDRAILS: GuardrailsConfig = {
  allowed: [
    'spec/**/*.yaml',
    'spec/**/*.yml',
    'spec/**/*.hbs',
    'server/src/**/services/**/*.ts',
    'server/src/**/container.ts',
    'server/src/server.ts',
    'docs/**/*.md',
    'README.md',
    'package.json',
    'tsconfig.json',
  ],
  protected: [
    'spec/spectral.yaml',
    'spec/_shared/overlays/**',
    'guardrails.yaml',
    '.github/**',
  ],
  generated: [
    'packages/**',
    '**/*.generated.ts',
    '**/*.generated.yaml',
    '**/*.generated.yml',
  ],
};

/**
 * Find guardrails config file in current directory or ancestors
 */
export function findGuardrailsConfig(startDir?: string): string | null {
  const dir = startDir || process.cwd();
  // Support multiple naming conventions
  const candidates = [
    'micro-contracts.guardrails.yaml',
    'micro-contracts.guardrails.yml',
    'guardrails.yaml',  // Legacy name
    'guardrails.yml',
  ];
  
  let current = path.resolve(dir);
  const root = path.parse(current).root;
  
  while (current !== root) {
    for (const candidate of candidates) {
      const configPath = path.join(current, candidate);
      if (fs.existsSync(configPath)) {
        return configPath;
      }
    }
    current = path.dirname(current);
  }
  
  return null;
}

export interface LoadedGuardrailsConfig {
  config: GuardrailsConfig;
  /** Directory containing the guardrails config file (for relative path resolution) */
  baseDir: string;
  /** Full path to the config file (null if using defaults) */
  configPath: string | null;
}

/**
 * Load guardrails configuration from file
 * Falls back to defaults if file not found
 */
export function loadGuardrailsConfig(configPath?: string): GuardrailsConfig {
  const result = loadGuardrailsConfigWithPath(configPath);
  return result.config;
}

/**
 * Load guardrails configuration with path information
 * Returns both the config and the base directory for relative path resolution
 */
export function loadGuardrailsConfigWithPath(configPath?: string): LoadedGuardrailsConfig {
  const resolvedPath = configPath || findGuardrailsConfig();
  
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    // Return default config with current directory as base
    return {
      config: DEFAULT_GUARDRAILS,
      baseDir: process.cwd(),
      configPath: null,
    };
  }
  
  const content = fs.readFileSync(resolvedPath, 'utf-8');
  const config = yaml.load(content) as GuardrailsConfig;
  
  // Validate basic structure
  if (typeof config !== 'object' || config === null) {
    throw new Error(`Invalid guardrails config: ${resolvedPath}`);
  }
  
  // Merge with defaults for any missing sections
  const mergedConfig: GuardrailsConfig = {
    allowed: config.allowed ?? DEFAULT_GUARDRAILS.allowed,
    protected: config.protected ?? DEFAULT_GUARDRAILS.protected,
    generated: config.generated ?? DEFAULT_GUARDRAILS.generated,
    checks: config.checks,  // Pass through checks config
  };
  
  return {
    config: mergedConfig,
    baseDir: path.dirname(resolvedPath),
    configPath: resolvedPath,
  };
}

/**
 * Create a guardrails.yaml template
 */
export function generateGuardrailsTemplate(): string {
  const template = `# AI-Driven Development Guardrails Configuration
# 
# This file defines which files can be modified in normal development PRs.
# Patterns use gitignore-style matching with glob patterns.
# Prefix with ! to negate (exclude) a pattern.

# Files that can be edited in normal development PRs
allowed:
  # OpenAPI specs (source of truth)
  - spec/**/openapi/*.yaml
  - spec/**/templates/*.hbs
  
  # Service implementations (human-written). \`init\` scaffolds these under
  # src/<module>/ by default, and under server/src/ when run with --dir.
  - src/**/*.ts
  - server/src/**/services/**/*.ts
  - server/src/**/container.ts
  - server/src/server.ts
  
  # Module-specific overlays (NOT _shared)
  - server/src/*/overlays/**/*.ts
  - "!server/src/_shared/overlays/**"
  
  # Configuration
  - micro-contracts.config.yaml
  - micro-contracts.guardrails.yaml
  - package.json
  - tsconfig.json
  
  # Documentation
  - docs/**/*.md
  - README.md

# Files that require special approval
protected:
  # Spectral lint rules
  - spec/spectral.yaml
  
  # Shared overlay definitions
  - spec/_shared/overlays/**
  
  # Shared security overlay implementations
  - server/src/_shared/overlays/**
  
  # This guardrails configuration
  - micro-contracts.guardrails.yaml
  
  # CI/workflow definitions
  - .github/**

# Generated artifacts (committed, but only modified via generate)
generated:
  # Contract packages
  - packages/**
  
  # Generated files
  - "**/*.generated.ts"
  - "**/*.generated.yaml"
  - "**/*.generated.yml"
`;
  
  return template;
}

/**
 * Write guardrails template to file
 */
export function createGuardrailsConfig(outputPath: string = 'micro-contracts.guardrails.yaml'): void {
  const template = generateGuardrailsTemplate();
  fs.writeFileSync(outputPath, template);
}

