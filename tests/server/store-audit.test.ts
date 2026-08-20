import { describe, expect, it } from "vitest";
import { createDemoStore } from "../../server/seed.js";
import { auditDataStore } from "../../server/store-audit.js";

describe("store audit", () => {
  it("accepts the seeded demo store and summarizes the migration footprint", () => {
    const store = createDemoStore(new Date("2026-08-12T12:00:00.000Z"));
    const report = auditDataStore(store);

    expect(report.ok).toBe(true);
    expect(report.issues).toHaveLength(0);
    expect(report.counts).toMatchObject({
      brands: 20,
      accounts: 20,
      interactions: 60,
      workflowNodes: 19,
      workflowEdges: 22,
    });
    expect(report.interactions.byChannel).toEqual({
      instagram: 20,
      facebook: 40,
      x: 0,
      tiktok: 0,
      youtube: 0,
      linkedin: 0,
      google_business: 0,
    });
    expect(report.interactions.byType).toEqual({ dm: 40, comment: 20, review: 0 });
    expect(report.metricool).toMatchObject({ configuredAccounts: 0, unconfiguredAccounts: 20 });
  });

  it("flags duplicate, orphan, invalid-date and workflow allowlist problems", () => {
    const store = createDemoStore(new Date("2026-08-12T12:00:00.000Z"));
    store.interactions.push({
      ...store.interactions[0],
      id: "interaction-duplicate",
      text: "=IMPORTXML(\"https://example.com\")",
    });
    store.interactions.push({
      ...store.interactions[1],
      id: "interaction-orphan",
      brandId: "brand-missing",
      accountId: "account-missing",
      createdAt: "fecha-invalida",
      updatedAt: "fecha-invalida",
    });
    store.workflow.autoReplyAccountIds = ["account-missing"];

    const report = auditDataStore(store);
    const codes = report.issues.map((issue) => issue.code);

    expect(report.ok).toBe(false);
    expect(codes).toContain("duplicate_interactions");
    expect(codes).toContain("orphan_interactions");
    expect(codes).toContain("invalid_dates");
    expect(codes).toContain("workflow_allowlist_unknown_accounts");
    expect(codes).toContain("excel_formula_risk");
    expect(report.dataRisks.duplicateExternalKeys).toBe(2);
    expect(report.dataRisks.orphanInteractions).toBe(1);
    expect(report.dataRisks.formulaLikeFields).toBeGreaterThan(0);
  });

  it("counts Metricool references without exposing userId or blogId values", () => {
    const store = createDemoStore(new Date("2026-08-12T12:00:00.000Z"));
    store.brands[0].account.metricool = {
      userId: "metricool-user-secret-123",
      blogId: "metricool-blog-secret-456",
    };

    const report = auditDataStore(store);
    const serialized = JSON.stringify(report);

    expect(report.ok).toBe(true);
    expect(report.metricool.configuredAccounts).toBe(1);
    expect(serialized).not.toContain("metricool-user-secret-123");
    expect(serialized).not.toContain("metricool-blog-secret-456");
  });
});
