/**
 * Generated artifact manifest management
 * 
 * Creates and verifies manifests for generated files to detect tampering.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { glob } from 'glob';
import type { 
  GeneratedManifest, 
  GeneratedFileInfo, 
  ManifestResult, 
  ManifestMismatch,
  CheckResult,
  CheckOptions,
} from './types.js';

/** Current manifest format version */
const MANIFEST_VERSION = '1.0';

/** Manifest file name */
const MANIFEST_FILENAME = '.generated-manifest.json';

/**
 * Calculate SHA-256 hash of file content
 */
export function hashFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Get all generated files in a directory
 */
export async function getGeneratedFiles(
  baseDir: string,
  patterns: string[] = ['**/*']
): Promise<string[]> {
  const files: string[] = [];
  
  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      cwd: baseDir,
      nodir: true,
      ignore: [
        '**/node_modules/**',
        '**/.git/**',
        MANIFEST_FILENAME,
      ],
    });
    files.push(...matches);
  }
  
  // Deduplicate and sort
  return [...new Set(files)].sort();
}

/**
 * Result of manifest generation with change detection
 */
export interface GenerateManifestResult {
  manifest: GeneratedManifest;
  changed: boolean;
}

/**
 * Compare two manifest file records for equality
 */
function areFilesEqual(
  oldFiles: Record<string, GeneratedFileInfo>,
  newFiles: Record<string, GeneratedFileInfo>
): boolean {
  const oldKeys = Object.keys(oldFiles).sort();
  const newKeys = Object.keys(newFiles).sort();
  
  if (oldKeys.length !== newKeys.length) return false;
  if (oldKeys.join(',') !== newKeys.join(',')) return false;
  
  for (const key of oldKeys) {
    if (oldFiles[key].sha256 !== newFiles[key].sha256) return false;
  }
  
  return true;
}

/**
 * Generate manifest for a directory of generated files
 * Only updates `updatedAt` timestamp when files actually change
 */
export async function generateManifest(
  baseDir: string,
  options: {
    generatorVersion?: string;
    inputHash?: string;
    sourceMap?: Map<string, string>;  // file -> source mapping
    patterns?: string[];
  } = {}
): Promise<GenerateManifestResult> {
  const {
    generatorVersion = '1.0.0',
    inputHash,
    sourceMap = new Map(),
    patterns = ['**/*'],
  } = options;
  
  const files = await getGeneratedFiles(baseDir, patterns);
  const fileInfos: Record<string, GeneratedFileInfo> = {};
  
  for (const relPath of files) {
    const fullPath = path.join(baseDir, relPath);
    
    if (!fs.existsSync(fullPath)) continue;
    if (fs.statSync(fullPath).isDirectory()) continue;
    
    const info: GeneratedFileInfo = {
      sha256: hashFile(fullPath),
    };
    
    // Add source if available
    const source = sourceMap.get(relPath);
    if (source) {
      info.source = source;
    }
    
    fileInfos[relPath] = info;
  }
  
  // Load existing manifest to compare
  const existingManifest = loadManifest(baseDir);
  
  // Check if files have changed
  const filesChanged = !existingManifest || !areFilesEqual(existingManifest.files, fileInfos);
  
  // Check if generator version has changed
  const versionChanged = !existingManifest || existingManifest.generatorVersion !== generatorVersion;
  
  // Check if input hash has changed
  const inputHashChanged = inputHash !== undefined &&
    (!existingManifest || existingManifest.inputHash !== inputHash);
  
  // Content is considered changed if files, version, or input hash changed
  const changed = filesChanged || versionChanged || inputHashChanged;
  
  // Only update timestamp if something changed
  const updatedAt = changed 
    ? new Date().toISOString() 
    : existingManifest?.updatedAt;
  
  const manifest: GeneratedManifest = {
    version: MANIFEST_VERSION,
    generatorVersion,
    files: fileInfos,
  };
  
  if (inputHash !== undefined) {
    manifest.inputHash = inputHash;
  }
  
  // Only include updatedAt if we have a timestamp
  if (updatedAt) {
    manifest.updatedAt = updatedAt;
  }
  
  return {
    manifest,
    changed,
  };
}

/**
 * Check whether generation can be skipped.
 *
 * Returns `skip: true` only when:
 *  1. A manifest exists with a matching `inputHash`, AND
 *  2. Every generated file on disk still matches the manifest hashes.
 */
export async function canSkipGeneration(
  manifestDir: string,
  inputHash: string,
): Promise<{ skip: boolean; reason: string }> {
  const manifest = loadManifest(manifestDir);

  if (!manifest) {
    return { skip: false, reason: 'No manifest found' };
  }

  if (!manifest.inputHash) {
    return { skip: false, reason: 'Manifest has no inputHash (pre-cache version)' };
  }

  if (manifest.inputHash !== inputHash) {
    return { skip: false, reason: 'Input files have changed' };
  }

  // Input hash matches — verify that output files are intact
  const verification = await verifyManifest(manifestDir);
  if (!verification.valid) {
    const count = verification.mismatches.length;
    return { skip: false, reason: `${count} generated file(s) have been modified` };
  }

  return { skip: true, reason: 'Input and output hashes match' };
}

