/**
 * micro-contracts Generator
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import type {
  OpenAPISpec,
  OperationObject,
  HttpMethod,
  GeneratorConfig,
  MultiModuleConfig,
  ResolvedModuleConfig,
  DependencyRef,
} from '../types.js';
import {
  isMultiModuleConfig,
  resolveModuleConfig,
  validateConfigKeys,
  resolveOperation,
} from '../types.js';
import { generateTypes, operationTypeNames } from './typeGenerator.js';
import { generateSchemas } from './schemaGenerator.js';
import { generateServiceInterfaces } from './serviceGenerator.js';
import { lintSpec, formatLintResults } from './linter.js';
import { 
  processOverlays, 
  generateExtensionInterfaces,
  formatOverlayLog,
  type OverlayResult,
} from './overlayProcessor.js';
import { loadOpenAPISpec } from './specLoader.js';
import {
  buildTemplateContext,
  renderTemplate,
} from './templateProcessor.js';
import { validateDependsOn } from './dependencyGenerator.js';
import { matchGlob } from '../glob.js';
import { extractDependencies, collectReachableComponents } from '../types.js';

export { generateTypes } from './typeGenerator.js';
export { generateSchemas } from './schemaGenerator.js';
export { generateServiceInterfaces } from './serviceGenerator.js';
export { lintSpec, formatLintResults } from './linter.js';
export { processOverlays, generateExtensionInterfaces } from './overlayProcessor.js';
export { buildTemplateContext, renderTemplate } from './templateProcessor.js';
export type { ScreenContext, ScreenLink, ScreenAction, ScreenInteraction, TemplateContext } from './templateProcessor.js';
export { collectInputFiles, computeInputHash } from './inputHash.js';
export { loadOpenAPISpec } from './specLoader.js';

/**
 * Write file only if content has changed (ignoring timestamp in header).
 * This prevents unnecessary git diffs when only the timestamp changes.
 * Returns true if file was written, false if content was unchanged.
 */
function writeFileIfChanged(filePath: string, newContent: string): boolean {
  // Resolve to absolute path for consistency
  const absolutePath = path.resolve(filePath);
  if (fs.existsSync(absolutePath)) {
    const existingContent = fs.readFileSync(absolutePath, 'utf-8');
    if (existingContent === newContent) {
      return false; // No change, skip writing
    }
  }
  // Creating the parent directory belongs to the write itself: no caller may
  // mkdir an output path, or a file path ends up existing as a directory.
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, newContent);
  return true;
}

/**
 * Write file and log result. Uses writeFileIfChanged to avoid unnecessary updates.
 */
function writeAndLog(filePath: string, content: string, indent = '    '): void {
  const written = writeFileIfChanged(filePath, content);
  if (written) {
    console.log(`${indent}Written: ${filePath}`);
  } else {
    console.log(`${indent}Unchanged: ${filePath}`);
  }
}

export interface GenerateOptions {
  /** Generate contract package only */
  contractsOnly?: boolean;
  /** Generate server routes only */
  serverOnly?: boolean;
  /** Generate frontend clients only */
  frontendOnly?: boolean;
  /** Skip linting */
  skipLint?: boolean;
  /** Filter to specific modules (comma-separated or array) */
  modules?: string | string[];
  /** Filter to specific outputs by id (comma-separated or array, glob patterns allowed) */
  outputs?: string | string[];
}

/**
 * Config file names, in the order they are looked for.
 */
const CONFIG_FILENAMES = [
  'micro-contracts.config.yaml',
  'micro-contracts.config.yml',
  'api-framework.config.yaml',
  'api-framework.config.yml',
];

/**
 * The project's config file, if one is present in the working directory.
 *
 * Everything that needs the project's spec list — generation and the guardrail
 * checks alike — resolves it from here, so no consumer has to guess where the
 * specs live.
 */
export function findConfigFile(): string | null {
  for (const candidate of CONFIG_FILENAMES) {
    const configPath = path.resolve(candidate);
    if (fs.existsSync(configPath)) return configPath;
  }
  return null;
}

/**
 * Load config from file (supports both legacy and multi-module formats)
 */
export function loadConfig(configPath: string): MultiModuleConfig | GeneratorConfig {
  const content = fs.readFileSync(configPath, 'utf-8');
  const config = yaml.load(content) as MultiModuleConfig | GeneratorConfig;
  if (isMultiModuleConfig(config)) {
    validateConfigKeys(config);
  }
  return config;
}

/**
 * The module of the project config whose spec is `specPath`, if one is.
 *
 * A spec linted on its own is checked under the rules of its module, as
 * generation checks it: a screen spec is not linted as a service API.
 */
