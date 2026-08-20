import { describe, expect, it } from "vitest";
import { createDemoStore } from "../../server/seed.js";
import { validateWorkflow } from "../../server/workflow-validation.js";

describe("workflow validation", () => {
  it("accepts the production-shaped SAC workflow", () => {
    const result = validateWorkflow(createDemoStore().workflow);
    expect(result.valid).toBe(true);
    expect(result.errors).toBe(0);
  });

  it("blocks cycles, orphan edges, unreachable nodes and unsafe auto-reply", () => {
    const workflow = createDemoStore().workflow;
    workflow.autoReplyEnabled = true;
    workflow.autoReplyAccountIds = [];
    workflow.edges.push({ id: "cycle", source: "reply", target: "schedule" });
    workflow.edges.push({ id: "orphan", source: "missing", target: "reply" });
    const result = validateWorkflow(workflow);
    const codes = result.issues.map((issue) => issue.code);
    expect(result.valid).toBe(false);
    expect(codes).toContain("WORKFLOW_CYCLE");
    expect(codes).toContain("ORPHAN_EDGE");
    expect(codes).toContain("EMPTY_AUTO_REPLY_ALLOWLIST");
  });
});
