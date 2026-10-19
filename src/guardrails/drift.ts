/**
 * Drift detection for generated artifacts
 * 
 * Verifies that generated files match the committed state after running generate.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { DriftResult, CheckResult, CheckOptions } from './types.js';
import { generatedFilesRule, isGeneratedFile, resolveManifestDir, type GeneratedFilesRule } from './manifest.js';

/**
 * Check for uncommitted changes to generated files (including untracked ones)
 * in `generatedDir`. Only what `rule` calls generated counts: the directory may
 * hold hand-written files as well.
 */
export function checkUncommittedChanges(generatedDir: string, rule: GeneratedFilesRule): DriftResult {
  const git = (command: string) => execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });

  try {
    // Against HEAD, not the index: `git diff <dir>` compares the worktree to the
    // index, so staging a hand-edited generated file hides it — which is exactly
    // what a pre-commit run does before invoking this check.
    const modifiedOutput = git(`git diff --name-only HEAD -- "${generatedDir}"`);

    // Check for untracked files (named from the repository root, as git diff names them)
    const untrackedOutput = git(`git ls-files --others --exclude-standard --full-name "${generatedDir}"`);

    // git names files from the repository root by their real path; the rule's
    // directory is resolved the same way before the two are compared.
    const gitRoot = git('git rev-parse --show-toplevel').trim();
    const ruleBase = fs.realpathSync(path.resolve(rule.baseDir));
    const generated = (file: string) =>
      isGeneratedFile(rule.patterns, path.relative(ruleBase, path.resolve(gitRoot, file)).split(path.sep).join('/'));

    const modifiedFiles = modifiedOutput.trim().split('\n').filter(Boolean);
    const untrackedFiles = untrackedOutput.trim().split('\n').filter(Boolean);
    const allChangedFiles = [...new Set([...modifiedFiles, ...untrackedFiles])].filter(generated);
    
    return {
      valid: allChangedFiles.length === 0,
      changedFiles: allChangedFiles,
    };
  } catch (error) {
    return {
      valid: false,
      changedFiles: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Run drift check
 */
export async function runDriftCheck(options: CheckOptions): Promise<CheckResult> {
  const start = Date.now();
  const rule = generatedFilesRule(options.guardrailsPath);
  const generatedDir = resolveManifestDir(options.generatedDir, rule, options.configPath);

  try {
    // `git diff` reports nothing for a path that does not exist, which would
    // read as "no drift" while nothing was inspected.
    if (!fs.existsSync(generatedDir)) {
      return {
        name: 'drift',
        status: 'fail',
        duration: Date.now() - start,
        message: `Generated directory not found: ${generatedDir}`,
      };
    }

    const result = checkUncommittedChanges(generatedDir, rule);
    
    if (result.error) {
      return {
        name: 'drift',
        status: 'fail',
        duration: Date.now() - start,
        message: `Git error: ${result.error}`,
      };
    }
    
    if (result.valid) {
      return {
        name: 'drift',
        status: 'pass',
        duration: Date.now() - start,
        message: `No uncommitted changes to generated files in ${generatedDir}`,
      };
    }
    
    const details = result.changedFiles.map(f => `  - ${f}`);
    
    return {
      name: 'drift',
      status: 'fail',
      duration: Date.now() - start,
      message: `${result.changedFiles.length} file(s) have uncommitted changes`,
      details,
    };
    
  } catch (error) {
    return {
      name: 'drift',
      status: 'fail',
      duration: Date.now() - start,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Format drift result for CLI output
 */
export function formatDriftResult(result: DriftResult): string {
  const lines: string[] = [];
  
  if (result.error) {
    lines.push(`❌ Drift check failed: ${result.error}`);
    return lines.join('\n');
  }
  
  if (result.valid) {
    lines.push('✅ No drift detected - generated files match committed state');
  } else {
    lines.push('❌ Generated code differs from committed code:\n');
    
    for (const file of result.changedFiles) {
      lines.push(`  - ${file}`);
    }
    
    lines.push('\n💡 Run `micro-contracts generate` to regenerate artifacts.');
    lines.push('💡 Then commit the changes or verify they are expected.');
  }
  
  return lines.join('\n');
}

