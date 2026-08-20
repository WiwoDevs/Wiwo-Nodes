import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queueEligibleAutoReplies } from "../../server/auto-reply-outbox.js";
import { dispatchNextQueuedAutoReply } from "../../server/auto-reply-dispatcher.js";
import { loadConfig } from "../../server/config.js";
import { JsonRepository } from "../../server/repository.js";
import { evaluateSacInteraction } from "../../server/sac-automation.js";
import type { ActorContext } from "../../server/types.js";

const directories: string[] = [];
const actor: ActorContext = {
  userId: "worker-test",
  displayName: "Worker Test",
  tenantId: "techlab-sac",
  role: "admin",
  brandIds: "all",
  source: "trusted_headers",
};

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-auto-reply-"));
  directories.push(directory);
  const dataFile = path.join(directory, "store.json");
  const repository = new JsonRepository(dataFile);
  await repository.initialize();
  const config = loadConfig({
    METRICOOL_MODE: "live",
    METRICOOL_API_TOKEN: "test-token-never-logged",
    SAC_FLOW_API_KEY: "test-api-key",
    SAC_FLOW_DATA_FILE: dataFile,
    SAC_FLOW_AUTO_REPLY_DISPATCH_MODE: "live",
    SAC_FLOW_DISABLE_OUTBOUND_SENDS: "false",
    SAC_FLOW_DISABLE_METRICOOL_MUTATIONS: "false",
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-credential-key-with-32-characters",
  }, directory);
  const snapshot = await repository.snapshot();
  snapshot.workflow.autoReplyEnabled = true;
  snapshot.workflow.autoReplyAccountIds = ["account-01"];
  const source = snapshot.interactions.find((item) => item.accountId === "account-01")!;
  source.text = "Hola";
  source.category = "sin_clasificar";
  source.sentiment = "neutral";
  source.direction = "inbound";
  source.status = "new";
  source.createdAt = new Date().toISOString();
  const assessment = evaluateSacInteraction(source, snapshot, {
    autoReplyDispatchMode: "live",
    autoSendInfrastructureReady: true,
  });
  const interaction = await repository.updateInteraction(source.id, (item) => {
    item.text = source.text;
    item.category = assessment.intent;
    item.sentiment = source.sentiment;
    item.status = "pending";
    item.createdAt = source.createdAt;
    item.responseText = assessment.proposal?.text;
    item.automation = assessment;
  });
  return { repository, config, interaction: interaction! };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("automatic reply dispatch", () => {
  it("queues idempotently and lets the worker dispatch the oldest automatic delivery", async () => {
    const { repository, config, interaction } = await fixture();
    const first = await queueEligibleAutoReplies(
      repository,
      [interaction],
      actor,
      "protocol-test",
      1,
    );
    const second = await queueEligibleAutoReplies(
      repository,
      [interaction],
      actor,
      "protocol-retry",
      1,
    );
    expect(first).toMatchObject({ eligible: 1, created: 1 });
    expect(second).toMatchObject({ eligible: 1, alreadyPresent: 1 });

    const delivery = (await repository.listReplyDeliveries({ status: "pending" }))[0];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ mode: "send", approvedByHuman: false });
      expect((init?.headers as Record<string, string>)["idempotency-key"]).toBe(delivery.idempotencyKey);
      expect(await repository.claimReplyDelivery(delivery.id, 60_000)).toBeDefined();
      await repository.settleReplyDelivery(delivery.id, { status: "sent", at: new Date().toISOString() });
      return new Response(JSON.stringify({ meta: { delivery: "sent" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await dispatchNextQueuedAutoReply({
      repository,
      config,
      actor,
      apiUrl: "http://127.0.0.1:8787",
      fetchImpl: fetchMock as typeof fetch,
    });
    expect(result).toMatchObject({ handled: true, outcome: "sent" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await repository.findReplyDelivery(delivery.id)).toMatchObject({ status: "sent", attemptCount: 1 });
    expect(await repository.findInteraction(interaction.id)).toMatchObject({ status: "replied" });
  });

  it("does not dispatch while the environment remains in shadow mode", async () => {
    const { repository, config, interaction } = await fixture();
    await queueEligibleAutoReplies(repository, [interaction], actor, "shadow-test", 1);
    config.operations.autoReplyDispatchMode = "shadow";
    const fetchMock = vi.fn();

    const result = await dispatchNextQueuedAutoReply({
      repository,
      config,
      actor,
      apiUrl: "http://127.0.0.1:8787",
      fetchImpl: fetchMock as typeof fetch,
    });
    expect(result).toEqual({ handled: false, outcome: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps idempotency at capacity and retains new candidates without growing the queue", async () => {
    const { repository, interaction } = await fixture();
    expect(await queueEligibleAutoReplies(repository, [interaction], actor, "capacity-first", 1, 1))
      .toMatchObject({ created: 1, skippedCapacity: 0, maxPending: 1 });
    expect(await queueEligibleAutoReplies(repository, [interaction], actor, "capacity-replay", 1, 1))
      .toMatchObject({ created: 0, alreadyPresent: 1, skippedCapacity: 0 });

    const otherSource = (await repository.snapshot()).interactions
      .find((item) => item.id !== interaction.id)!;
    const other = await repository.updateInteraction(otherSource.id, (item) => {
      item.direction = "inbound";
      item.status = "pending";
      item.responseText = "Otra respuesta segura";
      item.automation = structuredClone(interaction.automation);
    });
    expect(await queueEligibleAutoReplies(repository, [other!], actor, "capacity-second", 1, 1))
      .toMatchObject({ eligible: 1, created: 0, skippedCapacity: 1, pendingBefore: 1 });
    expect(await repository.listReplyDeliveries({ status: "pending", automaticOnly: true })).toHaveLength(1);
  });

  it("applies a manual rate-limit cooldown to the whole account and continues another account", async () => {
    const { repository, config, interaction } = await fixture();
    const sameAccountManual = (await repository.snapshot()).interactions
      .find((item) => item.accountId === interaction.accountId && item.id !== interaction.id)!;
    const manual = await repository.prepareReplyDelivery({
      id: "00000000-0000-4000-8000-000000000201",
      interactionId: sameAccountManual.id,
      brandId: sameAccountManual.brandId,
      accountId: sameAccountManual.accountId,
      bodyText: "Respuesta manual limitada",
      approvedByHuman: true,
      requestedBy: { userId: actor.userId, displayName: actor.displayName },
      idempotencyKey: `manual-rate-limit:${sameAccountManual.id}`,
      requestId: "cooldown-manual-account-01",
      createdAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const limited = manual.delivery;
    await repository.claimReplyDelivery(limited.id, 60_000);
    await repository.deferReplyDelivery(limited.id, {
      errorCode: "METRICOOL_HTTP_429",
      nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
      at: new Date().toISOString(),
    });
    await queueEligibleAutoReplies(repository, [interaction], actor, "cooldown-account-01", 1);
    const sameAccountAutomatic = (await repository.listReplyDeliveries({ status: "pending" }))
      .find((delivery) => delivery.idempotencyKey.startsWith("auto-reply:"))!;
    const other = (await repository.snapshot()).interactions.find((item) => item.accountId === "account-02")!;
    const preparedOther = await repository.prepareReplyDelivery({
      id: "00000000-0000-4000-8000-000000000202",
      interactionId: other.id,
      brandId: other.brandId,
      accountId: other.accountId,
      bodyText: "Respuesta de otra cuenta",
      approvedByHuman: false,
      requestedBy: { userId: actor.userId, displayName: actor.displayName },
      idempotencyKey: `auto-reply:${other.id}:1:other-account`,
      requestId: "cooldown-account-02",
      createdAt: new Date().toISOString(),
    });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain(encodeURIComponent(other.id));
      await repository.claimReplyDelivery(preparedOther.delivery.id, 60_000);
      await repository.settleReplyDelivery(preparedOther.delivery.id, { status: "sent", at: new Date().toISOString() });
      return new Response(JSON.stringify({ meta: { delivery: "sent" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    expect(await dispatchNextQueuedAutoReply({
      repository,
      config,
      actor,
      apiUrl: "http://127.0.0.1:8787",
      fetchImpl: fetchMock as typeof fetch,
    })).toMatchObject({ handled: true, outcome: "sent" });
    expect(await repository.findReplyDelivery(limited.id)).toMatchObject({ status: "pending" });
    expect(await repository.findReplyDelivery(sameAccountAutomatic.id)).toMatchObject({ status: "pending" });
    expect(await repository.findReplyDelivery(preparedOther.delivery.id)).toMatchObject({ status: "sent" });
  });
});
