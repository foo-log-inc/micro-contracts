/**
 * OpenAPI lint check for guardrails
 * 
 * Supports both built-in linter and external command execution.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { spawn } from 'child_process';
import type { CheckResult, CheckOptions } from './types.js';
import { lintSpec, formatLintResults, type LintResult } from '../generator/linter.js';
import type { OpenAPISpec } from '../types.js';
import { loadGuardrailsConfig, loadGuardrailsConfigWithPath } from './config.js';
import { matchWithNegation } from '../glob.js';
import { glob } from 'glob';

/**
 * Find OpenAPI spec files based on guardrails config or defaults
 */
export async function findOpenAPISpecs(options: CheckOptions): Promise<string[]> {
  // Try to load guardrails config to find spec patterns
  const config = loadGuardrailsConfig(options.guardrailsPath);
  
  // Look for YAML files in spec directories - prioritize openapi/ subdirs
  const defaultPatterns = [
    'spec/**/openapi/*.yaml',
    'spec/**/openapi/*.yml',
  ];
  
  const specFiles: string[] = [];
  
  for (const pattern of defaultPatterns) {
    const matches = await glob(pattern, {
      ignore: [
        '**/node_modules/**',
        '**/*.overlay.yaml',
        '**/spectral.yaml',
        '**/.generated-manifest.json',
        '**/_shared/**',  // Exclude shared schemas
      ],
    });
    
    // Filter to only OpenAPI specs (have openapi and paths fields)
    for (const match of matches) {
      try {
        const content = fs.readFileSync(match, 'utf-8');
        const doc = yaml.load(content) as Record<string, unknown>;
        // Must have both 'openapi' version and 'paths' to be a full spec
        if (doc && typeof doc === 'object' && 'openapi' in doc && 'paths' in doc) {
          specFiles.push(match);
        }
      } catch {
        // Not a valid YAML or not an OpenAPI spec
      }
    }
  }
  
  return [...new Set(specFiles)]; // Deduplicate
}

/**
 * Execute an external command and capture output
 */
async function executeCommand(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Use shell to execute the full command string
    // This allows complex commands like "cmd1 && cmd2" or commands with pipes
    const child = spawn(command, [], {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    child.on('error', (err) => {
      resolve({ exitCode: 1, stdout: '', stderr: err.message });
    });
  });
}

/**
 * Expand placeholders in command template
 */
function expandPlaceholders(command: string, context: {
  files?: string[];
  cwd?: string;
}): string {
  let result = command;

  if (context.files) {
    result = result.replace(/\{files\}/g, context.files.join(' '));
  }

  if (context.cwd) {
    result = result.replace(/\{cwd\}/g, context.cwd);
  }

  return result;
}

/**
 * Run lint check on all OpenAPI specs
 */
