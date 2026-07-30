#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { createProgram, type CommandHandlers } from './generated/program.js';
import { generate, loadConfig, findConfigFile, loadOpenAPISpec, lintSpec, formatLintResults, computeInputHash } from './generator/index.js';
import type { GeneratorConfig, MultiModuleConfig } from './types.js';
import { isMultiModuleConfig } from './types.js';
import { getStarterTemplates, getScreenStarterTemplates } from './cli/templates.js';
import {
  runAllChecks,
  formatCheckResults,
  formatSingleCheckResult,
  formatCheckStart,
  formatCheckSummary,
  formatVerdict,
  getAvailableChecks,
  createGuardrailsConfig,
  generateManifest,
  writeManifest,
  canSkipGeneration,
  GATE_DESCRIPTIONS,
  loadGuardrailsConfigWithPath,
} from './guardrails/index.js';
import type { GateNumber, CheckResult, CheckDefinition } from './guardrails/index.js';
import { commandAuditOpenapi } from './commands/audit-openapi.js';
import { commandReviewPublished } from './commands/review-published.js';
import { commandProposeOverlays } from './commands/propose-overlays.js';
import { commandAuditGuardrails } from './commands/audit-guardrails.js';
import { commandInsights } from './commands/insights.js';
import { VERSION } from './version.js';

/**
 * True when the run generates only part of the configured output.
 *
 * A partial run must not stamp the manifest with the input hash: the hash says
 * these inputs have been generated from, and a later full run would skip,
 * leaving whatever this run did not generate permanently missing.
 */
function isPartialGeneration(opts: {
  module?: string;
  output?: string;
  contractsOnly?: boolean;
  serverOnly?: boolean;
  frontendOnly?: boolean;
}): boolean {
  return Boolean(
    opts.module ||
    opts.output ||
    opts.contractsOnly ||
    opts.serverOnly ||
    opts.frontendOnly
  );
}