/**
 * Write manifest to file
 */
export function writeManifest(manifest: GeneratedManifest, baseDir: string): string {
  const manifestPath = path.join(baseDir, MANIFEST_FILENAME);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return manifestPath;
}

/**
 * Load manifest from file
 */
export function loadManifest(baseDir: string): GeneratedManifest | null {
  const manifestPath = path.join(baseDir, MANIFEST_FILENAME);
  
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(content) as GeneratedManifest;
  } catch {
    return null;
  }
}

/**
 * Verify generated files against manifest
 */
export async function verifyManifest(baseDir: string): Promise<ManifestResult> {
  const manifest = loadManifest(baseDir);
  
  if (!manifest) {
    return {
      valid: false,
      mismatches: [{
        file: MANIFEST_FILENAME,
        reason: 'missing',
      }],
      manifestPath: path.join(baseDir, MANIFEST_FILENAME),
    };
  }
  
  const mismatches: ManifestMismatch[] = [];
  
  // Check files in manifest
  for (const [relPath, meta] of Object.entries(manifest.files)) {
    const fullPath = path.join(baseDir, relPath);
    
    if (!fs.existsSync(fullPath)) {
      mismatches.push({
        file: relPath,
        reason: 'missing',
      });
      continue;
    }
    
    const actualHash = hashFile(fullPath);
    
    if (actualHash !== meta.sha256) {
      mismatches.push({
        file: relPath,
        reason: 'hash-mismatch',
        expected: meta.sha256.slice(0, 16) + '...',
        actual: actualHash.slice(0, 16) + '...',
      });
    }
  }
  
  // Check for extra files not in manifest
  const currentFiles = await getGeneratedFiles(baseDir);
  const manifestFiles = new Set(Object.keys(manifest.files));
  
  for (const file of currentFiles) {
    if (!manifestFiles.has(file)) {
      mismatches.push({
        file,
        reason: 'extra',
      });
    }
  }
  
  return {
    valid: mismatches.length === 0,
    mismatches,
    manifestPath: path.join(baseDir, MANIFEST_FILENAME),
  };
}

/**
 * Run manifest verification check
 */
export async function runManifestCheck(options: CheckOptions): Promise<CheckResult> {
  const start = Date.now();
  const generatedDir = options.generatedDir || 'packages/';
  
  try {
    // Nothing to verify is not the same as verified.
    if (!fs.existsSync(generatedDir)) {
      return {
        name: 'manifest',
        status: 'fail',
        duration: Date.now() - start,
        message: `Generated directory not found: ${generatedDir}`,
      };
    }
    
    const result = await verifyManifest(generatedDir);
    
    if (result.valid) {
      const manifest = loadManifest(generatedDir);
      const fileCount = manifest ? Object.keys(manifest.files).length : 0;
      
      return {
        name: 'manifest',
        status: 'pass',
        duration: Date.now() - start,
        message: `All ${fileCount} generated files match manifest`,
      };
    }
    
    const details = result.mismatches.map(m => {
      if (m.reason === 'missing') {
        return `  - ${m.file}: FILE MISSING`;
      } else if (m.reason === 'hash-mismatch') {
        return `  - ${m.file}: HASH MISMATCH\n    Expected: ${m.expected}\n    Actual:   ${m.actual}`;
      } else {
        return `  - ${m.file}: EXTRA FILE (not in manifest)`;
      }
    });
    
    return {
      name: 'manifest',
      status: 'fail',
      duration: Date.now() - start,
      message: `${result.mismatches.length} file(s) failed integrity check`,
      details,
    };
    
  } catch (error) {
    return {
      name: 'manifest',
      status: 'fail',
      duration: Date.now() - start,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Format manifest result for CLI output
 */
export function formatManifestResult(result: ManifestResult): string {
  const lines: string[] = [];
  
  if (result.valid) {
    lines.push('✅ All generated files match manifest');
  } else {
    lines.push('❌ Generated artifact integrity check failed:\n');
    
    for (const m of result.mismatches) {
      if (m.reason === 'missing') {
        lines.push(`  - ${m.file}: FILE MISSING`);
      } else if (m.reason === 'hash-mismatch') {
        lines.push(`  - ${m.file}: HASH MISMATCH`);
        lines.push(`    Expected: ${m.expected}`);
        lines.push(`    Actual:   ${m.actual}`);
      } else {
        lines.push(`  - ${m.file}: EXTRA FILE (not in manifest)`);
      }
    }
    
    lines.push('\n💡 Run `micro-contracts generate` to regenerate all artifacts.');
    lines.push('💡 Do NOT edit files in packages/ directly.');
  }
  
  return lines.join('\n');
}