export async function runLintCheck(options: CheckOptions): Promise<CheckResult> {
  const start = Date.now();
  
  try {
    // Load guardrails config to check for custom command
    const { config } = loadGuardrailsConfigWithPath(options.guardrailsPath);
    const lintConfig = config?.checks?.lint;

    // If custom command is configured and enabled, use it
    if (lintConfig?.command && lintConfig.enabled !== false) {
      return await runExternalLintCheck(lintConfig.command, options, start);
    }

    // Otherwise, use built-in linter
    return await runBuiltinLintCheck(options, start);
    
  } catch (error) {
    return {
      name: 'lint',
      status: 'fail',
      duration: Date.now() - start,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run external lint command
 */
async function runExternalLintCheck(
  commandTemplate: string,
  options: CheckOptions,
  start: number
): Promise<CheckResult> {
  // Find OpenAPI specs
  const specFiles = await findOpenAPISpecs(options);
  
  if (specFiles.length === 0) {
    return {
      name: 'lint',
      status: 'skip',
      duration: Date.now() - start,
      message: 'No OpenAPI specs found',
    };
  }

  // Expand placeholders
  const command = expandPlaceholders(commandTemplate, {
    files: specFiles,
    cwd: process.cwd(),
  });

  if (options.verbose) {
    console.log(`Running: ${command}`);
  }

  // Execute command
  const { exitCode, stdout, stderr } = await executeCommand(command);

  // Parse output for details
  const output = (stdout + stderr).trim();
  const lines = output.split('\n').filter(line => line.trim());

  if (exitCode === 0) {
    return {
      name: 'lint',
      status: 'pass',
      duration: Date.now() - start,
      message: `${specFiles.length} spec(s) passed lint`,
      details: options.verbose && lines.length > 0 ? lines : undefined,
    };
  }

  // Count errors and warnings from output
  const errorCount = (output.match(/error/gi) || []).length;
  const warningCount = (output.match(/warning/gi) || []).length;

  return {
    name: 'lint',
    status: 'fail',
    duration: Date.now() - start,
    message: `Lint failed with ${errorCount} error(s), ${warningCount} warning(s)`,
    details: lines.slice(0, 50), // Limit output
  };
}

/**
 * Run a custom command check (generic check execution)
 * This is used for checks defined in guardrails.yaml
 */
export async function runCustomCommandCheck(
  name: string,
  commandTemplate: string,
  options: CheckOptions
): Promise<CheckResult> {
  const start = Date.now();

  try {
    // Find OpenAPI specs for {files} placeholder
    const specFiles = await findOpenAPISpecs(options);

    // Expand placeholders
    const command = expandPlaceholders(commandTemplate, {
      files: specFiles.length > 0 ? specFiles : undefined,
      cwd: process.cwd(),
    });

    if (options.verbose) {
      console.log(`Running: ${command}`);
    }

    // Execute command
    const { exitCode, stdout, stderr } = await executeCommand(command);

    // Parse output for details
    const output = (stdout + stderr).trim();
    const lines = output.split('\n').filter(line => line.trim());

    if (exitCode === 0) {
      return {
        name,
        status: 'pass',
        duration: Date.now() - start,
        message: `${name} passed`,
        details: options.verbose && lines.length > 0 ? lines : undefined,
      };
    }

    // Count errors and warnings from output
    const errorCount = (output.match(/error/gi) || []).length;
    const warningCount = (output.match(/warning/gi) || []).length;

    return {
      name,
      status: 'fail',
      duration: Date.now() - start,
      message: errorCount > 0 || warningCount > 0
        ? `${name} failed with ${errorCount} error(s), ${warningCount} warning(s)`
        : `${name} failed (exit code: ${exitCode})`,
      details: lines.slice(0, 50), // Limit output
    };

  } catch (error) {
    return {
      name,
      status: 'fail',
      duration: Date.now() - start,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run built-in lint check
 */
async function runBuiltinLintCheck(options: CheckOptions, start: number): Promise<CheckResult> {
  // Find all OpenAPI specs
  const specFiles = await findOpenAPISpecs(options);
  
  if (specFiles.length === 0) {
    return {
      name: 'lint',
      status: 'skip',
      duration: Date.now() - start,
      message: 'No OpenAPI specs found',
    };
  }
  
  const allErrors: string[] = [];
  const allWarnings: string[] = [];
  let hasErrors = false;
  
  for (const specFile of specFiles) {
    try {
      const content = fs.readFileSync(specFile, 'utf-8');
      const spec = yaml.load(content) as OpenAPISpec;
      
      const result = lintSpec(spec, { strict: false });
      
      if (result.errors.length > 0) {
        hasErrors = true;
        for (const error of result.errors) {
          allErrors.push(`${specFile}: [${error.code}] ${error.message}`);
        }
      }
      
      if (result.warnings.length > 0) {
        for (const warning of result.warnings) {
          allWarnings.push(`${specFile}: [${warning.code}] ${warning.message}`);
        }
      }
    } catch (error) {
      allErrors.push(`${specFile}: Failed to parse - ${error instanceof Error ? error.message : String(error)}`);
      hasErrors = true;
    }
  }
  
  if (hasErrors) {
    return {
      name: 'lint',
      status: 'fail',
      duration: Date.now() - start,
      message: `${allErrors.length} error(s) in ${specFiles.length} spec(s)`,
      details: options.verbose ? [...allErrors, ...allWarnings.map(w => `⚠️ ${w}`)] : allErrors,
    };
  }
  
  return {
    name: 'lint',
    status: 'pass',
    duration: Date.now() - start,
    message: `${specFiles.length} spec(s) passed lint`,
    details: options.verbose && allWarnings.length > 0 
      ? allWarnings.map(w => `⚠️ ${w}`) 
      : undefined,
  };
}