export function findSpecModule(specPath: string): ResolvedModuleConfig | undefined {
  const configPath = findConfigFile();
  if (!configPath) return undefined;

  const config = loadConfig(configPath);
  if (!isMultiModuleConfig(config)) return undefined;

  const target = path.resolve(specPath);
  for (const [moduleName, moduleConfig] of Object.entries(config.modules)) {
    if (path.resolve(path.dirname(configPath), moduleConfig.openapi) === target) {
      return resolveModuleConfig(moduleName, moduleConfig, config.defaults);
    }
  }
  return undefined;
}

/**
 * Parse module filter from options
 */
function parseListOption(value?: string | string[]): string[] | null {
  if (!value) return null;
  const items = Array.isArray(value) ? value : value.split(',').map(v => v.trim());
  const filtered = items.filter(Boolean);
  return filtered.length > 0 ? filtered : null;
}

/**
 * Generate all files from config
 */
export async function generate(
  config: MultiModuleConfig | GeneratorConfig,
  options: GenerateOptions = {}
): Promise<void> {
  // Handle multi-module config
  if (isMultiModuleConfig(config)) {
    await generateMultiModule(config, options);
    return;
  }
  
  // Legacy single-module config is no longer supported
  throw new Error(
    'Legacy single-module configuration format is no longer supported. ' +
    'Please migrate to the multi-module format with a "modules:" section. ' +
    'See README.md for configuration examples.'
  );
}

/**
 * Every location a full generation run writes to: each module's contract and
 * published contract directories, its outputs, and its built-in server and
 * frontend files.
 */
export function configuredOutputs(config: MultiModuleConfig): string[] {
  return Object.entries(config.modules).flatMap(([moduleName, moduleConfig]) => {
    const resolved = resolveModuleConfig(moduleName, moduleConfig, config.defaults);
    return [
      resolved.contractOutput,
      resolved.contractPublicOutput,
      ...resolved.outputs.filter(output => output.enabled).map(output => output.output),
      ...(resolved.server ? [resolved.server.output] : []),
      ...(resolved.frontend
        ? [path.join(resolved.frontend.output, resolved.frontend.client), path.join(resolved.frontend.output, resolved.frontend.service)]
        : []),
    ];
  });
}

/**
 * Generate for multi-module config
 */
