import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ExternalInsightSchema } from "agent-contracts-analyzer";
import {
  MicroContractsInsightProvider,
  buildExternalInsight,
} from "../../src/external/insight-provider.js";

const EXAMPLES_ROOT = path.resolve(import.meta.dirname, "../../examples");

describe("MicroContractsInsightProvider", () => {
  it("implements InsightProvider and validates against ExternalInsightSchema", async () => {
    const provider = new MicroContractsInsightProvider();
    expect(provider.name).toBe("micro-contracts");

    const insight = await provider.provide({ projectRoot: EXAMPLES_ROOT });
    const parsed = ExternalInsightSchema.safeParse(insight);
    expect(parsed.success).toBe(true);
    expect(insight.source).toBe("micro-contracts");
    expect(insight.sourceVersion).toBeDefined();
    expect(insight.edges.length).toBeGreaterThan(0);
    expect(insight.anchorMapping?.length).toBeGreaterThan(0);
  });

  it("emits module-level api_dependency edges with api_contract_declaration evidence", () => {
    const insight = buildExternalInsight(EXAMPLES_ROOT);
    const moduleEdge = insight.edges.find(
      (e) =>
        e.from === "billing" &&
        e.to === "core.User.getUsers" &&
        e.kind === "api_dependency",
    );
    expect(moduleEdge).toBeDefined();
    expect(moduleEdge!.propagation).toBe("forward");
    expect(moduleEdge!.weight).toBe(0.9);
    expect(moduleEdge!.evidence?.[0]?.kind).toBe("api_contract_declaration");
  });

  it("emits operation-level api_operation_dependency edges", () => {
    const insight = buildExternalInsight(EXAMPLES_ROOT);
    const opEdge = insight.edges.find(
      (e) =>
        e.from === "billing.Billing.createInvoice" &&
        e.to === "core.User.getUserById" &&
        e.kind === "api_operation_dependency",
    );
    expect(opEdge).toBeDefined();
    expect(opEdge!.evidence?.[0]?.symbolId).toBe(
      "packages/contract/billing/services/BillingServiceApi.ts#createInvoice",
    );
  });

  it("maps modules to OpenAPI and contract package paths", () => {
    const insight = buildExternalInsight(EXAMPLES_ROOT);
    const billingAnchor = insight.anchorMapping?.find((a) => a.domainId === "billing");
    expect(billingAnchor).toBeDefined();
    expect(billingAnchor!.filePaths).toContain("spec/billing/openapi/billing.yaml");
    expect(billingAnchor!.filePaths).toContain("packages/contract/billing");
  });

  it("includes symbol-level AnchorMapping for API refs", () => {
    const insight = buildExternalInsight(EXAMPLES_ROOT);
    const apiAnchor = insight.anchorMapping?.find(
      (a) => a.domainId === "core.User.getUserById",
    );
    expect(apiAnchor).toBeDefined();
    expect(apiAnchor!.symbolIds).toContain(
      "packages/contract/core/services/UserServiceApi.ts#getUserById",
    );
    expect(apiAnchor!.symbols).toHaveLength(1);
    expect(apiAnchor!.symbols![0]!.symbolId).toBe(
      "packages/contract/core/services/UserServiceApi.ts#getUserById",
    );
  });

  it("includes symbol-level AnchorMapping for source operations", () => {
    const insight = buildExternalInsight(EXAMPLES_ROOT);
    const opAnchor = insight.anchorMapping?.find(
      (a) => a.domainId === "billing.Billing.createInvoice",
    );
    expect(opAnchor).toBeDefined();
    expect(opAnchor!.symbols?.[0]?.symbolId).toBe(
      "packages/contract/billing/services/BillingServiceApi.ts#createInvoice",
    );
  });
});

describe("buildExternalInsight error handling", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("throws when config is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-insight-"));
    tempDirs.push(dir);
    expect(() => buildExternalInsight(dir)).toThrow(/config/i);
  });
});
