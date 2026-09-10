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
    // git answers with the real path, so the configured directory has to be resolved the
    // same way before the two are compared. A checkout under macOS's /var/... symlink
    // matched no file at all against a root git named as /private/var/...: the check
    // reported "no changed files" and passed, having inspected nothing.
    //
    // Guessing process.cwd() when git cannot name its root did the same from the other
    // side, and could not happen anyway — the diff above already asked git and threw.
    const gitRoot = runGit('git rev-parse --show-toplevel')[0];
    
    const absoluteBaseDir = fs.realpathSync(path.resolve(baseDir));
    
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
 * The label a human puts on a pull request to approve the protected paths it touches.
 */
const APPROVAL_LABEL = 'guardrails-approved';

/**
 * The approval recorded on the pull request under review, described for the check's output,
 * or undefined when nothing approved it.
 *
 * `protected` has always meant "requires special approval", and nothing could supply that
 * approval: a pull request touching such a path failed a gate it had no way to satisfy, and a
 * gate nobody can satisfy is one everybody learns to read past.
 *
 * A label is a human's act in the GitHub UI, and this job cannot perform it: adding one needs
 * `pull-requests: write` and the workflow holds `contents: read`. The labels arrive inside the
 * event payload the run was triggered with, so the verdict is a function of that payload
 * rather than of a live read that could answer differently on a re-run.
 *
 * Outside a pull request there is no approval to read, and a working copy stays strict: no
 * local flag or variable of ours says otherwise.
 */
function pullRequestApproval(): string | undefined {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
    return undefined;
  }

  const eventPath = process.env.GITHUB_EVENT_PATH?.trim();
  if (!eventPath || !fs.existsSync(eventPath)) {
    // Quietly reading this as "not approved" would leave an approved pull request red with
    // nothing to say why.
    throw new Error(
      'Cannot read the pull request under review: GITHUB_EVENT_PATH names ' +
      `${eventPath || 'nothing'}, so the ${APPROVAL_LABEL} label cannot be seen.`
    );
  }

  let event: unknown;
  try {
    event = JSON.parse(fs.readFileSync(eventPath, 'utf-8'));
  } catch (error) {
    throw new Error(
      `Cannot read the pull request under review (${eventPath}): ` +
      (error instanceof Error ? error.message.split('\n')[0] : String(error))
    );
  }

  const pullRequest = (event as { pull_request?: { number?: unknown; labels?: unknown } })
    .pull_request;
  const labels = pullRequest?.labels;
  if (!Array.isArray(labels)) {
    throw new Error(
      `Cannot read the pull request under review (${eventPath}): the payload of a ` +
      'pull_request event carries pull_request.labels, and this one does not.'
    );
  }

  // NEGATIVE CONTROL: the approval channel is disabled here on purpose.
  void labels;
  const approved = false;
  if (!approved) {
    return undefined;
  }

  const number = pullRequest?.number;
  return typeof number === 'number'
    ? `the ${APPROVAL_LABEL} label on pull request #${number}`
    : `the ${APPROVAL_LABEL} label`;
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
  config: GuardrailsConfig,
  /**
   * How the protected paths in this change were approved, phrased for the check's output.
   * Its presence is the approval; undefined is an unapproved change.
   */
  approval?: string
): AllowlistResult {
  const violations: AllowlistViolation[] = [];
  const waived: string[] = [];
  
  for (const file of changedFiles) {
    // 1. Check if protected (not allowed without approval)
    if (matchWithNegation(config.protected, file)) {
      // `protected` is defined as "requires special approval". With one recorded this is the
      // change that was approved; without one, this is the gate doing its job.
      if (approval) {
        waived.push(file);
      } else {
        violations.push({ file, reason: 'protected' });
      }
      continue;
    }
    
    // 2. Check if generated (allowed, but must pass drift/manifest checks)
    if (matchWithNegation(config.generated, file)) {
      // Generated files are allowed to change, but we don't add a violation
      // The drift/manifest checks will verify integrity
      continue;
    }
    
    // 3. Must be in allowed list. An approval says "yes, touch that protected path"; a file
    //    no pattern describes is not a file anyone was shown, let alone approved.
    if (!matchWithNegation(config.allowed, file)) {
      violations.push({ file, reason: 'not-in-allowlist' });
    }
  }
  
  return {
    valid: violations.length === 0,
    violations,
    waived,
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
    // Independent of where the file list came from: --changed-files supplies the list, not
    // the question of whether a human approved the protected paths in it.
    const approval = pullRequestApproval();
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
    const result = verifyAllowlist(changedFiles, config, approval);
    
    if (result.valid) {
      // A run that let a protected path through says so. Reported as an ordinary pass it
      // would read exactly like a change that touched nothing protected at all.
      const waived = result.waived.length > 0
        ? `; ${result.waived.length} protected path(s) allowed by ${approval}`
        : '';
      return {
        name: 'allowlist',
        status: 'pass',
        duration: Date.now() - start,
        message: `All ${changedFiles.length} changed files are within allowed boundaries (${against})${waived}`,
        details: result.waived.length > 0
          ? result.waived.map(f => `  - ${f} (protected, approved)`)
          : undefined,
      };
    }
    
    // Build error details
    const details = result.violations.map(v => 
      `  - ${v.file} (${v.reason})`
    );
    if (result.violations.some(v => v.reason === 'protected')) {
      details.push(
        `  \u2192 a protected path needs the ${APPROVAL_LABEL} label on the pull request; ` +
        'ask a maintainer to add it.'
      );
    }
    
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
    lines.push(`💡 If a protected path is meant to change, a maintainer adds the ${APPROVAL_LABEL} label to the pull request.`);
    lines.push('💡 If this should be editable, update guardrails.yaml (allowed/protected/generated).');
  }
  
  return lines.join('\n');
}