const handlers: CommandHandlers = {

  // ── generate ──────────────────────────────────────────
  generate: async (opts) => {
    try {
      let config: MultiModuleConfig | GeneratorConfig;

      const configPath = opts.config
        ? path.resolve(opts.config)
        : findConfigFile();

      if (!configPath) {
        console.error('Error: No config file found.');
        console.error('Create micro-contracts.config.yaml or use --config <path>');
        process.exit(1);
      }

      if (!fs.existsSync(configPath)) {
        console.error(`Config file not found: ${configPath}`);
        process.exit(1);
      }

      console.log(`Using config: ${configPath}`);
      config = loadConfig(configPath);

      const useCache = opts.cache !== false && !opts.force;
      let inputHash: string | undefined;

      if (isMultiModuleConfig(config)) {
        inputHash = computeInputHash(config, configPath, VERSION);

        if (useCache) {
          const manifestDir = opts.manifestDir || 'packages/';
          const skipCheck = await canSkipGeneration(manifestDir, inputHash);
          if (skipCheck.skip) {
            console.log(`No input changes detected, skipping generation (${skipCheck.reason})`);
            return;
          }
        }
      }

      await generate(config, {
        contractsOnly: opts.contractsOnly,
        serverOnly: opts.serverOnly,
        frontendOnly: opts.frontendOnly,
        skipLint: opts.skipLint,
        modules: opts.module,
        outputs: opts.output,
      });

      if (opts.manifest !== false) {
        const { config: guardrailsConfig } = loadGuardrailsConfigWithPath();

        if (guardrailsConfig?.generated && guardrailsConfig.generated.length > 0) {
          const manifestDir = opts.manifestDir || 'packages/';
          if (fs.existsSync(manifestDir)) {
            const manifestInputHash =
              (opts.cache !== false && !isPartialGeneration(opts)) ? inputHash : undefined;
            const { manifest, changed } = await generateManifest(manifestDir, {
              generatorVersion: VERSION,
              inputHash: manifestInputHash,
            });
            const fileCount = Object.keys(manifest.files).length;

            if (changed) {
              const manifestPath = writeManifest(manifest, manifestDir);
              console.log(`\nManifest updated: ${manifestPath} (${fileCount} files)`);
            } else {
              console.log(`\nManifest unchanged (${fileCount} files)`);
            }
          }
        }
      }

    } catch (error) {
      console.error('Generation failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },

  // ── lint ───────────────────────────────────────────────
  lint: async (input) => {
    try {
      const specPath = path.resolve(input!);
      if (!fs.existsSync(specPath)) {
        console.error(`OpenAPI spec not found: ${specPath}`);
        process.exit(1);
      }

      console.log(`Linting: ${specPath}\n`);
      const spec = loadOpenAPISpec(specPath);
      const result = lintSpec(spec, { strict: false });

      console.log(formatLintResults(result));

      if (!result.valid) {
        process.exit(1);
      }
    } catch (error) {
      console.error('Lint failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },

  // ── init ───────────────────────────────────────────────
  init: async (name, opts) => {
    console.log(`Initializing module "${name}"${opts.screens ? ' (screen spec)' : ''}...\n`);

    const specDirs = [
      'spec',
      'spec/default/templates',
      'spec/_shared/openapi',
      'spec/_shared/overlays',
      `spec/${name}/openapi`,
    ];

    for (const dir of specDirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created: ${dir}/`);
      }
    }

    if (!opts.skipTemplates) {
      const starterTemplates = getStarterTemplates();
      for (const [filename, content] of Object.entries(starterTemplates)) {
        const templatePath = path.join('spec/default/templates', filename);
        if (!fs.existsSync(templatePath)) {
          fs.writeFileSync(templatePath, content);
          console.log(`Created: ${templatePath}`);
        }
      }

      if (opts.screens) {
        const screenTemplates = getScreenStarterTemplates();
        for (const [filename, content] of Object.entries(screenTemplates)) {
          const templatePath = path.join('spec/default/templates', filename);
          if (!fs.existsSync(templatePath)) {
            fs.writeFileSync(templatePath, content);
            console.log(`Created: ${templatePath}`);
          }
        }
      }
    }

    const problemDetailsPath = 'spec/_shared/openapi/problem-details.yaml';
    if (!fs.existsSync(problemDetailsPath)) {
      fs.writeFileSync(problemDetailsPath, generateProblemDetailsSchema());
      console.log(`Created: ${problemDetailsPath}`);
    }

    const spectralPath = 'spec/spectral.yaml';
    if (!fs.existsSync(spectralPath)) {
      fs.writeFileSync(spectralPath, generateSpectralRules());
      console.log(`Created: ${spectralPath}`);
    }

    if (opts.screens) {
      const screenSpecDir = `spec/${name}/openapi`;
      fs.mkdirSync(screenSpecDir, { recursive: true });
      const screenSpecPath = path.join(screenSpecDir, `${name}.yaml`);
      if (!fs.existsSync(screenSpecPath)) {
        fs.writeFileSync(screenSpecPath, generateScreenSpecTemplate(name!));
        console.log(`Created: ${screenSpecPath}`);
      }
    }

    const baseDir = path.resolve(opts.dir ?? 'src', name!);
    const dirs = [
      baseDir,
      path.join(baseDir, 'services'),
      path.join(baseDir, 'models'),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created: ${dir}/`);
      }
    }

    const files: [string, string][] = [
      [path.join(baseDir, 'db.ts'), generateDbTemplate()],
      [path.join(baseDir, 'container.ts'), generateContainerTemplate(name!)],
      [path.join(baseDir, 'services', 'index.ts'), '// Export service classes\n'],
      [path.join(baseDir, 'models', 'index.ts'), '// Export models\n'],
    ];

    for (const [filePath, content] of files) {
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content);
        console.log(`Created: ${filePath}`);
      }
    }

    const configPath = path.resolve('micro-contracts.config.yaml');
    if (!fs.existsSync(configPath)) {
      const configContent = opts.screens
        ? generateScreenConfigTemplate(name!)
        : generateConfigTemplate(name!);
      fs.writeFileSync(configPath, configContent);
      console.log(`Created: ${configPath}`);
    }

    if (opts.openapi) {
      const openapiPath = path.resolve(opts.openapi);
      if (!fs.existsSync(openapiPath)) {
        console.error(`OpenAPI file not found: ${openapiPath}`);
        process.exit(1);
      }

      const outputPath = opts.output
        ? path.resolve(opts.output)
        : path.resolve(`spec/${name}/openapi/${name}.yaml`);

      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      console.log(`\nProcessing OpenAPI: ${openapiPath}`);
      const processed = processOpenAPIWithExtensions(openapiPath);
      fs.writeFileSync(outputPath, processed.yaml);
      console.log(`Created: ${outputPath}`);
      console.log(`  - Added x-micro-contracts-service to ${processed.stats.servicesAdded} operations`);
      console.log(`  - Added x-micro-contracts-method to ${processed.stats.methodsAdded} operations`);
      if (processed.stats.services.length > 0) {
        console.log(`  - Detected services: ${processed.stats.services.join(', ')}`);
      }
    }

    console.log(`\nModule "${name}" initialized!`);

    if (opts.screens) {
      console.log(`\nNext steps:`);
      console.log(`  1. Edit spec/${name}/openapi/${name}.yaml with your screen definitions`);
      console.log(`  2. Define ViewModels in components/schemas`);
      console.log(`  3. Add navigation links and x-events`);
      console.log(`  4. Run: npx micro-contracts generate`);
    } else if (!opts.openapi) {
      console.log(`\nNext steps:`);
      console.log(`  1. Create spec/${name}/openapi/${name}.yaml with your API spec`);
      console.log(`  2. Add x-micro-contracts-service and x-micro-contracts-method to operations`);
      console.log(`  3. Run: npx micro-contracts generate`);
      console.log(`\nTip: Use --openapi to auto-add extensions:`);
      console.log(`  npx micro-contracts init ${name} --openapi path/to/spec.yaml`);
    } else {
      console.log(`\nNext steps:`);
      console.log(`  1. Review the generated extensions in spec/${name}/openapi/${name}.yaml`);
      console.log(`  2. Run: npx micro-contracts generate`);
    }
  },

  // ── check ─────────────────────────────────────────────
  check: async (opts) => {
    try {
      if (opts.listGates) {
        console.log('\nAvailable gates:\n');
        for (const [gate, description] of Object.entries(GATE_DESCRIPTIONS)) {
          console.log(`  Gate ${gate}: ${description}`);
        }
        console.log('\nUsage: micro-contracts check --gate 1,2,3');
        console.log('');
        return;
      }

      if (opts.list) {
        console.log('\nAvailable checks:\n');
        for (const check of getAvailableChecks({ guardrailsPath: opts.guardrails })) {
          const gateStr = check.gate !== undefined ? `[G${check.gate}]` : '    ';
          console.log(`  ${gateStr} ${check.name.padEnd(20)} - ${check.description}`);
        }
        console.log('');
        return;
      }

      let gates: GateNumber[] | undefined;
      if (opts.gate) {
        gates = opts.gate.split(',').map((s: string) => {
          const num = parseInt(s.trim(), 10);
          if (num < 1 || num > 5 || isNaN(num)) {
            throw new Error(`Invalid gate number: ${s}. Must be 1-5.`);
          }
          return num as GateNumber;
        });
      }

      console.log('');
      console.log('🔍 AI Guardrail Check Results');
      console.log('═'.repeat(50));
      console.log('');

      const isStreaming = process.stdout.isTTY !== false;

      const checkOptions = {
        only: opts.only?.split(',').map((s: string) => s.trim()),
        skip: opts.skip?.split(',').map((s: string) => s.trim()),
        gates,
        verbose: opts.verbose,
        fix: opts.fix,
        guardrailsPath: opts.guardrails,
        generatedDir: opts.generatedDir,
        changedFilesPath: opts.changedFiles,
        onCheckStart: isStreaming ? (check: CheckDefinition) => {
          if (process.stdout.isTTY) {
            process.stdout.write(formatCheckStart(check) + '\r');
          }
        } : undefined,
        onCheckComplete: isStreaming ? (result: CheckResult, check: CheckDefinition) => {
          if (process.stdout.isTTY) {
            process.stdout.clearLine?.(0);
            process.stdout.cursorTo?.(0);
          }
          console.log(formatSingleCheckResult(result, check, opts.verbose));
        } : undefined,
      };

      const summary = await runAllChecks(checkOptions);

      if (isStreaming) {
        console.log(formatCheckSummary(summary, summary.checks));
      } else {
        console.log(formatCheckResults(summary, opts.verbose, summary.checks));
      }

      if (summary.failed > 0) {
        process.exit(1);
      }

    } catch (error) {
      console.error('Check failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },

  // ── pipeline ──────────────────────────────────────────
  pipeline: async (opts) => {
    try {
      const startTime = Date.now();
      const verbose = opts.verbose;
      let hasFailure = false;
      let generatePassed = false;
      let generateDuration = 0;
      let generateSkipped = false;
      let generateError: string | null = null;

      const allResults: CheckResult[] = [];

      console.log('');
      console.log('🚀 Running AI Guardrails Pipeline');
      console.log('═'.repeat(50));
      console.log('');

      const skipChecks = opts.skip?.split(',').map((s: string) => s.trim()) || [];

      const isStreaming = process.stdout.isTTY !== false;
      const baseCheckOptions = {
        verbose,
        skip: skipChecks,
        guardrailsPath: opts.guardrails,
        generatedDir: opts.generatedDir,
        onCheckStart: isStreaming ? (check: CheckDefinition) => {
          if (process.stdout.isTTY) {
            process.stdout.write(formatCheckStart(check) + '\r');
          }
        } : undefined,
        onCheckComplete: isStreaming ? (result: CheckResult, check: CheckDefinition) => {
          if (process.stdout.isTTY) {
            process.stdout.clearLine?.(0);
            process.stdout.cursorTo?.(0);
          }
          console.log(formatSingleCheckResult(result, check, verbose));
        } : undefined,
      };

      // Step 1: Gate 1,2
      if (verbose) {
        console.log('┌─────────────────────────────────────────────────┐');
        console.log('│ Step 1: Pre-generation checks (Gate 1, 2)       │');
        console.log('└─────────────────────────────────────────────────┘');
        console.log('');
      }

      const gate12Summary = await runAllChecks({ ...baseCheckOptions, gates: [1, 2] });
      allResults.push(...gate12Summary.results);

      if (verbose) console.log(formatCheckSummary(gate12Summary, gate12Summary.checks));

      if (gate12Summary.failed > 0) {
        hasFailure = true;
        if (!opts.continueOnError) {
          console.log('');
          console.log('❌ Gate 1,2 failed. Stopping pipeline.');
          console.log('   Use --continue-on-error to continue despite failures.');
          process.exit(1);
        }
        if (verbose) console.log('⚠️  Gate 1,2 had failures. Continuing due to --continue-on-error.\n');
      }

      // Step 2: Generate
      let generationCacheSkipped = false;

      if (verbose) {
        console.log('┌─────────────────────────────────────────────────┐');
        console.log('│ Step 2: Generate contracts                      │');
        console.log('└─────────────────────────────────────────────────┘');
        console.log('');
      }

      const generateStartTime = Date.now();

      if (isStreaming && process.stdout.isTTY) {
        process.stdout.write('  ⋯ Generate              running...\r');
      }

      try {
        const configPath = opts.config ? path.resolve(opts.config) : findConfigFile();

        if (!configPath) {
          generateSkipped = true;
          generateDuration = Date.now() - generateStartTime;
          if (isStreaming && process.stdout.isTTY) {
            process.stdout.clearLine?.(0);
            process.stdout.cursorTo?.(0);
          }
          console.log('  ○ Generate              SKIP (no config file)');
        } else {
          if (verbose) console.log(`  Using config: ${configPath}`);
          const config = loadConfig(configPath);

          const useCache = opts.cache !== false && !opts.force;
          let inputHash: string | undefined;

          if (isMultiModuleConfig(config)) {
            inputHash = computeInputHash(config, configPath, VERSION);

            if (useCache) {
              const manifestDir = opts.generatedDir || 'packages/';
              const skipCheck = await canSkipGeneration(manifestDir, inputHash);
              if (skipCheck.skip) {
                generationCacheSkipped = true;
                generateSkipped = true;
                generateDuration = Date.now() - generateStartTime;

                if (isStreaming && process.stdout.isTTY) {
                  process.stdout.clearLine?.(0);
                  process.stdout.cursorTo?.(0);
                }
                console.log(`  ○ Generate              SKIP (${skipCheck.reason})`);
              }
            }
          }

          if (!generationCacheSkipped) {
            const originalLog = console.log;
            if (!verbose) console.log = () => {};

            try {
              await generate(config, {
                skipLint: opts.skipLint,
                contractsOnly: opts.contractsOnly,
                serverOnly: opts.serverOnly,
                frontendOnly: opts.frontendOnly,
                      });

              if (opts.manifest !== false) {
                const { config: guardrailsConfig } = loadGuardrailsConfigWithPath(opts.guardrails);
                if (guardrailsConfig?.generated && guardrailsConfig.generated.length > 0) {
                  const manifestDir = opts.generatedDir || 'packages/';
                  if (fs.existsSync(manifestDir)) {
                    const manifestInputHash =
                      (opts.cache !== false && !isPartialGeneration(opts)) ? inputHash : undefined;
                    const { manifest, changed } = await generateManifest(manifestDir, {
                      generatorVersion: VERSION,
                      inputHash: manifestInputHash,
                    });
                    if (verbose) {
                      const fileCount = Object.keys(manifest.files).length;
                      if (changed) {
                        const mPath = writeManifest(manifest, manifestDir);
                        originalLog(`  Manifest updated: ${mPath} (${fileCount} files)`);
                      } else {
                        originalLog(`  Manifest unchanged (${fileCount} files)`);
                      }
                    } else if (changed) {
                      writeManifest(manifest, manifestDir);
                    }
                  }
                }
              }

              generatePassed = true;
            } finally {
              if (!verbose) console.log = originalLog;
            }

            generateDuration = Date.now() - generateStartTime;

            if (isStreaming && process.stdout.isTTY) {
              process.stdout.clearLine?.(0);
              process.stdout.cursorTo?.(0);
            }

            console.log(`  ✓ Generate              PASS (${generateDuration}ms)`);
            if (verbose) console.log('');
          }
        }
      } catch (error) {
        generateDuration = Date.now() - generateStartTime;
        hasFailure = true;
        generateError = error instanceof Error ? error.message : String(error);

        if (isStreaming && process.stdout.isTTY) {
          process.stdout.clearLine?.(0);
          process.stdout.cursorTo?.(0);
        }

        console.log(`  ✗ Generate              FAIL (${generateDuration}ms)`);
        console.log(`    ${generateError}`);

        if (!opts.continueOnError) {
          console.log('');
          console.log('❌ Generation failed. Stopping pipeline.');
          process.exit(1);
        }
        if (verbose) console.log('⚠️  Continuing due to --continue-on-error.');
      }

      // Step 3: Gate 3,4,5
      if (verbose) {
        console.log('');
        console.log('┌─────────────────────────────────────────────────┐');
        console.log('│ Step 3: Post-generation checks (Gate 3, 4, 5)   │');
        console.log('└─────────────────────────────────────────────────┘');
        console.log('');
      }

      const gate3Skips = generationCacheSkipped
        ? [...skipChecks, 'drift', 'manifest']
        : skipChecks;

      const gate345Summary = await runAllChecks({
        ...baseCheckOptions,
        skip: gate3Skips,
        gates: [3, 4, 5],
      });

      allResults.push(...gate345Summary.results);

      if (verbose) console.log(formatCheckSummary(gate345Summary, gate345Summary.checks));

      if (gate345Summary.failed > 0) hasFailure = true;

      // Final Summary
      const totalDuration = Date.now() - startTime;
      const totalPassed = gate12Summary.passed + gate345Summary.passed + (generatePassed ? 1 : 0);
      const totalFailed = gate12Summary.failed + gate345Summary.failed + (generateError ? 1 : 0);
      const totalSkipped = gate12Summary.skipped + gate345Summary.skipped + (generateSkipped ? 1 : 0);

      console.log('');
      console.log('━'.repeat(50));
      console.log('📊 Pipeline Summary');
      console.log('━'.repeat(50));
      console.log('');
      console.log(`  Total Passed:  ${totalPassed}`);
      console.log(`  Total Failed:  ${totalFailed}`);
      if (totalSkipped > 0) console.log(`  Total Skipped: ${totalSkipped}`);
      console.log(`  Duration:      ${totalDuration}ms`);
      console.log('');

      const verdict = formatVerdict({ failed: totalFailed, passed: totalPassed });

      if (hasFailure) {
        console.log('❌ Pipeline completed with failures.');

        const failedResults = allResults.filter(r => r.status === 'fail' && r.details && r.details.length > 0);
        if (failedResults.length > 0) {
          console.log('');
          console.log('📋 Failed Check Details:');
          for (const result of failedResults) {
            console.log(`  ▶ ${result.name}`);
            for (const detail of result.details!) {
              console.log(`    ${detail}`);
            }
          }
        }

        process.exit(1);
      } else if (totalPassed === 0) {
        // Nothing ran, so there is nothing to call successful.
        console.log(verdict);
        process.exit(1);
      } else {
        console.log('✅ Pipeline completed successfully!');
      }
      console.log('');

    } catch (error) {
      console.error('Pipeline failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },

  // ── deps ──────────────────────────────────────────────
  deps: async (opts) => {
    try {
      const configPath = opts.config
        ? path.resolve(opts.config)
        : findConfigFile();

      if (!configPath) {
        console.error('Error: No config file found.');
        process.exit(1);
      }

      const config = loadConfig(configPath) as MultiModuleConfig;

      if (!config.modules) {
        console.error('Error: Config must have modules defined.');
        process.exit(1);
      }

      const moduleDeps = new Map<string, {
        deps: string[];
        openApiDeps: string[];
        configDeps: string[];
      }>();

      for (const [moduleName, moduleConfig] of Object.entries(config.modules)) {
        if (opts.module && moduleName !== opts.module) continue;

        const openapiPath = path.resolve(path.dirname(configPath), moduleConfig.openapi);
        if (!fs.existsSync(openapiPath)) {
          // Skipping the module would present a dependency graph, impact
          // analysis or validation result that silently omits it.
          // Skipping the module would present a dependency graph, impact
          // analysis or validation result that silently omits it.
          throw new Error(`OpenAPI spec not found for module '${moduleName}': ${openapiPath}`);
        }

        const spec = loadOpenAPISpec(openapiPath);
        const openApiDeps = spec.info['x-micro-contracts-depend-on'] || [];
        const configDeps = moduleConfig.dependsOn || [];

        moduleDeps.set(moduleName, { deps: openApiDeps, openApiDeps, configDeps });
      }

      if (opts.graph) {
        outputDependencyGraph(moduleDeps);
      } else if (opts.impact) {
        outputImpactAnalysis(moduleDeps, opts.impact);
      } else if (opts.whoDependsOn) {
        outputWhoDependsOn(moduleDeps, opts.whoDependsOn);
      } else if (opts.validate) {
        validateDependencies(moduleDeps);
      } else {
        outputAllDependencies(moduleDeps);
      }

    } catch (error) {
      console.error('Deps analysis failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },

  // ── guardrails-init ───────────────────────────────────
  guardrailsInit: async (opts) => {
    try {
      const outputPath = opts.output ?? 'guardrails.yaml';

      if (fs.existsSync(outputPath)) {
        console.error(`File already exists: ${outputPath}`);
        console.error('Use --output to specify a different path.');
        process.exit(1);
      }

      createGuardrailsConfig(outputPath);
      console.log(`Created: ${outputPath}`);
      console.log('\nNext steps:');
      console.log('  1. Review and customize the guardrails configuration');
      console.log('  2. Run: micro-contracts check');

    } catch (error) {
      console.error('Failed to create guardrails config:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },

  // ── manifest ──────────────────────────────────────────
  manifest: async (opts) => {
    try {
      const baseDir = opts.dir ?? 'packages/';

      if (!fs.existsSync(baseDir)) {
        console.error(`Directory not found: ${baseDir}`);
        process.exit(1);
      }

      if (opts.verify) {
        const { verifyManifest, formatManifestResult } = await import('./guardrails/index.js');
        const result = await verifyManifest(baseDir);
        console.log(formatManifestResult(result));
        if (!result.valid) {
          process.exit(1);
        }
      } else {
        console.log(`Generating manifest for: ${baseDir}`);
        const { manifest, changed } = await generateManifest(baseDir, {
          generatorVersion: VERSION,
        });

        const fileCount = Object.keys(manifest.files).length;

        if (changed) {
          const manifestPath = writeManifest(manifest, baseDir);
          console.log(`Manifest updated: ${manifestPath} (${fileCount} files)`);
        } else {
          console.log(`Manifest unchanged (${fileCount} files)`);
        }
      }

    } catch (error) {
      console.error('Manifest operation failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },

  // ── audit-openapi (LLM) ──────────────────────────────
  auditOpenapi: async (opts) => {
    return commandAuditOpenapi({
      config: opts.config,
      module: opts.module,
      adapter: opts.adapter,
      model: opts.model,
      showPrompt: opts.showPrompt,
      failOn: opts.failOn as 'warning' | 'error' | 'critical' | undefined,
      output: opts.output,
      reportFormat: opts.reportFormat as 'json' | 'text' | 'yaml' | undefined,
      logFile: opts.logFile,
    });
  },

  // ── review-published (LLM) ───────────────────────────
  reviewPublished: async (opts) => {
    return commandReviewPublished({
      config: opts.config,
      module: opts.module,
      adapter: opts.adapter,
      model: opts.model,
      showPrompt: opts.showPrompt,
      failOn: opts.failOn as 'warning' | 'error' | 'critical' | undefined,
      output: opts.output,
      reportFormat: opts.reportFormat as 'json' | 'text' | 'yaml' | undefined,
      logFile: opts.logFile,
    });
  },

  // ── propose-overlays (LLM) ───────────────────────────
  proposeOverlays: async (opts) => {
    return commandProposeOverlays({
      config: opts.config,
      module: opts.module,
      adapter: opts.adapter,
      model: opts.model,
      showPrompt: opts.showPrompt,
      failOn: opts.failOn as 'warning' | 'error' | 'critical' | undefined,
      output: opts.output,
      reportFormat: opts.reportFormat as 'json' | 'text' | 'yaml' | undefined,
      logFile: opts.logFile,
    });
  },

  // ── insights ─────────────────────────────────────────
  insights: async (opts) => {
    try {
      await commandInsights({
        format: opts.format,
        projectRoot: opts.projectRoot,
        config: opts.config,
      });
    } catch (error) {
      console.error('Insights failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  },

  // ── audit-guardrails (LLM) ───────────────────────────
  auditGuardrails: async (opts) => {
    return commandAuditGuardrails({
      config: opts.config,
      guardrails: opts.guardrails,
      adapter: opts.adapter,
      model: opts.model,
      showPrompt: opts.showPrompt,
      failOn: opts.failOn as 'warning' | 'error' | 'critical' | undefined,
      output: opts.output,
      reportFormat: opts.reportFormat as 'json' | 'text' | 'yaml' | undefined,
      logFile: opts.logFile,
    });
  },
};

createProgram(handlers, VERSION).parse();

// =============================================================================
// Helper functions (used by init, deps commands)
// =============================================================================

function processOpenAPIWithExtensions(openapiPath: string): {
  yaml: string;
  stats: { servicesAdded: number; methodsAdded: number; services: string[] };
} {
  const content = fs.readFileSync(openapiPath, 'utf-8');
  const spec = yaml.parse(content);

  const stats = { servicesAdded: 0, methodsAdded: 0, services: new Set<string>() };
  const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

  if (spec.paths) {
    for (const [pathKey, pathItem] of Object.entries(spec.paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue;
      const service = inferServiceFromPath(pathKey);

      for (const method of httpMethods) {
        const operation = (pathItem as Record<string, unknown>)[method];
        if (!operation || typeof operation !== 'object') continue;
        const op = operation as Record<string, unknown>;

        if (!op['x-micro-contracts-service'] && service) {
          op['x-micro-contracts-service'] = service;
          stats.servicesAdded++;
          stats.services.add(service);
        }

        if (!op['x-micro-contracts-method']) {
          const methodName = op.operationId
            ? String(op.operationId)
            : inferMethodName(method, pathKey);
          op['x-micro-contracts-method'] = methodName;
          stats.methodsAdded++;
        }
      }
    }
  }

  const output = yaml.stringify(spec, { indent: 2 });
  return { yaml: output, stats: { ...stats, services: Array.from(stats.services) } };
}

function inferServiceFromPath(pathKey: string): string | null {
  const normalized = pathKey.replace(/^\/api\//, '/').replace(/^\/v\d+\//, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const firstSegment = segments[0];
  if (firstSegment.startsWith('{')) return null;

  const words = firstSegment.replace(/-/g, '_').split('_');
  const pascalCase = words
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');

  if (pascalCase.endsWith('s') && !pascalCase.endsWith('ss')) {
    return pascalCase.slice(0, -1);
  }
  return pascalCase;
}

function inferMethodName(httpMethod: string, pathKey: string): string {
  const segments = pathKey
    .replace(/^\/api\//, '/')
    .replace(/^\/v\d+\//, '/')
    .split('/')
    .filter(Boolean);

  const hasIdParam = segments.some(s => s.startsWith('{'));
  const resourceSegments = segments.filter(s => !s.startsWith('{'));

  const resourceName = resourceSegments
    .map((seg) => {
      const words = seg.replace(/-/g, '_').split('_');
      return words
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
    })
    .join('');

  const singularName = resourceName.endsWith('s') && !resourceName.endsWith('ss')
    ? resourceName.slice(0, -1)
    : resourceName;

  switch (httpMethod.toLowerCase()) {
    case 'get': return hasIdParam ? `get${singularName}ById` : `get${resourceName}`;
    case 'post': return `create${singularName}`;
    case 'put': return `update${singularName}`;
    case 'patch': return `patch${singularName}`;
    case 'delete': return `delete${singularName}`;
    default: return `${httpMethod.toLowerCase()}${resourceName}`;
  }
}

function generateDbTemplate(): string {
  return `import pg from 'pg';
import { DBModel, PostgresDriver } from 'litedbmodel';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }
  return pool;
}

export async function initializeDb(): Promise<void> {
  const p = getPool();
  DBModel.setDriver(new PostgresDriver(p));
  const client = await p.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    const p = getPool();
    const client = await p.connect();
    try {
      await client.query('SELECT 1');
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}
`;
}

function generateContainerTemplate(moduleName: string): string {
  const pascalName = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
  return `import { testConnection, closeDb } from './db.js';

export interface ${pascalName}Services {
  // example: ExampleServiceApi;
}

export interface ${pascalName}ModuleContainer {
  services: ${pascalName}Services;
  testConnection: () => Promise<boolean>;
  close: () => Promise<void>;
}

export async function initialize${pascalName}Module(): Promise<${pascalName}ModuleContainer> {
  const services: ${pascalName}Services = {};

  return {
    services,
    testConnection,
    close: closeDb,
  };
}
`;
}

function generateConfigTemplate(moduleName: string): string {
  return [
    '# micro-contracts Configuration', '',
    'defaults:', '  contract:', '    output: packages/contract/{module}', '',
    '  contractPublic:', '    output: packages/contract-published/{module}', '',
    '  outputs:', '    server-routes:', '      output: server/src/{module}/routes.generated.ts',
    '      template: fastify-routes.hbs', '      config:',
    '        servicesPath: fastify.services.{module}', '',
    '    frontend-api:', '      output: frontend/src/{module}/api.generated.ts',
    '      template: fetch-client.hbs', '',
    '    shared-client:', '      output: frontend/src/shared/{module}.api.generated.ts',
    '      template: fetch-client.hbs', '      condition: hasPublicEndpoints', '      config:',
    '        contractPackage: "@project/contract-published/{module}"', '',
    '  overlays:', '    shared:', '      - spec/_shared/overlays/middleware.overlay.yaml',
    '    collision: error', '', '  docs:', '    enabled: true', '',
    'modules:', `  ${moduleName}:`, `    openapi: spec/${moduleName}/openapi/${moduleName}.yaml`, '',
  ].join('\n');
}

function generateScreenConfigTemplate(moduleName: string): string {
  return [
    '# micro-contracts Configuration (Screen Spec)', '',
    'defaults:', '  contract:', '    output: packages/contract/{module}', '',
    '  docs:', '    enabled: false', '',
    'modules:', `  ${moduleName}:`, `    openapi: spec/${moduleName}/openapi/${moduleName}.yaml`,
    '    screen: true', '    outputs:', '      screen-navigation:',
    `        output: frontend/src/screens/navigation.generated.ts`,
    '        template: screen-navigation.hbs', '      screen-events:',
    `        output: frontend/src/screens/events.generated.ts`,
    '        template: screen-events.hbs', '',
  ].join('\n');
}

function generateProblemDetailsSchema(): string {
  return `# RFC 9457 Problem Details
components:
  schemas:
    ProblemDetails:
      type: object
      required: [type, title, status]
      properties:
        type:
          type: string
          format: uri
        title:
          type: string
        status:
          type: integer
        detail:
          type: string
        instance:
          type: string
          format: uri
        code:
          type: string
        traceId:
          type: string
        errors:
          type: array
          items:
            type: object
            properties:
              field:
                type: string
              message:
                type: string
`;
}

function generateSpectralRules(): string {
  return `extends: ["spectral:oas"]

rules:
  operation-service:
    description: "Operations must have x-micro-contracts-service"
    severity: error
    given: "$.paths[*][get,post,put,patch,delete]"
    then:
      field: x-micro-contracts-service
      function: truthy

  operation-method:
    description: "Operations must have x-micro-contracts-method"
    severity: error
    given: "$.paths[*][get,post,put,patch,delete]"
    then:
      field: x-micro-contracts-method
      function: truthy

  operation-error-responses:
    description: "Operations should have 5XX or default error response"
    severity: warn
    given: "$.paths[*][get,post,put,patch,delete].responses"
    then:
      function: schema
      functionOptions:
        schema:
          anyOf:
            - required: ["500"]
            - required: ["5XX"]
            - required: ["default"]

  canonical-extension-prefix:
    description: "Use canonical x-micro-contracts-* extensions"
    severity: warn
    given: "$.paths[*][get,post,put,patch,delete]"
    then:
      - field: x-service
        function: falsy
      - field: x-method
        function: falsy
      - field: x-public
        function: falsy
`;
}

function generateScreenSpecTemplate(moduleName: string): string {
  const pascalName = moduleName.charAt(0).toUpperCase() + moduleName.slice(1);
  return `openapi: '3.1.0'
info:
  title: ${pascalName} Screen Specification
  version: '0.1.0'
  description: |
    Screen contract for ${moduleName} domain.
servers:
  - url: /
    description: Screen routes (client-side)
paths:
  /home:
    get:
      operationId: renderHomePage
      security: [{session: []}]
      x-screen-const: HOME
      x-screen-id: SCR-001
      x-screen-name: HomePage
      x-back-navigation: false
      summary: Render home page
      responses:
        '200':
          description: Home page ViewModel
          content:
            application/json:
              schema:
                \$ref: '#/components/schemas/HomePageViewModel'
          links:
            goToSettings:
              operationId: renderSettingsPage
  /settings:
    get:
      operationId: renderSettingsPage
      security: [{session: []}]
      x-screen-const: SETTINGS
      x-screen-id: SCR-002
      x-screen-name: SettingsPage
      x-back-navigation: true
      summary: Render settings page
      responses:
        '200':
          description: Settings page ViewModel
          content:
            application/json:
              schema:
                \$ref: '#/components/schemas/SettingsPageViewModel'
          links:
            goToHome:
              operationId: renderHomePage
components:
  securitySchemes:
    session:
      type: apiKey
      in: cookie
      name: session
  schemas:
    HomePageViewModel:
      type: object
      required: [greeting]
      properties:
        greeting:
          type: string
    SettingsPageViewModel:
      type: object
      required: [theme]
      properties:
        theme:
          type: string
          enum: [light, dark]
`;
}

function outputDependencyGraph(moduleDeps: Map<string, { deps: string[] }>): void {
  console.log('```mermaid');
  console.log('graph LR');
  for (const [moduleName, { deps }] of moduleDeps) {
    const moduleTargets = new Set<string>();
    for (const dep of deps) {
      const parts = dep.split('.');
      if (parts.length >= 1) moduleTargets.add(parts[0]);
    }
    for (const target of moduleTargets) {
      console.log(`  ${moduleName} --> ${target}`);
    }
  }
  console.log('```');
}

function outputImpactAnalysis(moduleDeps: Map<string, { deps: string[] }>, ref: string): void {
  console.log(`Impacted by changes to ${ref}:\n`);
  const impacted: string[] = [];
  for (const [moduleName, { deps }] of moduleDeps) {
    if (deps.includes(ref)) impacted.push(moduleName);
  }
  if (impacted.length === 0) {
    console.log('  No modules depend on this API.');
  } else {
    for (const m of impacted) console.log(`  - ${m}`);
  }
}

function outputWhoDependsOn(moduleDeps: Map<string, { deps: string[] }>, ref: string): void {
  console.log(`Modules that depend on ${ref}:\n`);
  const dependent: string[] = [];
  for (const [moduleName, { deps }] of moduleDeps) {
    if (deps.some(d => d.startsWith(ref))) dependent.push(moduleName);
  }
  if (dependent.length === 0) {
    console.log('  None found.');
  } else {
    for (const m of dependent) console.log(`  - ${m}`);
  }
}

function validateDependencies(moduleDeps: Map<string, { openApiDeps: string[]; configDeps: string[] }>): void {
  let hasErrors = false;
  for (const [moduleName, { openApiDeps, configDeps }] of moduleDeps) {
    for (const dep of configDeps) {
      if (!openApiDeps.includes(dep)) {
        console.error(`ERROR: ${moduleName}.dependsOn includes '${dep}'`);
        console.error(`       but it's not declared in OpenAPI x-micro-contracts-depend-on`);
        hasErrors = true;
      }
    }
  }
  if (!hasErrors) {
    console.log('✓ All dependencies are valid');
  } else {
    process.exit(1);
  }
}

function outputAllDependencies(moduleDeps: Map<string, { deps: string[] }>): void {
  console.log('Module Dependencies:\n');
  for (const [moduleName, { deps }] of moduleDeps) {
    console.log(`${moduleName}:`);
    if (deps.length === 0) {
      console.log('  (no dependencies)');
    } else {
      for (const dep of deps) console.log(`  - ${dep}`);
    }
    console.log();
  }
}
