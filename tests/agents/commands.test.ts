import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { commandAuditOpenapi } from "../../src/commands/audit-openapi.js";
import { commandReviewPublished } from "../../src/commands/review-published.js";
import { commandProposeOverlays } from "../../src/commands/propose-overlays.js";
import { commandAuditGuardrails } from "../../src/commands/audit-guardrails.js";

const examplesDir = resolve(import.meta.dirname, "../../examples");
const configPath = resolve(examplesDir, "micro-contracts.config.yaml");
const guardrailsPath = resolve(examplesDir, "micro-contracts.guardrails.yaml");

describe("commandAuditOpenapi --show-prompt", () => {
  it("returns context string without calling LLM", async () => {
    const result = await commandAuditOpenapi({
      config: configPath,
      showPrompt: true,
    });

    expect(typeof result).toBe("string");
    expect(result).toContain("# OpenAPI Design Audit Request");
    expect(result).toContain("## Module:");
  });

  it("filters by module when specified", async () => {
    const result = await commandAuditOpenapi({
      config: configPath,
      module: "core",
      showPrompt: true,
    });

    expect(result).toContain("## Module: core");
    expect(result).not.toContain("## Module: billing");
  });
});

describe("commandReviewPublished --show-prompt", () => {
  it("returns context string without calling LLM", async () => {
    const result = await commandReviewPublished({
      config: configPath,
      showPrompt: true,
    });

    expect(typeof result).toBe("string");
    expect(result).toContain("# Published API Review Request");
  });
});

describe("commandProposeOverlays --show-prompt", () => {
  it("returns context string without calling LLM", async () => {
    const result = await commandProposeOverlays({
      config: configPath,
      showPrompt: true,
    });

    expect(typeof result).toBe("string");
    expect(result).toContain("# Overlay Proposal Request");
    expect(result).toContain("## Existing Overlays");
  });
});

describe("commandAuditGuardrails --show-prompt", () => {
  it("returns context string without calling LLM", async () => {
    const result = await commandAuditGuardrails({
      config: configPath,
      guardrails: guardrailsPath,
      showPrompt: true,
    });

    expect(typeof result).toBe("string");
    expect(result).toContain("# Guardrails Coverage Audit Request");
  });
});
