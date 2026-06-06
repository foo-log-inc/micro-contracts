import { resolvedDsl } from "../generated/dsl/dsl-data.js";
import type { AuditConfig, AuditOptions, AuditRunResult, TaskId } from "./types.js";

export const EXIT_RUNTIME_MISSING = 11;
export const EXIT_ADAPTER_ERROR = 12;

export async function runAgentTask(
  userRequest: string,
  taskId: TaskId,
  auditConfig: AuditConfig,
  options: AuditOptions,
): Promise<AuditRunResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let executeTask: (taskId: string, options: any) => Promise<any>;
  try {
    const runtime = await import("agent-contracts-runtime");
    executeTask = runtime.executeTask;
  } catch {
    throw Object.assign(
      new Error(
        "agent-contracts-runtime is not installed. " +
          "Install it to use this command, or use --show-prompt to inspect the prompt.\n" +
          "  npm install agent-contracts-runtime",
      ),
      { exitCode: EXIT_RUNTIME_MISSING },
    );
  }

  let result;
  try {
    result = await executeTask(taskId, {
      request: userRequest,
      adapter: auditConfig.adapter ?? "mock",
      model: auditConfig.model,
      dsl: resolvedDsl,
      logFile: options.logFile,
      maxFollowUps: 3,
      maxRetries: 1,
    });
  } catch (err) {
    throw Object.assign(err as Error, { exitCode: EXIT_ADAPTER_ERROR });
  }

  const outcome = result.outcome;
  return {
    taskId,
    data: outcome.status === "success" ? (outcome.data ?? null) : null,
    raw: outcome.raw ?? "",
    prompt: userRequest,
    status: outcome.status as AuditRunResult["status"],
    errorMessage:
      outcome.status === "error" ? outcome.message :
      outcome.status === "escalation" ? outcome.reason :
      outcome.status === "validation_error" ? outcome.errors?.message :
      undefined,
    followUpsUsed: result.follow_ups_used,
    retriesUsed: result.retries_used,
  };
}
