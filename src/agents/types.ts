import type { OpenapiAuditResult } from "../generated/dsl/handoffs.js";

export type TaskId =
  | "audit-openapi-design"
  | "audit-published-api"
  | "propose-overlay-candidates"
  | "audit-guardrails-coverage";

export interface AuditConfig {
  adapter?: string;
  model?: string;
  temperature?: number;
}

export interface AuditOptions {
  failOn?: "warning" | "error" | "critical";
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
