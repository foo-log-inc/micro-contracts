import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  buildAuditOpenapiContext,
  buildReviewPublishedContext,
  buildProposeOverlaysContext,
  buildAuditGuardrailsContext,
} from "../../src/agents/context-builder.js";

const examplesDir = resolve(import.meta.dirname, "../../examples");

describe("buildAuditOpenapiContext", () => {
  it("builds context with project configuration and specs", async () => {
    const configPath = resolve(examplesDir, "micro-contracts.config.yaml");
    const ctx = await buildAuditOpenapiContext(configPath, undefined);

    expect(ctx).toContain("# OpenAPI Design Audit Request");
    expect(ctx).toContain("## Project Configuration");
    expect(ctx).toContain("## Module: core");
    expect(ctx).toContain("## Module: billing");
    expect(ctx).toContain("```yaml");
  });

  it("filters by module name when specified", async () => {
    const configPath = resolve(examplesDir, "micro-contracts.config.yaml");
    const ctx = await buildAuditOpenapiContext(configPath, "core");

    expect(ctx).toContain("## Module: core");
    expect(ctx).not.toContain("## Module: billing");
  });

  it("includes lint results for specs", async () => {
    const configPath = resolve(examplesDir, "micro-contracts.config.yaml");
    const ctx = await buildAuditOpenapiContext(configPath, undefined);

    expect(ctx).toContain("OpenAPI Specification");
  });

  it("includes overlay content when overlays exist", async () => {
    const configPath = resolve(examplesDir, "micro-contracts.config.yaml");
    const ctx = await buildAuditOpenapiContext(configPath, undefined);

    expect(ctx).toContain("## Existing Overlays");
  });

  it("includes module dependency graph", async () => {
    const configPath = resolve(examplesDir, "micro-contracts.config.yaml");
    const ctx = await buildAuditOpenapiContext(configPath, undefined);

    expect(ctx).toContain("## Module Dependency Graph");
  });

  it("throws with exitCode 3 when config not found", async () => {
    await expect(
      buildAuditOpenapiContext("/nonexistent/path.yaml", undefined),
    ).rejects.toMatchObject({ exitCode: 3 });
  });

  it("includes source data without hardcoded instructions", async () => {
    const configPath = resolve(examplesDir, "micro-contracts.config.yaml");
    const ctx = await buildAuditOpenapiContext(configPath, undefined);

    expect(ctx).not.toContain("You must");
    expect(ctx).not.toContain("You should");
    expect(ctx).not.toContain("Please evaluate");
  });
});

describe("buildReviewPublishedContext", () => {
  it("builds context for published API review", async () => {
    const configPath = resolve(examplesDir, "micro-contracts.config.yaml");
    const ctx = await buildReviewPublishedContext(configPath, undefined);

    expect(ctx).toContain("# Published API Review Request");
    expect(ctx).toContain("## Module:");
    expect(ctx).toContain("### Master Specification");
  });

  it("includes non-exportable schema markers when present", async () => {
    const configPath = resolve(examplesDir, "micro-contracts.config.yaml");
    const ctx = await buildReviewPublishedContext(configPath, undefined);

    expect(ctx).toContain("```yaml");
  });

  it("throws with exitCode 3 when config not found", async () => {
    await expect(
      buildReviewPublishedContext("/nonexistent/path.yaml", undefined),
    ).rejects.toMatchObject({ exitCode: 3 });
  });
});

describe("buildProposeOverlaysContext", () => {
  it("builds context for overlay proposal", async () => {
    const configPath = resolve(examplesDir, "micro-contracts.config.yaml");
    const ctx = await buildProposeOverlaysContext(configPath, undefined);

    expect(ctx).toContain("# Overlay Proposal Request");
    expect(ctx).toContain("## Module:");
    expect(ctx).toContain("## Existing Overlays");
    expect(ctx).toContain("## Project Configuration");
  });

  it("shows overlay content when existing overlays exist", async () => {
    const configPath = resolve(examplesDir, "micro-contracts.config.yaml");
    const ctx = await buildProposeOverlaysContext(configPath, undefined);

    expect(ctx).toContain("middleware.overlay.yaml");
  });

  it("throws with exitCode 3 when config not found", async () => {
    await expect(
      buildProposeOverlaysContext("/nonexistent/path.yaml", undefined),
    ).rejects.toMatchObject({ exitCode: 3 });
  });
});

describe("buildAuditGuardrailsContext", () => {
  it("builds context for guardrails audit", async () => {
    const guardrailsPath = resolve(examplesDir, "micro-contracts.guardrails.yaml");
    const configPath = resolve(examplesDir, "micro-contracts.config.yaml");
    const ctx = await buildAuditGuardrailsContext(configPath, guardrailsPath);

    expect(ctx).toContain("# Guardrails Coverage Audit Request");
    expect(ctx).toContain("## Guardrails Configuration");
    expect(ctx).toContain("## Project Configuration");
    expect(ctx).toContain("```yaml");
  });

  it("includes configured output directories", async () => {
    const guardrailsPath = resolve(examplesDir, "micro-contracts.guardrails.yaml");
    const configPath = resolve(examplesDir, "micro-contracts.config.yaml");
    const ctx = await buildAuditGuardrailsContext(configPath, guardrailsPath);

    expect(ctx).toContain("## Configured Output Directories");
  });

  it("throws with exitCode 3 when config not found", async () => {
    await expect(
      buildAuditGuardrailsContext("/nonexistent/path.yaml", undefined),
    ).rejects.toMatchObject({ exitCode: 3 });
  });

  it("falls back to defaults when guardrails.yaml not found", async () => {
    const configPath = resolve(examplesDir, "micro-contracts.config.yaml");
    const ctx = await buildAuditGuardrailsContext(configPath, "/nonexistent/guardrails.yaml");

    expect(ctx).toContain("# Guardrails Coverage Audit Request");
    expect(ctx).toContain("## Project Configuration");
    expect(ctx).not.toContain("## Guardrails Configuration");
  });
});
