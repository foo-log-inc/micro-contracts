/**
 * Glob matching.
 *
 * The single glob implementation: used for guardrail file allowlists, for
 * selecting outputs by id on the command line, and for listing the files a
 * pattern matches.
 */

import fs from 'fs';
import path from 'path';

/**
 * Simple glob pattern matching with negation support
 * Patterns are evaluated top-to-bottom; last match wins.
 * - "!pattern" → if matched, result becomes false (exclude)
 * - "pattern"  → if matched, result becomes true (include)
 */
export function matchWithNegation(patterns: string[] | undefined, file: string): boolean {
  if (!patterns || patterns.length === 0) return false;
  
  let matched = false;
  
  for (const raw of patterns) {
    const neg = raw.startsWith('!');
    const pattern = neg ? raw.slice(1) : raw;
    if (!pattern) continue;
    
    if (matchGlob(file, pattern)) {
      matched = !neg;
    }
  }
  
  return matched;
}

/**
 * Simple glob pattern matching
 * Supports:
 * - * matches any characters except /
 * - ** matches any characters including / (zero or more path segments)
 * - ? matches single character
 */
export function matchGlob(file: string, pattern: string): boolean {
  // Normalize paths
  const normalizedFile = file.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');
  
  return matchGlobInternal(normalizedFile, normalizedPattern);
}

/**
 * Internal glob matching implementation using regex
 */
function matchGlobInternal(file: string, pattern: string): boolean {
  // Convert glob pattern to regex step by step
  let regex = '';
  let i = 0;
  
  while (i < pattern.length) {
    const char = pattern[i];
    const nextChar = pattern[i + 1];
    
    if (char === '*' && nextChar === '*') {
      // ** - matches any path segments
      const afterStars = pattern[i + 2];
      
      if (afterStars === '/') {
        // **/ at start or middle - matches zero or more path segments including nothing
        regex += '(?:.*/)?';
        i += 3; // skip **/
      } else if (i + 2 === pattern.length || afterStars === undefined) {
        // ** at end - matches everything
        regex += '.*';
        i += 2;
      } else {
        // ** without trailing / - matches any characters
        regex += '.*';
        i += 2;
      }
    } else if (char === '*') {
      // * - matches any characters except /
      regex += '[^/]*';
      i++;
    } else if (char === '?') {
      // ? - matches single character except /
      regex += '[^/]';
      i++;
    } else if (char === '/') {
      regex += '/';
      i++;
    } else if ('.+^${}()|[]\\'.includes(char)) {
      // Escape regex special chars
      regex += '\\' + char;
      i++;
    } else {
      regex += char;
      i++;
    }
  }
  
  // Anchor the pattern
  regex = `^${regex}$`;
  
  try {
    return new RegExp(regex).test(file);
  } catch {
    return false;
  }
}

/**
 * The files under `cwd` that `pattern` matches, as `/`-separated paths
 * relative to `cwd`, sorted.
 *
 * Names beginning with `.` are not matched, files matched by an `ignore`
 * pattern are left out, and a directory an `ignore` pattern ending in `/**`
 * matches is not entered. Symbolic links are listed, not followed.
 */
export function globFiles(pattern: string, options: { cwd?: string; ignore?: string[] } = {}): string[] {
  const cwd = options.cwd ?? process.cwd();
  const ignore = options.ignore ?? [];
  const ignoredDirs = ignore.filter(p => p.endsWith('/**')).map(p => p.slice(0, -3));

  // Nothing outside the pattern's leading literal directories can match it.
  const segments = pattern.split('/');
  const firstWild = segments.findIndex(segment => /[*?]/.test(segment));
  const base = segments.slice(0, firstWild === -1 ? -1 : firstWild).join('/');

  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(cwd, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const file = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!ignoredDirs.some(p => matchGlob(file, p))) walk(file);
      } else if (matchGlob(file, pattern) && !ignore.some(p => matchGlob(file, p))) {
        files.push(file);
      }
    }
  };
  walk(base);

  return files.sort();
}
