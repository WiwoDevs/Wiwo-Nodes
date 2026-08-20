import { randomUUID } from "node:crypto";
import pg from "pg";
import { PostgresRepository } from "../dist-api/postgres-repository.js";

const { Pool } = pg;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const connectionString = required("SAC_FLOW_POSTGRES_URL");
const encryptionKey = required("SAC_FLOW_POSTGRES_ENCRYPTION_KEY");
const organizationSlug = `outbox-smoke-${randomUUID()}`;
const repository = new PostgresRepository({
  connectionString,
  encryptionKey,
  organizationSlug,
  organizationName: "Outbox smoke (ephemeral)",
  seedDemoOnEmpty: true,
});
const cleanupPool = new Pool({ connectionString });

try {
  await repository.initialize();
  const interaction = (await repository.listInteractions())[0];
  assert(interaction, "The isolated organization did not receive a demo interaction.");

  const idempotencyKey = `outbox-smoke:${randomUUID()}`;
  const createdAt = new Date().toISOString();
  const deliveryInput = {
    interactionId: interaction.id,
    brandId: interaction.brandId,
    accountId: interaction.accountId,
    bodyText: "Respuesta ficticia del smoke de outbox.",
    approvedByHuman: true,
    requestedBy: { userId: "outbox-smoke", displayName: "Outbox smoke" },
    idempotencyKey,
    requestId: `request:${randomUUID()}`,
    createdAt,
  };

  const prepared = await Promise.all([
    repository.prepareReplyDelivery({ ...deliveryInput, id: randomUUID() }),
    repository.prepareReplyDelivery({ ...deliveryInput, id: randomUUID() }),
  ]);
  const createdCount = prepared.filter((item) => item.created).length;
  assert(createdCount === 1, `Expected one durable insert, received ${createdCount}.`);
  assert(prepared[0].delivery.id === prepared[1].delivery.id, "Concurrent preparation returned different deliveries.");

  const deliveryId = prepared[0].delivery.id;
  const claims = await Promise.all([
    repository.claimReplyDelivery(deliveryId, 1),
    repository.claimReplyDelivery(deliveryId, 1),
  ]);
  const claimedCount = claims.filter(Boolean).length;
  assert(claimedCount === 1, `Expected one lease owner, received ${claimedCount}.`);

  const deferred = await repository.deferReplyDelivery(deliveryId, {
    errorCode: "METRICOOL_HTTP_429",
    nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
    at: new Date().toISOString(),
  });
  assert(deferred?.status === "pending", "The confirmed 429 did not return the delivery to pending.");
  const earlyClaim = await repository.claimReplyDelivery(deliveryId, 1);
  assert(!earlyClaim, "A deferred delivery was leased before Retry-After elapsed.");
  await cleanupPool.query(
    `UPDATE replies r
     SET next_attempt_at = now() - interval '1 second'
     FROM organizations o
     WHERE r.organization_id = o.id AND o.slug = $1 AND r.id = $2`,
    [organizationSlug, deliveryId],
  );
  const resumed = await repository.claimReplyDelivery(deliveryId, 1);
  assert(resumed?.status === "sending", "The delivery was not leaseable after its cooldown elapsed.");

  const sameAccountInteraction = (await repository.listInteractions())
    .find((item) => item.accountId === interaction.accountId && item.id !== interaction.id);
  assert(sameAccountInteraction, "The smoke seed needs two interactions for one account.");
  const second = await repository.prepareReplyDelivery({
    ...deliveryInput,
    id: randomUUID(),
    interactionId: sameAccountInteraction.id,
    brandId: sameAccountInteraction.brandId,
    accountId: sameAccountInteraction.accountId,
    idempotencyKey: `outbox-smoke-second:${randomUUID()}`,
    requestId: `request-second:${randomUUID()}`,
  });
  const accountSendingClaim = await repository.claimReplyDelivery(second.delivery.id, 1);
  assert(!accountSendingClaim, "Two deliveries for one account were leased concurrently.");

  const recoveredCount = await repository.recoverStaleReplyDeliveries("2030-01-01T00:00:00.000Z");
  assert(recoveredCount === 1, `Expected one stale lease recovery, received ${recoveredCount}.`);
  const uncertain = await repository.findReplyDelivery(deliveryId);
  assert(uncertain?.status === "uncertain", "The stale lease did not become uncertain.");
  const accountUncertainClaim = await repository.claimReplyDelivery(second.delivery.id, 1);
  assert(!accountUncertainClaim, "The account breaker allowed a send while reconciliation was pending.");

  const reconciled = await repository.reconcileReplyDelivery(deliveryId, {
    outcome: "sent",
    expectedVersion: uncertain.version,
    actor: { userId: "outbox-smoke-supervisor", displayName: "Outbox smoke supervisor" },
    note: "Resultado ficticio verificado por el smoke local.",
    at: "2030-01-01T00:01:00.000Z",
  });
  assert(reconciled?.delivery.status === "sent", "The delivery did not reconcile to sent.");
  assert(reconciled?.interaction?.status === "replied", "The interaction did not reconcile to replied.");
  const unblocked = await repository.claimReplyDelivery(second.delivery.id, 1);
  assert(unblocked?.status === "sending", "The account did not resume after reconciliation.");
  await repository.settleReplyDelivery(second.delivery.id, {
    status: "failed",
    errorCode: "SMOKE_CLEANUP",
    at: "2030-01-01T00:02:00.000Z",
  });

  const capacityInteractions = (await repository.listInteractions())
    .filter((item) => ![interaction.id, sameAccountInteraction.id].includes(item.id))
    .slice(0, 2);
  assert(capacityInteractions.length === 2, "The smoke seed needs two interactions for the capacity race.");
  const capacityInputs = capacityInteractions.map((item, index) => ({
    id: randomUUID(),
    interactionId: item.id,
    brandId: item.brandId,
    accountId: item.accountId,
    bodyText: `Respuesta automática de capacidad ${index + 1}.`,
    approvedByHuman: false,
    requestedBy: { userId: "outbox-smoke", displayName: "Outbox smoke" },
    idempotencyKey: `auto-reply:outbox-smoke-capacity:${randomUUID()}`,
    requestId: `capacity-request:${randomUUID()}`,
    createdAt: new Date().toISOString(),
  }));
  const capacityResults = await Promise.all(
    capacityInputs.map((input) => repository.prepareAutoReplyDelivery(input, 1)),
  );
  assert(capacityResults.filter((item) => item.created).length === 1, "The atomic queue limit accepted more than one delivery.");
  assert(capacityResults.filter((item) => item.capacityReached).length === 1, "The atomic queue limit did not reject one concurrent delivery.");
  const capacityDelivery = capacityResults.find((item) => item.created)?.delivery;
  assert(capacityDelivery, "The atomic capacity smoke did not persist its accepted delivery.");
  const capacityClaim = await repository.claimReplyDelivery(capacityDelivery.id, 1);
  assert(capacityClaim?.status === "sending", "The accepted capacity delivery was not claimable.");
  await repository.settleReplyDelivery(capacityDelivery.id, {
    status: "failed",
    errorCode: "SMOKE_CLEANUP",
    at: "2030-01-01T00:03:00.000Z",
  });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    prepared: prepared.length,
    created: createdCount,
    leaseOwners: claimedCount,
    deferred: deferred.status,
    earlyClaimBlocked: !earlyClaim,
    resumedAttemptCount: resumed.attemptCount,
    concurrentAccountClaimBlocked: !accountSendingClaim,
    uncertainAccountClaimBlocked: !accountUncertainClaim,
    accountResumedAfterReconciliation: unblocked.status === "sending",
    atomicCapacityCreated: capacityResults.filter((item) => item.created).length,
    atomicCapacityRejected: capacityResults.filter((item) => item.capacityReached).length,
    recovered: recoveredCount,
    finalDeliveryStatus: reconciled.delivery.status,
    finalInteractionStatus: reconciled.interaction.status,
  })}\n`);
} finally {
  await repository.close();
  await cleanupPool.query("DELETE FROM organizations WHERE slug = $1", [organizationSlug]);
  await cleanupPool.end();
}
