import { describe, it, expect } from "vitest";
import {
  computeExitCode,
  formatResultText,
  formatResultJson,
  formatResultYaml,
  formatResult,
} from "../../src/agents/formatter.js";
import type { AuditRunResult } from "../../src/agents/types.js";

function makeResult(overrides: Partial<AuditRunResult> = {}): AuditRunResult {
  return {
    taskId: "audit-openapi-design",
    data: {
      summary: "API design looks clean",
      riskLevel: "low",
      findings: [],
    },
    raw: "",
    prompt: "test prompt",
    status: "success",
    followUpsUsed: 0,
    retriesUsed: 0,
    ...overrides,
  };
}

describe("computeExitCode", () => {
  it("returns 1 for non-success status", () => {
    const result = makeResult({ status: "error", data: null });
    expect(computeExitCode(result, {})).toBe(1);
  });

  it("returns 0 when no findings exceed threshold", () => {
    const result = makeResult({
      data: {
        summary: "OK",
        riskLevel: "low",
        findings: [
          { severity: "info", category: "design", message: "Looks good" },
          { severity: "warning", category: "bloat", message: "Minor concern" },
        ],
      },
    });
    expect(computeExitCode(result, { failOn: "error" })).toBe(0);
  });

  it("returns 10 when findings exceed threshold", () => {
    const result = makeResult({
      data: {
        summary: "Issues found",
        riskLevel: "high",
        findings: [
          { severity: "error", category: "responsibility", message: "Cross-module leak" },
        ],
      },
    });
    expect(computeExitCode(result, { failOn: "error" })).toBe(10);
  });

  it("respects failOn=warning threshold", () => {
    const result = makeResult({
      data: {
        summary: "Minor issues",
        riskLevel: "medium",
        findings: [
          { severity: "warning", category: "naming", message: "Inconsistent paths" },
        ],
      },
    });
    expect(computeExitCode(result, { failOn: "warning" })).toBe(10);
  });

  it("respects failOn=critical threshold", () => {
    const result = makeResult({
      data: {
        summary: "Errors present but not critical",
        riskLevel: "high",
        findings: [
          { severity: "error", category: "design", message: "Bad pattern" },
        ],
      },
    });
    expect(computeExitCode(result, { failOn: "critical" })).toBe(0);
  });

  it("uses error as default failOn threshold", () => {
    const result = makeResult({
      data: {
        summary: "Warning only",
        riskLevel: "medium",
        findings: [
          { severity: "warning", category: "design", message: "Suggestion" },
        ],
      },
    });
    expect(computeExitCode(result, {})).toBe(0);
  });
});

describe("formatResultText", () => {
  it("formats findings with severity icons", () => {
    const result = makeResult({
      data: {
        summary: "Issues found",
        riskLevel: "high",
        findings: [
          {
            severity: "critical",
            category: "responsibility",
            message: "Cross-module API leak",
            recommendation: "Mark as non-exportable",
            location: "POST /internal/users",
          },
        ],
      },
    });
    const text = formatResultText(result);
    expect(text).toContain("Risk Level: HIGH");
    expect(text).toContain("Summary: Issues found");
    expect(text).toContain("[responsibility] Cross-module API leak");
    expect(text).toContain("Location: POST /internal/users");
    expect(text).toContain("Recommendation: Mark as non-exportable");
  });

  it("formats recommended actions", () => {
    const result = makeResult({
      data: {
        summary: "Actionable",
        riskLevel: "medium",
        findings: [],
        recommendedActions: [
          { kind: "run_command", title: "Run lint", command: "micro-contracts lint" },
        ],
      },
    });
    const text = formatResultText(result);
    expect(text).toContain("Recommended Actions:");
    expect(text).toContain("[run_command] Run lint");
    expect(text).toContain("$ micro-contracts lint");
  });

  it("shows error message on failure", () => {
    const result = makeResult({ status: "error", data: null, errorMessage: "LLM failed" });
    expect(formatResultText(result)).toBe("LLM failed");
  });

  it("shows generic message when no error message", () => {
    const result = makeResult({ status: "escalation", data: null });
    expect(formatResultText(result)).toContain("Task failed with status: escalation");
  });
});

describe("formatResultJson", () => {
  it("returns data JSON on success", () => {
    const result = makeResult();
    const json = JSON.parse(formatResultJson(result));
    expect(json.summary).toBe("API design looks clean");
    expect(json.riskLevel).toBe("low");
    expect(json.findings).toEqual([]);
  });

  it("returns error JSON on failure", () => {
    const result = makeResult({ status: "error", data: null, errorMessage: "oops" });
    const json = JSON.parse(formatResultJson(result));
    expect(json.error).toBe("oops");
    expect(json.status).toBe("error");
  });
});

describe("formatResultYaml", () => {
  it("returns yaml-formatted data on success", () => {
    const result = makeResult();
    const yaml = formatResultYaml(result);
    expect(yaml).toContain("summary:");
    expect(yaml).toContain("riskLevel:");
    expect(yaml).toContain("findings:");
  });

  it("returns error yaml on failure", () => {
    const result = makeResult({ status: "error", data: null, errorMessage: "broken" });
    const yaml = formatResultYaml(result);
    expect(yaml).toContain("error:");
    expect(yaml).toContain("broken");
  });
});

describe("formatResult", () => {
  it("dispatches to text formatter", () => {
    const result = makeResult();
    const text = formatResult(result, "text");
    expect(text).toContain("Risk Level:");
  });

  it("dispatches to json formatter", () => {
    const result = makeResult();
    const json = formatResult(result, "json");
    expect(JSON.parse(json).summary).toBe("API design looks clean");
  });

  it("dispatches to yaml formatter", () => {
    const result = makeResult();
    const yaml = formatResult(result, "yaml");
    expect(yaml).toContain("summary:");
  });
});
