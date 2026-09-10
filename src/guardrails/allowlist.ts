/**
 * Allowlist verification for guardrails
 * 
 * Verifies that changed files are within allowed boundaries.
 */

import fs from 'fs';
import path from 'path';
import { matchWithNegation } from '../glob.js';
import { execSync } from 'child_process';
import type { GuardrailsConfig, AllowlistResult, AllowlistViolation, CheckResult, CheckOptions } from './types.js';
import { loadGuardrailsConfigWithPath } from './config.js';



/**
 * Get list of changed files, filtered to a specific base directory
 */
export function getChangedFiles(options: {
  /** Path to file containing list of changed files */
  changedFilesPath?: string;
  /** Ref to diff against. Defaults to the base of the pull request under review, if any. */
  baseRef?: string;
  /** Base directory to filter files (only files under this dir are returned) */
  baseDir?: string;
}): string[] {
  const { changedFilesPath, baseDir } = options;
  // A list handed in from outside is already the answer; there is nothing left to resolve.
  const baseRef = changedFilesPath ? undefined : (options.baseRef ?? pullRequestBaseRef());
  
  let files: string[];
  
  if (changedFilesPath) {
    // Read from file (CI mode)
    if (!fs.existsSync(changedFilesPath)) {
      throw new Error(`Changed files list not found: ${changedFilesPath}`);
    }
    files = fs.readFileSync(changedFilesPath, 'utf-8')
      .trim()
      .split('\n')
      .filter(Boolean);
  } else if (baseRef && baseRef !== 'HEAD') {
    // What the pull request adds to its base.
    files = runGit(`git diff --name-only ${baseRef}...HEAD`);
  } else {
    // Everything not yet committed. Taking staged files and only falling back to
    // unstaged ones left a partly staged change half inspected: an edit to a
    // protected path went unseen as long as something else was staged.
    files = [...new Set([
      ...runGit('git diff --name-only HEAD'),
      ...runGit('git ls-files --others --exclude-standard'),
    ])];
  }
  
  // Filter and convert paths relative to baseDir
  if (baseDir) {
    // Get git root to resolve absolute paths
    let gitRoot: string;
    try {
      gitRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
    } catch {
      gitRoot = process.cwd();
    }
    
    const absoluteBaseDir = path.resolve(baseDir);
    
    // Filter to only files under baseDir and convert to relative paths
    files = files
      .map(f => path.resolve(gitRoot, f))  // Convert to absolute
      .filter(f => f.startsWith(absoluteBaseDir + path.sep) || f === absoluteBaseDir)  // Filter to baseDir
      .map(f => path.relative(absoluteBaseDir, f));  // Convert to relative from baseDir
  }
  
  return files;
}

/**
 * The ref the changes under review are proposed against, when the run is a CI check on a
 * pull request.
 *
 * A CI checkout is clean, so "everything not yet committed" is empty there: the check read
 * no file at all and reported a pass on every pull request, including ones that edited a
 * protected path. The base branch is the only thing such a run has to compare against.
 * GitHub Actions sets GITHUB_BASE_REF on pull_request events and leaves it empty everywhere
 * else, so a working copy still answers about its own uncommitted edits.
 */
function pullRequestBaseRef(): string | undefined {
  const branch = process.env.GITHUB_BASE_REF?.trim();
  if (!branch) {
    return undefined;
  }

  const ref = `origin/${branch}`;
  try {
    execSync(`git rev-parse --verify --quiet ${ref}^{commit}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    // Reading this as "nothing to compare, so nothing changed" is how the check passed
    // without inspecting anything in the first place.
    throw new Error(
      `Cannot determine changed files: ${ref} is not in this checkout. ` +
      'Check out the full history (actions/checkout with fetch-depth: 0).'
    );
  }
  return ref;
}

/**
 * Run a git command, returning its output lines.
 *
 * Failures propagate: returning no files would report "nothing changed" when the
 * truth is that nothing could be inspected.
 */
function runGit(command: string): string[] {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
      .trim()
      .split('\n')
      .filter(Boolean);
  } catch (error) {
    throw new Error(
      `Cannot determine changed files (${command}): ` +
      (error instanceof Error ? error.message.split('\n')[0] : String(error))
    );
  }
}

/**
 * Verify changed files against allowlist
 */
export function verifyAllowlist(
  changedFiles: string[],
  config: GuardrailsConfig
): AllowlistResult {
  const violations: AllowlistViolation[] = [];
  
  for (const file of changedFiles) {
    // 1. Check if protected (not allowed in normal PRs)
    if (matchWithNegation(config.protected, file)) {
      violations.push({ file, reason: 'protected' });
      continue;
    }
    
    // 2. Check if generated (allowed, but must pass drift/manifest checks)
    if (matchWithNegation(config.generated, file)) {
      // Generated files are allowed to change, but we don't add a violation
      // The drift/manifest checks will verify integrity
      continue;
    }
    
    // 3. Must be in allowed list
    if (!matchWithNegation(config.allowed, file)) {
      violations.push({ file, reason: 'not-in-allowlist' });
    }
  }
  
  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Run allowlist check
 */
export async function runAllowlistCheck(options: CheckOptions): Promise<CheckResult> {
  const start = Date.now();
  
  try {
    // Load config with path information
    const { config, baseDir, configPath } = loadGuardrailsConfigWithPath(options.guardrailsPath);
    
    // Get changed files relative to guardrails config directory
    const baseRef = options.changedFilesPath ? undefined : pullRequestBaseRef();
    const changedFiles = getChangedFiles({
      changedFilesPath: options.changedFilesPath,
      baseRef,
      baseDir,  // Filter to files under guardrails.yaml directory
    });
    
    // An empty result means "this pull request changed nothing here" or "this working tree
    // has no edits here", and those are different claims. Naming what was compared is what
    // separates them: a green run that had read no file at all read identically to one that
    // had read the whole change.
    const against = baseRef
      ? `compared against ${baseRef}`
      : 'compared against the working tree';
    
    if (changedFiles.length === 0) {
      return {
        name: 'allowlist',
        status: 'pass',
        duration: Date.now() - start,
        message: configPath 
          ? `No changed files under ${path.basename(path.dirname(configPath))}/ (${against})`
          : `No changed files to check (${against})`,
      };
    }
    
    // Verify allowlist
    const result = verifyAllowlist(changedFiles, config);
    
    if (result.valid) {
      return {
        name: 'allowlist',
        status: 'pass',
        duration: Date.now() - start,
        message: `All ${changedFiles.length} changed files are within allowed boundaries (${against})`,
      };
    }
    
    // Build error details
    const details = result.violations.map(v => 
      `  - ${v.file} (${v.reason})`
    );
    
    return {
      name: 'allowlist',
      status: 'fail',
      duration: Date.now() - start,
      message: `${result.violations.length} file(s) are not allowed to be modified`,
      details,
    };
    
  } catch (error) {
    return {
      name: 'allowlist',
      status: 'fail',
      duration: Date.now() - start,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Format allowlist result for CLI output
 */
export function formatAllowlistResult(result: AllowlistResult): string {
  const lines: string[] = [];
  
  if (result.valid) {
    lines.push('✅ All changed files are within allowed boundaries');
  } else {
    lines.push('❌ The following files are not allowed to be modified in a normal PR:\n');
    
    for (const { file, reason } of result.violations) {
      lines.push(`  - ${file} (${reason})`);
    }
    
    lines.push('\n💡 If this is a generated artifact, run the pinned generator and pass drift/manifest checks.');
    lines.push('💡 If this should be editable, update guardrails.yaml (allowed/protected/generated).');
  }
  
  return lines.join('\n');
}

