/**
 * Reading OpenAPI documents from disk.
 *
 * A spec may reference components held in another file, such as
 * `../../_shared/openapi/problem-details.yaml#/components/responses/NotFound`.
 * Every generator reads a component by its local name, so each component reached
 * through such a reference is brought into the spec's own `components` here, and
 * the reference rewritten to `#/components/<section>/<name>`. After loading, a
 * spec references nothing outside itself.
 *
 * Reading only the name off the end of the reference instead binds it to
 * whatever the spec happens to define under that name, or to nothing at all.
 */

import fs from 'fs';
import path from 'path';
import { isDeepStrictEqual } from 'util';
import yaml from 'js-yaml';
import type { OpenAPISpec } from '../types.js';
import { parseComponentRef } from '../types.js';

/** Parse a YAML or JSON document. */
function readDocument(filePath: string): unknown {
  const content = fs.readFileSync(filePath, 'utf-8');

  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
    return yaml.load(content);
  } else if (filePath.endsWith('.json')) {
    return JSON.parse(content);
  }
  throw new Error(`Unsupported file format: ${filePath}`);
}

/** A path for messages: relative to the working directory, as the user wrote it. */
function display(filePath: string): string {
  return path.relative(process.cwd(), filePath) || filePath;
}

interface ImportedComponent {
  section: string;
  name: string;
  value: unknown;
  /** The reference the component was brought in through, for messages. */
  origin: string;
}

/**
 * Rewrites references into other files as local ones, collecting the components
 * they reach.
 */
class ExternalRefBundler {
  /** Every file read through a reference into another file. */
  readonly files = new Set<string>();

  private readonly documents = new Map<string, unknown>();
  /** `<file>#<pointer>` of every component already brought in (or being brought in). */
  private readonly reached = new Set<string>();
  /** Components brought in, keyed `<section>/<name>`. */
  private readonly imported = new Map<string, ImportedComponent>();

  /**
   * Copy `node` with every reference into another file rewritten as a local one.
   *
   * `file` is the file holding `node`. When `node` belongs to the spec being
   * loaded (`ownComponents`), its local references already name the spec's own
   * components; inside another file they name that file's components, which
   * are brought in as well.
   */
  bundle(node: unknown, file: string, ownComponents: boolean): unknown {
    if (Array.isArray(node)) {
      return node.map(item => this.bundle(item, file, ownComponents));
    }
    if (node === null || typeof node !== 'object') {
      return node;
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      result[key] = key === '$ref' && typeof value === 'string'
        ? this.rewrite(value, file, ownComponents)
        : this.bundle(value, file, ownComponents);
    }
    return result;
  }

  /**
   * Add the components brought in to `spec`. A name the spec already uses for
   * a different component is an error: either binding would be a silent guess.
   */
  mergeInto(spec: OpenAPISpec): void {
    for (const component of this.imported.values()) {
      const components = (spec.components ??= {}) as Record<string, Record<string, unknown>>;
      const section = (components[component.section] ??= {});
      const existing = section[component.name];

      if (existing === undefined) {
        section[component.name] = component.value;
      } else if (!isDeepStrictEqual(existing, component.value)) {
        throw new Error(
          `$ref '${component.origin}' brings in components.${component.section}.${component.name}, ` +
          `but the spec already defines a different components.${component.section}.${component.name}. ` +
          `Rename one of them.`
        );
      }
    }
  }

  private rewrite(ref: string, file: string, ownComponents: boolean): string {
    const hash = ref.indexOf('#');
    const filePart = hash < 0 ? ref : ref.slice(0, hash);
    const pointer = hash < 0 ? '' : ref.slice(hash + 1);

    if (!filePart && ownComponents) {
      return ref;
    }

    const targetFile = filePart ? path.resolve(path.dirname(file), filePart) : file;
    const localRef = `#${pointer}`;
    const parsed = parseComponentRef(localRef);
    if (parsed?.name === undefined) {
      throw new Error(
        `Unsupported $ref '${ref}' in ${display(file)}: a reference into another file must point at ` +
        `a component, #/components/<section>/<name>.`
      );
    }
    const section = parsed.section;
    const name = parsed.name;

    const key = `${targetFile}#${pointer}`;
    if (this.reached.has(key)) {
      return localRef;
    }
    this.reached.add(key);

    const document = this.read(targetFile, ref, file) as {
      components?: Record<string, Record<string, unknown> | undefined>;
    } | null;
    const component = document?.components?.[section]?.[name];
    if (component === undefined) {
      throw new Error(
        `$ref '${ref}' in ${display(file)} does not resolve: ` +
        `${display(targetFile)} has no components.${section}.${name}.`
      );
    }

    const value = this.bundle(component, targetFile, false);
    const origin = `${display(targetFile)}#${pointer}`;
    const existing = this.imported.get(`${section}/${name}`);

    if (!existing) {
      this.imported.set(`${section}/${name}`, { section, name, value, origin });
    } else if (!isDeepStrictEqual(existing.value, value)) {
      throw new Error(
        `$ref '${origin}' and '${existing.origin}' both bring in components.${section}.${name}, ` +
        `with different definitions. Rename one of them.`
      );
    }

    return localRef;
  }

  private read(targetFile: string, ref: string, file: string): unknown {
    if (!this.documents.has(targetFile)) {
      try {
        this.documents.set(targetFile, readDocument(targetFile));
      } catch (error) {
        throw new Error(
          `Cannot read $ref '${ref}' in ${display(file)}: ` +
          (error instanceof Error ? error.message : String(error))
        );
      }
      this.files.add(targetFile);
    }
    return this.documents.get(targetFile);
  }
}

/**
 * Load an OpenAPI spec, with every component it references in another file
 * brought into its own `components`.
 */
export function loadOpenAPISpec(filePath: string): OpenAPISpec {
  const file = path.resolve(filePath);
  const bundler = new ExternalRefBundler();
  const spec = bundler.bundle(readDocument(file), file, true) as OpenAPISpec;
  bundler.mergeInto(spec);
  return spec;
}

/**
 * Copy `value`, read from `file`, with every reference into another file
 * rewritten as a local one, adding the components they reach to `spec`.
 *
 * For content merged into a loaded spec from elsewhere, such as an overlay:
 * its references are relative to the file that holds it.
 */
export function bundleExternalRefs<T>(value: T, file: string, spec: OpenAPISpec): T {
  const bundler = new ExternalRefBundler();
  const result = bundler.bundle(value, path.resolve(file), true) as T;
  bundler.mergeInto(spec);
  return result;
}

/**
 * Every file `filePath` reaches through references into other files,
 * transitively: what loading it, or merging its content, reads.
 */
export function referencedFiles(filePath: string): string[] {
  const file = path.resolve(filePath);
  const bundler = new ExternalRefBundler();
  bundler.bundle(readDocument(file), file, true);
  return [...bundler.files];
}
