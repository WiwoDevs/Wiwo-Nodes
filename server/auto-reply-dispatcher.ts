import type { AppConfig } from "./config.js";
import type { SacFlowRepository } from "./repository-contract.js";
import type { ActorContext, ReplyDelivery } from "./types.js";

const TERMINAL_POLICY_ERRORS = new Set([
  "ACCOUNT_NOT_CONFIGURED",
  "CASE_ALREADY_CLOSED",
  "HUMAN_REVIEW_REQUIRED",
  "INTERACTION_NOT_FOUND",
  "INVALID_DIRECTION",
  "METRICOOL_RECIPIENT_MISSING",
  "REPLY_WINDOW_EXPIRED",
  "SEND_NOT_ALLOWED",
]);

export interface AutoReplyDispatchResult {
  handled: boolean;
  outcome: "disabled" | "idle" | "sent" | "failed" | "uncertain" | "deferred";
  code?: string;
}

export function autoReplyDispatchEnabled(config: AppConfig): boolean {
  return !config.demoMode
    && config.operations.autoReplyDispatchMode === "live"
    && !config.operations.outboundSendsDisabled
    && !config.operations.metricoolMutationsDisabled;
}

function workerHeaders(config: AppConfig, actor: ActorContext, delivery: ReplyDelivery): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "idempotency-key": delivery.idempotencyKey,
  };
  if (config.security.apiKey) headers["x-api-key"] = config.security.apiKey;
  if (config.security.actorContext.trustHeaders) {
    headers["x-sac-user-id"] = actor.userId;
    headers["x-sac-user-name"] = actor.displayName;
    headers["x-sac-tenant-id"] = actor.tenantId;
    headers["x-sac-role"] = actor.role;
    headers["x-sac-brand-ids"] = "*";
  }
  return headers;
}

async function failPendingDelivery(
  repository: SacFlowRepository,
  delivery: ReplyDelivery,
  code: string,
): Promise<void> {
  const claimed = await repository.claimReplyDelivery(delivery.id, 60_000);
  if (!claimed) return;
  await repository.settleReplyDelivery(delivery.id, {
    status: "failed",
    errorCode: code.slice(0, 200),
    at: new Date().toISOString(),
  });
}

export async function dispatchNextQueuedAutoReply(options: {
  repository: SacFlowRepository;
  config: AppConfig;
  actor: ActorContext;
  apiUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<AutoReplyDispatchResult> {
  const { repository, config, actor, apiUrl } = options;
  if (!autoReplyDispatchEnabled(config)) return { handled: false, outcome: "disabled" };

  await repository.recoverStaleReplyDeliveries();
  const now = Date.now();
  const allPending = await repository.listReplyDeliveries({
    status: "pending",
    oldestFirst: true,
    limit: 2_000,
  });
  const blockedDeliveries = [
    ...await repository.listReplyDeliveries({ status: "sending", limit: 2_000 }),
    ...await repository.listReplyDeliveries({ status: "uncertain", limit: 2_000 }),
  ];
  const coolingDownAccounts = new Set(
    [...allPending, ...blockedDeliveries]
      .filter((delivery) =>
        ["sending", "uncertain"].includes(delivery.status)
        || (delivery.status === "pending"
          && delivery.nextAttemptAt
          && Date.parse(delivery.nextAttemptAt) > now))
      .map((delivery) => delivery.accountId),
  );
  const pending = allPending
    .filter((delivery) => delivery.idempotencyKey.startsWith("auto-reply:") && !delivery.approvedByHuman)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  const delivery = pending.find((item) =>
    !coolingDownAccounts.has(item.accountId)
    && (!item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now));
  if (!delivery) return { handled: false, outcome: "idle" };

  const interaction = await repository.findInteraction(delivery.interactionId);
  if (!interaction) {
    await failPendingDelivery(repository, delivery, "AUTO_REPLY_INTERACTION_MISSING");
    return { handled: true, outcome: "failed", code: "AUTO_REPLY_INTERACTION_MISSING" };
  }

  let response: Response;
  try {
    response = await (options.fetchImpl || fetch)(
      `${apiUrl}/api/interactions/${encodeURIComponent(interaction.id)}/reply`,
      {
        method: "POST",
        headers: workerHeaders(config, actor, delivery),
        body: JSON.stringify({
          text: delivery.bodyText,
          mode: "send",
          approvedByHuman: false,
          expectedVersion: interaction.version,
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
  } catch {
    return { handled: true, outcome: "deferred", code: "INTERNAL_API_UNAVAILABLE" };
  }

  const payload = await response.json().catch(() => undefined) as {
    error?: { code?: string };
    meta?: { delivery?: string };
  } | undefined;
  if (response.ok) return { handled: true, outcome: "sent" };

  const current = await repository.findReplyDelivery(delivery.id);
  if (current?.status === "uncertain") {
    return { handled: true, outcome: "uncertain", code: current.errorCode || payload?.error?.code };
  }
  if (current?.status === "failed") {
    return { handled: true, outcome: "failed", code: current.errorCode || payload?.error?.code };
  }
  const apiCode = payload?.error?.code || `INTERNAL_API_HTTP_${response.status}`;
  if (TERMINAL_POLICY_ERRORS.has(apiCode)) {
    await failPendingDelivery(repository, delivery, `AUTO_REPLY_${apiCode}`);
    return { handled: true, outcome: "failed", code: apiCode };
  }
  return { handled: true, outcome: "deferred", code: apiCode };
}
