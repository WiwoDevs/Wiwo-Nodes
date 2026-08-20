import { createHash, randomUUID } from "node:crypto";
import type { SacFlowRepository } from "./repository-contract.js";
import type { Interaction, ReplyDeliveryActor } from "./types.js";

export interface AutoReplyQueueResult {
  eligible: number;
  created: number;
  alreadyPresent: number;
  skippedCapacity: number;
  pendingBefore: number;
  maxPending: number;
}

function autoReplyKey(interaction: Interaction, workflowVersion: number, bodyText: string): string {
  const digest = createHash("sha256").update(bodyText).digest("hex").slice(0, 32);
  return `auto-reply:${interaction.id}:${workflowVersion}:${digest}`;
}

export async function queueEligibleAutoReplies(
  repository: SacFlowRepository,
  interactions: Interaction[],
  actor: ReplyDeliveryActor,
  requestId: string,
  workflowVersion: number,
  maxPending = 1_000,
): Promise<AutoReplyQueueResult> {
  const candidates = interactions.filter((interaction) =>
    interaction.direction === "inbound"
    && interaction.automation?.effectiveRoute === "auto_reply"
    && !["replied", "resolved"].includes(interaction.status));
  let created = 0;
  let alreadyPresent = 0;
  let skippedCapacity = 0;
  const pendingDeliveries = await repository.listReplyDeliveries({
    status: "pending",
    automaticOnly: true,
    limit: Math.min(2_000, maxPending + 1),
  });
  const pendingAutoReplies = pendingDeliveries;
  const knownKeys = new Set(pendingAutoReplies.map((delivery) => delivery.idempotencyKey));

  for (const interaction of candidates) {
    const bodyText = interaction.responseText || interaction.automation?.proposal?.text;
    if (!bodyText) continue;
    const idempotencyKey = autoReplyKey(interaction, workflowVersion, bodyText);
    if (knownKeys.has(idempotencyKey)) {
      alreadyPresent += 1;
      continue;
    }
    const prepared = await repository.prepareAutoReplyDelivery({
      id: randomUUID(),
      interactionId: interaction.id,
      brandId: interaction.brandId,
      accountId: interaction.accountId,
      bodyText,
      approvedByHuman: false,
      requestedBy: actor,
      idempotencyKey,
      requestId: `${requestId}:${interaction.id}`,
      createdAt: new Date().toISOString(),
    }, maxPending);
    if (prepared.capacityReached) {
      skippedCapacity += 1;
      continue;
    }
    if (prepared.created) {
      created += 1;
      knownKeys.add(idempotencyKey);
    } else {
      alreadyPresent += 1;
    }
  }

  return {
    eligible: candidates.length,
    created,
    alreadyPresent,
    skippedCapacity,
    pendingBefore: pendingAutoReplies.length,
    maxPending,
  };
}
