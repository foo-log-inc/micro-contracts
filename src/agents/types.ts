import type { OpenapiAuditResult } from "../generated/dsl/handoffs.js";
import { taskRegistry } from "../generated/dsl/tasks.js";

export type TaskId = keyof typeof taskRegistry;

export const TASK_IDS = {
  auditOpenapi: "audit-openapi-design",
  reviewPublished: "audit-published-api",
  proposeOverlays: "propose-overlay-candidates",
  auditGuardrails: "audit-guardrails-coverage",
} as const satisfies Record<string, TaskId>;

export interface AuditConfig {
  adapter?: string;
  model?: string;
  temperature?: number;
}

export interface AuditOptions {
  failOn?: "warning" | "error" | "critical";
  logFile?: string;
}

export interface AuditRunResult {
  taskId: TaskId;
  data: OpenapiAuditResult | null;
  raw: string;
  prompt: string;
  status: "success" | "error" | "escalation" | "validation_error";
  errorMessage?: string;
  followUpsUsed: number;
  retriesUsed: number;
}