async function generateMultiModule(
  config: MultiModuleConfig,
  options: GenerateOptions
): Promise<void> {
  const moduleFilter = parseListOption(options.modules);
  const moduleNames = Object.keys(config.modules);
  
  // Filter modules if specified
  const targetModules = moduleFilter 
    ? moduleNames.filter(m => moduleFilter.includes(m))
    : moduleNames;
  
  if (targetModules.length === 0) {
    if (moduleFilter) {
      console.error(`No matching modules found. Available: ${moduleNames.join(', ')}`);
      process.exit(1);
    }
    console.log('No modules defined in config.');
    return;
  }
  
  console.log(`Generating for modules: ${targetModules.join(', ')}`);

  // Resolve every declared module, not just the targeted ones: cross-module
  // deps/ re-exports need the output directories of their dependency targets.
  const resolvedModules = new Map<string, ResolvedModuleConfig>();
  for (const moduleName of moduleNames) {
    resolvedModules.set(
      moduleName,
      resolveModuleConfig(moduleName, config.modules[moduleName], config.defaults)
    );
  }

  // Generate each module
  for (const moduleName of targetModules) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Module: ${moduleName}`);
    console.log(`${'='.repeat(60)}`);

    await generateModule(resolvedModules.get(moduleName)!, options, resolvedModules);
  }
  
  console.log('\nGeneration complete!');
}

/**
 * Generate for a single resolved module
 */
async function generateModule(
  config: ResolvedModuleConfig,
  options: GenerateOptions,
  resolvedModules: Map<string, ResolvedModuleConfig>
): Promise<void> {
  // Load OpenAPI spec
  const openapiPath = path.resolve(config.openapi);
  console.log(`Loading OpenAPI spec from: ${openapiPath}`);
  
  if (!fs.existsSync(openapiPath)) {
    throw new Error(`OpenAPI spec not found: ${openapiPath}`);
  }
  
  let spec = loadOpenAPISpec(openapiPath);
  console.log(`  Title: ${spec.info.title}`);
  console.log(`  Version: ${spec.info.version}`);

  // Run linting first (unless skipped)
  if (!options.skipLint) {
    console.log('\nLinting OpenAPI spec...');
    const lintResult = lintSpec(spec, { screen: config.screen });
    console.log(formatLintResults(lintResult));
    
    if (!lintResult.valid) {
      throw new Error('Lint failed. Fix errors before generating.');
    }
  }

  // Apply overlays if configured
  let overlayResult: OverlayResult | null = null;
  if (config.overlays.length > 0) {
    console.log('\nApplying overlays...');
    overlayResult = processOverlays(
      spec,
      {
        collision: config.overlayCollision,
        files: config.overlays,
      },
      process.cwd()
    );
    spec = overlayResult.spec;
    console.log(formatOverlayLog(overlayResult));
    // Note: Transformed spec is written to packages/contract/*/docs/openapi.generated.yaml
  }

  const generateAll = !options.contractsOnly && !options.serverOnly &&
                      !options.frontendOnly;

  // Validate and generate dependencies
  const dependencies = extractDependencies(spec);
  if (config.dependsOn) {
    const validation = validateDependsOn(
      dependencies.allDeps.map(d => d.raw),
      config.dependsOn,
      config.name
    );
    if (!validation.valid) {
      for (const err of validation.errors) {
        console.error(`ERROR: ${err}`);
      }
      throw new Error('Dependency validation failed');
    }
  }

  // Generate contract package
  if (generateAll || options.contractsOnly) {
    await generateContractPackage(spec, config, false, overlayResult);
    
    // Generate public contract if there are public endpoints
    if (hasPublicEndpoints(spec)) {
      await generateContractPackage(spec, config, true, overlayResult);
    }
    
    // Generate deps/ re-exports if module has dependencies
    if (dependencies.allDeps.length > 0) {
      await generateDepsReExports(config, dependencies, resolvedModules);
    }
  }

  // Generate using new outputs system if configured
  if (config.outputs.length > 0) {
    await generateFromOutputs(spec, config, overlayResult, options);
  } else {
    // Fallback to legacy server/frontend generation
    // Generate server routes
    if ((generateAll || options.serverOnly) && config.server) {
      await generateServerRoutes(spec, config, overlayResult);
    }

    // Generate frontend clients
    if ((generateAll || options.frontendOnly) && config.frontend) {
      await generateFrontendClient(spec, config, overlayResult);
    }
  }

  // Documentation (Redoc HTML) generation removed.
  // Use @redocly/cli directly if needed:
  //   npx @redocly/cli build-docs openapi.generated.yaml -o api-reference.html
}

/**
 * Check if spec has any public endpoints
 */
function hasPublicEndpoints(spec: OpenAPISpec): boolean {
  for (const pathItem of Object.values(spec.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (operation?.['x-micro-contracts-published'] === true) {
        return true;
      }
    }
  }
  return false;
}

/** True when some operation of the spec answers with a stream. */
function hasStreamOperations(spec: OpenAPISpec): boolean {
  return Object.entries(spec.paths).some(([apiPath, pathItem]) =>
    (['get', 'post', 'put', 'patch', 'delete'] as const).some(method =>
      pathItem[method] !== undefined && resolveOperation(spec, apiPath, method).success.body?.kind === 'stream'
    )
  );
}

/**
 * Generate contract package
 */
async function generateContractPackage(
  spec: OpenAPISpec,
  config: ResolvedModuleConfig,
  publicOnly: boolean,
  overlayResult: OverlayResult | null = null
): Promise<void> {
  const outputDir = publicOnly ? config.contractPublicOutput : config.contractOutput;
  const label = publicOnly ? 'public contract' : 'contract';
  
  console.log(`\nGenerating ${label} package...`);
  
  // For public contract, use filtered spec
  const targetSpec = publicOnly ? filterPublicSpec(spec) : spec;

  // Note: We no longer delete files before generating to enable change detection.
  // Orphaned files from removed services/schemas should be manually cleaned up.
  
  // Generate service interfaces
  console.log(`  Generating service interfaces...`);
  const serviceInterfaces = generateServiceInterfaces(targetSpec, {
    publicOnly,
    serviceTemplate: config.serviceTemplate,
  });
  for (const [name, content] of serviceInterfaces) {
    const fileName = name === 'index' ? 'index.ts' : `${name}ServiceApi.ts`;
    const filePath = path.join(outputDir, 'services', fileName);
    writeAndLog(filePath, content);
  }
  
  // Generate types (use filtered spec for public)
  console.log(`  Generating schema types...`);
  const typesContent = generateTypes(targetSpec);
  const typesPath = path.join(outputDir, 'schemas', 'types.ts');
  writeAndLog(typesPath, typesContent);
  
  // Generate validators (JSON Schemas) - use filtered spec for public
  console.log(`  Generating validators...`);
  const validatorsContent = generateSchemas(targetSpec);
  const validatorsPath = path.join(outputDir, 'schemas', 'validators.ts');
  writeAndLog(validatorsPath, validatorsContent);
  
  // Generate schemas index
  const schemasIndex = `/**
 * Schema exports
 * Auto-generated - DO NOT EDIT
 */

export * from './types.js';
export { allSchemas } from './validators.js';
`;
  writeAndLog(path.join(outputDir, 'schemas', 'index.ts'), schemasIndex);
  
  // Generate errors
  const hasEndpoints = Object.keys(targetSpec.paths).length > 0;
  console.log(`  Generating error types...`);
  const errorsContent = hasEndpoints ? generateErrors() : generateEmptyErrors();
  writeAndLog(path.join(outputDir, 'errors', 'index.ts'), errorsContent);

  // Generate the reading of HTTP requests the routes share
  if (hasEndpoints) {
    writeAndLog(path.join(outputDir, 'http', 'index.ts'), generateHttp());
  }

  // Generate the stream framing, for a module whose operations stream
  const hasStreams = hasStreamOperations(targetSpec);
  if (hasStreams) {
    console.log(`  Generating stream framing...`);
    writeAndLog(path.join(outputDir, 'streams', 'index.ts'), generateStreams());
  }
  
  // Generate overlay interfaces if overlays were applied
  if (overlayResult && overlayResult.extensionInfo.size > 0 && !publicOnly) {
    console.log(`  Generating overlay interfaces...`);
    const overlaysDir = path.join(outputDir, 'overlays');
    const overlayContent = generateExtensionInterfaces(overlayResult.extensionInfo);
    const overlayPath = path.join(overlaysDir, 'index.ts');
    writeAndLog(overlayPath, overlayContent);
  }
  
  // Generate package index
  const hasOverlays = overlayResult && overlayResult.extensionInfo.size > 0 && !publicOnly;
  const indexContent = `/**
 * ${publicOnly ? 'Public ' : ''}Contract Package
 * Auto-generated - DO NOT EDIT
 */

export * from './services/index.js';
export * from './schemas/index.js';
export * from './errors/index.js';
${hasEndpoints ? "export * from './http/index.js';\n" : ''}${hasOverlays ? "export * from './overlays/index.js';" : ''}${hasStreams ? "\nexport * from './streams/index.js';" : ''}
`;
  writeAndLog(path.join(outputDir, 'index.ts'), indexContent);
  
  // Copy OpenAPI spec to docs with source info header. The loaded spec holds
  // every component it references, so the copy stands on its own.
  const docsDir = path.join(outputDir, 'docs');

  const specHeader = `# Auto-generated OpenAPI specification
# DO NOT EDIT MANUALLY
# 
# Source: ${config.openapi}
# Regenerate: micro-contracts generate
${publicOnly ? '# Filtered for public endpoints only\n' : ''}
`;
  const yamlContent = specHeader + yaml.dump(targetSpec, { lineWidth: -1 });
  writeAndLog(path.join(docsDir, 'openapi.generated.yaml'), yamlContent);
}

/**
 * Generate using flexible outputs configuration
 */
async function generateFromOutputs(
  spec: OpenAPISpec,
  config: ResolvedModuleConfig,
  overlayResult: OverlayResult | null,
  options: GenerateOptions
): Promise<void> {
  // The built-in server/frontend sections and the outputs system are separate
  // config surfaces: an output is not "a server output" or "a frontend output",
  // it is a template rendered to a path. Select outputs with --output.
  if (options.serverOnly || options.frontendOnly) {
    const flag = options.serverOnly ? '--server-only' : '--frontend-only';
    throw new Error(
      `${flag} does not apply to an outputs configuration. ` +
      `Select outputs with --output <ids> (comma-separated, glob patterns allowed). ` +
      `Configured outputs: ${config.outputs.map(o => o.id).join(', ')}.`
    );
  }

  if (options.contractsOnly) return;

  console.log(`\nGenerating from outputs configuration...`);

  const patterns = parseListOption(options.outputs);
  const hasPublic = hasPublicEndpoints(spec);
  let selected = 0;

  for (const output of config.outputs) {
    // Skip disabled outputs
    if (!output.enabled) continue;
    
    // Check conditions
    if (output.condition === 'hasPublicEndpoints' && !hasPublic) {
      console.log(`  Skipping ${output.id} (no public endpoints)`);
      continue;
    }
    
    const hasOverlays = overlayResult && overlayResult.extensionInfo.size > 0;
    if (output.condition === 'hasOverlays' && !hasOverlays) {
      console.log(`  Skipping ${output.id} (no overlays)`);
      continue;
    }
    
    if (patterns && !patterns.some(pattern => matchGlob(output.id, pattern))) {
      console.log(`  Skipping ${output.id} (not selected by --output)`);
      continue;
    }

    selected++;

    // Check if file exists and overwrite is disabled
    if (!output.overwrite && fs.existsSync(output.output)) {
      console.log(`  Skipping ${output.id} (file exists, overwrite=false)`);
      continue;
    }
    
    console.log(`  Generating ${output.id}...`);

    // Build template context with output-specific config
    // Expand {module} placeholders in config values
    const expandPlaceholder = (val: string | undefined, fallback: string) =>
      (val?.replace(/{module}/g, config.name) ?? fallback);

    // An output under hasPublicEndpoints exists for the published contract, and
    // is rendered over what that contract carries: its operations and schemas.
    const renderedSpec = output.condition === 'hasPublicEndpoints' ? filterPublicSpec(spec) : spec;
    const templateContext = buildTemplateContext(renderedSpec, config.name, {
      servicesPath: expandPlaceholder(output.config?.servicesPath as string | undefined, `fastify.services.${config.name}`),
      contractPackage: expandPlaceholder(output.config?.contractPackage as string | undefined, `@project/contract/${config.name}`),
      extensionInfo: overlayResult?.extensionInfo,
      appliedOverlays: overlayResult?.appliedOverlays,
      screen: config.screen,
    });

    // Add output-specific config to context
    const extendedContext = {
      ...templateContext,
      outputConfig: output.config || {},
    };

    // Failures propagate: a template that cannot be found, parsed or rendered
    // leaves the previous generated file in place, so the run must not succeed.
    const content = renderTemplate(output.template, extendedContext, `output '${output.id}'`);

    // Write output file (only if content changed)
    writeAndLog(output.output, content);
  }

  if (selected === 0) {
    throw new Error(
      (patterns ? `--output ${patterns.join(',')} matched no output` : 'No outputs to generate') +
      ` for module '${config.name}'. Configured outputs: ` +
      `${config.outputs.map(o => o.id).join(', ') || '(none)'}.`
    );
  }
}

/**
 * Generate deps/ re-exports for cross-module dependencies
 */
async function generateDepsReExports(
  config: ResolvedModuleConfig,
  dependencies: ReturnType<typeof extractDependencies>,
  resolvedModules: Map<string, ResolvedModuleConfig>
): Promise<void> {
  if (dependencies.allDeps.length === 0) {
    console.log(`\n  No dependencies declared, skipping deps/ generation`);
    return;
  }

  console.log(`\nGenerating deps/ re-exports...`);

  const depsDir = path.join(config.contractOutput, 'deps');

  // Group deps by target module
  const depsByModule = new Map<string, DependencyRef[]>();
  for (const dep of dependencies.allDeps) {
    if (!depsByModule.has(dep.module)) {
      depsByModule.set(dep.module, []);
    }
    depsByModule.get(dep.module)!.push(dep);
  }

  for (const [targetModule, deps] of depsByModule) {
    const target = resolvedModules.get(targetModule);
    if (!target) {
      throw new Error(
        `Module '${config.name}' depends on '${targetModule}' ` +
        `(${deps.map(d => d.raw).join(', ')}) but '${targetModule}' is not defined in the config.`
      );
    }

    const importPrefix = relativeImportPath(depsDir, target.contractPublicOutput);
    const exported = declaredDependencyTypes(config.name, targetModule, deps, target);

    const content = `/**
 * Auto-generated from x-micro-contracts-depend-on - DO NOT EDIT
 * Source module: ${config.name}
 * Target module: ${targetModule}
 * Dependencies: ${deps.map(d => d.raw).join(', ')}
 */

// Types reached by the declared dependencies of ${targetModule} (contract-published)
export type {
${exported.map(name => `  ${name},`).join('\n')}
} from '${importPrefix}/schemas/types.js';
`;

    writeAndLog(path.join(depsDir, `${targetModule}.ts`), content, '  ');
  }

  const indexContent = `/**
 * Auto-generated deps index - DO NOT EDIT
 */

${Array.from(depsByModule.keys()).map(m => `export * from './${m}.js';`).join('\n')}
`;
  writeAndLog(path.join(depsDir, 'index.ts'), indexContent, '  ');
}

/**
 * Type names a module may use through its declared dependencies.
 *
 * Only what the declared operations reach: re-exporting the target's whole
 * published contract would hand over every type it has, which is not what
 * declaring `{module}.{service}.{method}` asks for.
 */
function declaredDependencyTypes(
  sourceModule: string,
  targetModule: string,
  deps: DependencyRef[],
  target: ResolvedModuleConfig
): string[] {
  const targetSpec = loadOpenAPISpec(path.resolve(target.openapi));
  const names = new Set<string>();

  for (const dep of deps) {
    const found = findOperation(targetSpec, dep.service, dep.method);

    if (!found) {
      throw new Error(
        `Module '${sourceModule}' depends on '${dep.raw}' but module '${targetModule}' ` +
        `has no operation with x-micro-contracts-service '${dep.service}' ` +
        `and x-micro-contracts-method '${dep.method}'.`
      );
    }

    // deps/ re-exports from contract-published, which only carries published
    // operations: depending on an unpublished one cannot resolve.
    const { apiPath, method, operation } = found;
    if (operation['x-micro-contracts-published'] !== true) {
      throw new Error(
        `Module '${sourceModule}' depends on '${dep.raw}' but that operation is not ` +
        `x-micro-contracts-published, so it is absent from the published contract of '${targetModule}'.`
      );
    }

    const resolved = resolveOperation(targetSpec, apiPath, method);
    const typeNames = operationTypeNames(operation, resolved);
    names.add(typeNames.input);
    if (typeNames.params) names.add(typeNames.params);
    if (typeNames.body) names.add(typeNames.body);
    if (typeNames.response) names.add(typeNames.response);
    if (typeNames.event) names.add(typeNames.event);
    for (const { type } of typeNames.otherResponses) names.add(type);
    if (typeNames.clientInput) names.add(typeNames.clientInput.name);

    // Schemas the operation reaches, named in the published types.
    for (const pointer of collectReachableComponents(resolved, targetSpec)) {
      if (pointer.startsWith('schemas/')) {
        names.add(pointer.slice('schemas/'.length));
      }
    }
  }

  return [...names].sort();
}

/** The operation declaring this service and method, if the spec has one. */
function findOperation(
  spec: OpenAPISpec,
  service: string,
  method: string
): { apiPath: string; method: HttpMethod; operation: OperationObject } | undefined {
  for (const [apiPath, pathItem] of Object.entries(spec.paths)) {
    for (const httpMethod of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[httpMethod];
      if (
        operation?.['x-micro-contracts-service'] === service &&
        operation['x-micro-contracts-method'] === method
      ) {
        return { apiPath, method: httpMethod, operation };
      }
    }
  }
  return undefined;
}

/**
 * Module specifier for `to`, relative to a file inside `fromDir`.
 */
function relativeImportPath(fromDir: string, to: string): string {
  const relative = path.relative(path.resolve(fromDir), path.resolve(to))
    .split(path.sep)
    .join('/');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/**
 * Generate server routes
 */
async function generateServerRoutes(
  spec: OpenAPISpec,
  config: ResolvedModuleConfig,
  overlayResult: OverlayResult | null = null
): Promise<void> {
  if (!config.server) return;

  console.log(`\nGenerating server routes...`);

  // Template is required for server routes generation
  if (!config.server.template) {
    throw new Error('Server template is required. Please specify server.template in your config.');
  }

  const templateContext = buildTemplateContext(spec, config.name, {
    servicesPath: config.server.servicesPath,
    contractPackage: `@project/contract/${config.name}`,
    extensionInfo: overlayResult?.extensionInfo,
    appliedOverlays: overlayResult?.appliedOverlays,
    screen: config.screen,
  });
  const routesContent = renderTemplate(
    config.server.template,
    templateContext,
    `server routes of module '${config.name}'`
  );

  writeAndLog(config.server.output, routesContent, '  ');
}

/**
 * Generate frontend client
 */
async function generateFrontendClient(
  spec: OpenAPISpec,
  config: ResolvedModuleConfig,
  overlayResult: OverlayResult | null = null
): Promise<void> {
  if (!config.frontend) return;

  const outputDir = path.resolve(config.frontend.output);
  const clientFile = config.frontend.client;

  console.log(`\nGenerating frontend client...`);

  // Template is required for frontend client generation
  if (!config.frontend.template) {
    throw new Error('Frontend template is required. Please specify frontend.template in your config.');
  }
  
  const templateContext = buildTemplateContext(spec, config.name, {
    contractPackage: `@project/contract/${config.name}`,
    extensionInfo: overlayResult?.extensionInfo,
    appliedOverlays: overlayResult?.appliedOverlays,
    screen: config.screen,
  });
  const clientContent = renderTemplate(
    config.frontend.template,
    templateContext,
    `frontend client of module '${config.name}'`
  );
  
  const clientPath = path.join(outputDir, clientFile);
  writeAndLog(clientPath, clientContent, '  ');
  
  // Generate service re-exports
  const serviceContent = generateServiceReExports(config.name);
  const servicePath = path.join(outputDir, config.frontend.service);
  writeAndLog(servicePath, serviceContent, '  ');
}

/**
 * Generate service re-exports file
 */
function generateServiceReExports(moduleName: string): string {
  const lines: string[] = [];
  
  lines.push('/**');
  lines.push(' * Service re-exports');
  lines.push(' * Auto-generated - DO NOT EDIT');
  lines.push('');
  
  // Re-export API clients from api.generated
  lines.push('// API clients');
  lines.push("export * from './api.generated';");
  lines.push('');
  
  // Re-export types from contract package
  lines.push('// Contract types');
  lines.push(`export * from '@project/contract/${moduleName}/schemas';`);
  lines.push(`export * from '@project/contract/${moduleName}/services';`);
  lines.push(`export * from '@project/contract/${moduleName}/errors';`);
  lines.push('');
  
  return lines.join('\n');
}


/**
 * Generate error types
 */
function generateErrors(): string {
  return `/**
 * Error types
 * Auto-generated - DO NOT EDIT
 */

// Re-export ProblemDetails from schemas (RFC 9457)
export type { ProblemDetails, ValidationError } from '../schemas/types.js';
import type { ProblemDetails } from '../schemas/types.js';

/**
 * An error as a server answers it: its status, its message as the title, and
 * its code, in lower case, naming its type (\`/errors/<code>\`, or
 * \`/errors/error\` without one).
 */
export function toProblemDetails(error: { status: number; message: string; code?: string }): ProblemDetails {
  return {
    type: \`/errors/\${error.code?.toLowerCase() ?? 'error'}\`,
    title: error.message,
    status: error.status,
  };
}

/**
 * API Error wrapper
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: ProblemDetails,
    public readonly requestId?: string,
  ) {
    super(problem.title);
    this.name = 'ApiError';
  }

  get isValidationError(): boolean {
    return this.status === 400;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }
}
`;
}

/**
 * Generate the reading of HTTP requests that every route template shares, so
 * each reads a request the same way whichever server it runs on.
 */
function generateHttp(): string {
  return `/**
 * Reading HTTP requests
 * Auto-generated - DO NOT EDIT
 */

/**
 * The cookies of a request, by name: from a Cookie header (\`name=value; name=value\`),
 * or a list of \`name=value\` entries. Of two cookies with one name, the first is kept:
 * it is the more specific.
 */
export function parseCookies(cookie: string | string[] | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const pair of [cookie ?? []].flat().join('; ').split(';')) {
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator).trim();
    if (separator < 0 || !name || cookies.has(name)) continue;

    let value = pair.slice(separator + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, value);
    }
  }
  return cookies;
}
`;
}

/**
 * Generate the stream framing: how a stream response's events travel, encoded
 * by routes and decoded by clients from this one module.
 */
function generateStreams(): string {
  return `/**
 * Stream framing
 * Auto-generated - DO NOT EDIT
 *
 * A stream response sends each event as one frame: a server-sent event
 * (\`event: <name>\`, \`data: <json>\`, a blank line), or one JSON value per
 * line. Routes encode with encodeStream and clients decode with decodeStream.
 */

/** How a stream response frames its events */
export type StreamFormat = 'sse' | 'ndjson';

/** One event's frame: \`json\` is the event serialized, \`name\` the value naming its type. */
function encodeFrame(format: StreamFormat, json: string, name: string): string {
  if (format === 'ndjson') return \`\${json}\\n\`;
  if (/[\\r\\n]/.test(name)) {
    throw new Error(\`An event name cannot hold a line break: \${JSON.stringify(name)}\`);
  }
  return \`event: \${name}\\ndata: \${json}\\n\\n\`;
}

/**
 * The frames of a stream response, one per event. \`first\` is what \`events\`
 * yielded first: a route awaits it before sending anything, so a service that
 * fails at once fails as an ordinary error response. \`serialize\` writes an
 * event as the contract declares it and throws for one the contract does not;
 * \`discriminator\` is the property naming each event's type. \`events\` is
 * closed when every event is sent or one is refused. When the client goes
 * away, it is closed at its next yield: a service waiting between events keeps
 * running until it yields again.
 */
export async function* encodeStream<E extends object>(
  format: StreamFormat,
  first: IteratorResult<E>,
  events: AsyncIterator<E>,
  serialize: (event: Record<string, unknown>) => string,
  discriminator: string,
): AsyncGenerator<string> {
  try {
    for (let next = first; !next.done; next = await events.next()) {
      // An event is a JSON object: the serializer, and the frame's name, read its properties
      const event = next.value as Record<string, unknown>;
      yield encodeFrame(format, serialize(event), String(event[discriminator]));
    }
  } finally {
    await events.return?.();
  }
}

/**
 * The events of a stream response, from its text in order — chunks may split
 * anywhere. The \`data\` lines of a server-sent event join into one JSON
 * value; its other fields carry nothing the event does not.
 */
export async function* decodeStream<E>(format: StreamFormat, text: AsyncIterable<string>): AsyncGenerator<E> {
  let buffer = '';
  let data: string[] = [];
  for await (const chunk of text) {
    buffer += chunk;
    for (let end = buffer.indexOf('\\n'); end >= 0; end = buffer.indexOf('\\n')) {
      const line = buffer.slice(0, end).replace(/\\r$/, '');
      buffer = buffer.slice(end + 1);
      if (format === 'ndjson') {
        if (line.trim() !== '') yield JSON.parse(line) as E;
      } else if (line === '') {
        if (data.length > 0) yield JSON.parse(data.join('\\n')) as E;
        data = [];
      } else if (line.startsWith('data:')) {
        data.push(line.slice(line.startsWith('data: ') ? 6 : 5));
      }
    }
  }
  if (format === 'ndjson' && buffer.trim() !== '') yield JSON.parse(buffer) as E;
}
`;
}

/**
 * Generate empty error types (when no endpoints exist)
 */
function generateEmptyErrors(): string {
  return `/**
 * Error types
 * Auto-generated - DO NOT EDIT
 * 
 * No endpoints defined - error types not needed.
 */
`;
}

/**
 * Filter OpenAPI spec for public endpoints only
 */
function filterPublicSpec(spec: OpenAPISpec): OpenAPISpec {
  const filtered: OpenAPISpec = {
    ...spec,
    paths: {},
    tags: [],
    components: {},
  };

  // What the public operations reach from: themselves, and the parameters
  // their path items declare for every operation under them.
  const publicRoots: unknown[] = [];
  const usedTags = new Set<string>();

  // Filter paths to only include x-micro-contracts-published: true
  for (const [pathKey, pathItem] of Object.entries(spec.paths)) {
    const filteredPathItem: typeof pathItem = {};
    let hasPublicOperation = false;

    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const operation = pathItem[method];
      if (operation?.['x-micro-contracts-published'] === true) {
        filteredPathItem[method] = operation;
        hasPublicOperation = true;
        publicRoots.push(operation);

        for (const tag of operation.tags ?? []) {
          usedTags.add(tag);
        }
      }
    }

    if (hasPublicOperation) {
      if (pathItem.parameters) {
        filteredPathItem.parameters = pathItem.parameters;
        publicRoots.push(pathItem.parameters);
      }
      filtered.paths[pathKey] = filteredPathItem;
    }
  }

  // Keep exactly the components the public operations reach, in every section.
  // Copying a section wholesale left components that only private endpoints
  // used, referring to schemas this filter had dropped: a dangling $ref.
  const reachable = collectReachableComponents(publicRoots, spec);
  const sourceComponents = spec.components as Record<string, Record<string, unknown>> | undefined;
  const targetComponents = filtered.components as Record<string, Record<string, unknown>>;

  // Iterate the spec's own order, not the traversal order, so the published
  // document keeps the declaration order of its source.
  for (const [section, entries] of Object.entries(sourceComponents ?? {})) {
    if (!entries || typeof entries !== 'object') continue;

    for (const [name, component] of Object.entries(entries)) {
      if (!reachable.has(`${section}/${name}`)) continue;
      targetComponents[section] = targetComponents[section] ?? {};
      targetComponents[section][name] = component;
    }
  }

  // Filter tags to only include used ones
  if (spec.tags) {
    filtered.tags = spec.tags.filter(tag => usedTags.has(tag.name));
  }

  // Clean up empty sections
  for (const [section, entries] of Object.entries(filtered.components ?? {})) {
    if (entries && typeof entries === 'object' && Object.keys(entries).length === 0) {
      delete (filtered.components as Record<string, unknown>)[section];
    }
  }
  if (Object.keys(filtered.components ?? {}).length === 0) {
    delete filtered.components;
  }

  if (filtered.tags?.length === 0) {
    delete filtered.tags;
  }

  return filtered;
}

