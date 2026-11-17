import { describe, expect, it } from "vitest";
import { classifySyncResponse, isScheduledPortfolioSync, SYNC_REQUEST_TIMEOUT_MS } from "../../server/worker-sync.js";

const scheduled = { scheduleKey: "sac:workflow-1:5893940" };
const manual = { scheduleKey: undefined };
const inProgress = { error: { code: "SYNC_IN_PROGRESS", message: "Ya hay una sincronización de la bandeja en curso." } };

describe("worker sync jobs", () => {
  it("recognises the scheduled portfolio sync", () => {
    expect(isScheduledPortfolioSync(scheduled)).toBe(true);
    expect(isScheduledPortfolioSync(manual)).toBe(false);
    expect(isScheduledPortfolioSync({ scheduleKey: "automation:trigger:1" })).toBe(false);
  });

  it("completes with the run id when the API answers", () => {
    expect(classifySyncResponse(scheduled, 200, { data: { run: { id: "run-1" } } }))
      .toEqual({ kind: "completed", runId: "run-1" });
  });

  it("skips a scheduled sync that collides with one already running instead of failing it", () => {
    expect(classifySyncResponse(scheduled, 409, inProgress)).toEqual({ kind: "skipped", reason: "SYNC_IN_PROGRESS" });
  });

  it("keeps retrying explicit syncs and any other error", () => {
    expect(classifySyncResponse(manual, 409, inProgress))
      .toEqual({ kind: "failed", message: "Ya hay una sincronización de la bandeja en curso." });
    expect(classifySyncResponse(scheduled, 409, { error: { code: "IDEMPOTENCY_CONFLICT" } }))
      .toEqual({ kind: "failed", message: "API de sincronización respondió 409." });
    expect(classifySyncResponse(scheduled, 502, undefined))
      .toEqual({ kind: "failed", message: "API de sincronización respondió 502." });
  });

  it("waits longer than a typical portfolio sync but less than Node's 300 s header limit", () => {
    expect(SYNC_REQUEST_TIMEOUT_MS).toBeGreaterThan(180_000);
    expect(SYNC_REQUEST_TIMEOUT_MS).toBeLessThan(300_000);
  });
});
