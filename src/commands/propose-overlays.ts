import chalk from "chalk";
import { buildProposeOverlaysContext } from "../agents/context-builder.js";
import {
  runAgentTask,
  TASK_IDS,
  computeExitCode,
  formatResult,
  writeOutput,
  EXIT_RUNTIME_MISSING,
  EXIT_ADAPTER_ERROR,
} from "../agents/index.js";
import type { AuditConfig, AuditOptions, ReportFormat } from "../agents/index.js";

export interface CommandProposeOverlaysOptions {
  config?: string;
  module?: string;
  adapter?: string;
  model?: string;
  showPrompt?: boolean;
  failOn?: "warning" | "error" | "critical";
  output?: string;
  reportFormat?: ReportFormat;
  logFile?: string;
}

export async function commandProposeOverlays(opts: CommandProposeOverlaysOptions): Promise<void | string> {
  const context = await buildProposeOverlaysContext(opts.config, opts.module);

  if (opts.showPrompt) return context;

  const auditConfig: AuditConfig = {
    adapter: opts.adapter,
    model: opts.model,
  };

  const auditOpts: AuditOptions = {
    failOn: opts.failOn,
    logFile: opts.logFile,
  };

  try {
    const result = await runAgentTask(
      context,
      TASK_IDS.proposeOverlays,
      auditConfig,
      auditOpts,
    );

    const content = formatResult(result, opts.reportFormat ?? "json");
    await writeOutput(content, opts.output);

    const exitCode = computeExitCode(result, auditOpts);
    if (exitCode !== 0) process.exit(exitCode);
  } catch (err: unknown) {
    const exitCode = (err as { exitCode?: number }).exitCode;
    if (exitCode === EXIT_RUNTIME_MISSING || exitCode === EXIT_ADAPTER_ERROR) {
      console.error(chalk.red((err as Error).message));
      process.exit(exitCode);
    }
    throw err;
  }
}
