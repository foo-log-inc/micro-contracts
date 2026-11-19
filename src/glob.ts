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
 * The pattern is matched a `/`-separated segment at a time, each segment
 * against one name; a `**` segment stands for any number of directories.
 * A name beginning with `.` is matched only by a segment beginning with `.`.
 * Paths an `ignore` pattern matches are left out; an `ignore` pattern ending
 * in `/**` also leaves out the path it ends at, and that directory is not
 * entered.
 *
 * Symbolic links are listed. A link to a directory is listed where the
 * pattern matches it as a directory (`dir/**` matches `dir`), and entered where
 * a segment other than `**` matches it, and where a `**` that does not begin
 * the pattern ends at it (the rest of the pattern is matched inside, the `**`
 * is not continued there); a `**` that begins the pattern does not enter links.
 */
export function globFiles(pattern: string, options: { cwd?: string; ignore?: string[] } = {}): string[] {
  const cwd = options.cwd ?? process.cwd();
  const ignore = options.ignore ?? [];
  const ignoredDirs = ignore.filter(p => p.endsWith('/**')).map(p => p.slice(0, -3));
  const ignored = (file: string): boolean =>
    ignore.some(p => matchGlob(file, p)) || ignoredDirs.some(p => matchGlob(file, p));
  const segments = pattern.split('/');
  const end = segments.length;
  const matches = (name: string, segment: string): boolean =>
    (!name.startsWith('.') || segment.startsWith('.')) && matchGlob(name, segment);

  // The segments a path can stand before: a `**` may also match no directory.
  const close = (positions: number[]): number[] => {
    const closed = new Set<number>();
    for (let i of positions) {
      closed.add(i);
      while (segments[i] === '**') closed.add(++i);
    }
    return [...closed];
  };
  // Where the path stands once `name` is added to it.
  const advance = (positions: number[], name: string, linkedDir: boolean): number[] =>
    close(positions.flatMap(i => {
      if (i === end) return [];
      if (segments[i] === '**') {
        if (name.startsWith('.')) return [];
        return linkedDir ? (i > 0 ? [i + 1] : []) : [i];
      }
      return matches(name, segments[i]) ? [i + 1] : [];
    }));
  // Whether a file named `name` ends a path standing at `positions`: the last
  // segment matches it (a `**` before it may match no directory, a `**` after
  // it may not: that one matches a directory's contents).
  const endsAt = (positions: number[], name: string): boolean =>
    positions.some(i => i === end - 1 && (segments[i] === '**' ? !name.startsWith('.') : matches(name, segments[i])));

  const files: string[] = [];
  const walk = (dir: string, positions: number[]): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(cwd, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const file = dir ? `${dir}/${entry.name}` : entry.name;
      const linkedDir = entry.isSymbolicLink() && isDirectory(path.join(cwd, file));
      if (entry.isDirectory() || linkedDir) {
        const next = advance(positions, entry.name, linkedDir);
        if (next.some(i => i < end) && !ignoredDirs.some(p => matchGlob(file, p))) walk(file, next);
      }
      const listed = entry.isDirectory() ? false
        : linkedDir ? advance(positions, entry.name, false).includes(end)
        : endsAt(positions, entry.name);
      if (listed && !ignored(file)) files.push(file);
    }
  };
  walk('', close([0]));

  return files.sort();
}

function isDirectory(file: string): boolean {
  try {
    return fs.statSync(file).isDirectory();
  } catch {
    return false;
  }
}
