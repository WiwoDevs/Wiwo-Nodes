import { createHash } from "node:crypto";
import { conversationKey } from "./sac-automation.js";
import {
  isMetricoolContentUnavailable,
  metricoolContentContextForDisplay,
  metricoolContentForDisplay,
} from "./metricool-content.js";
import type {
  Channel,
  Interaction,
  InteractionContentContext,
  InteractionStatus,
  InteractionType,
} from "./types.js";

const OPEN_STATUSES = new Set<InteractionStatus>(["new", "pending", "drafted", "escalated"]);
const GENERIC_HANDLES = new Set([
  "usuario",
  "user",
  "unknown",
  "desconocido",
  "cliente",
  "socialuser",
]);

export interface PublicPostContext {
  postId: string;
  permalink?: string;
  caption?: string;
  thumbnailUrl?: string;
  publishedAt?: string;
}

export type PublicInboxInteraction = Omit<Interaction, "metricoolRef" | "audit" | "internalNotes"> & {
  contentContext: InteractionContentContext;
  postContext?: PublicPostContext;
};

export interface InboxContactLatest {
  id: string;
  direction: Interaction["direction"];
  text: string;
  createdAt: string;
  status: InteractionStatus;
  type: InteractionType;
  contentContext: InteractionContentContext;
  postContext?: PublicPostContext;
}

export interface InboxContactSummary {
  contactKey: string;
  brandId: string;
  accountId: string;
  channel: Channel;
  customerName: string;
  customerHandle: string;
  replyTarget?: PublicInboxInteraction;
  latest: InboxContactLatest;
  messageCount: number;
  pendingCount: number;
  dmCount: number;
  commentCount: number;
  reviewCount: number;
  threadCount: number;
  assignmentConflict: boolean;
}

export interface InboxPostSummary {
  postKey: string;
  brandId: string;
  accountId: string;
  channel: Channel;
  postContext: PublicPostContext;
  publishedAt?: string;
  latestCommentAt: string;
  sortAt: string;
  sortSource: "published_at" | "latest_comment_at";
  commentCount: number;
  pendingCount: number;
  teamReplyCount: number;
  participantCount: number;
  latestComment: PublicInboxInteraction;
  replyTarget?: PublicInboxInteraction;
}

function safePublicUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function safeIsoTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function normalizedHandle(value: string): string | undefined {
  const handle = value.trim().normalize("NFKC").replace(/^@/, "").toLocaleLowerCase("es-CL");
  if (!handle || GENERIC_HANDLES.has(handle)) return undefined;
  return handle;
}

export function inboxPersonKey(interaction: Interaction): string {
  const prefix = `${interaction.accountId}\u0000${interaction.channel}`;
  const reference = interaction.metricoolRef;
  if (reference?.actorId) return `${prefix}\u0000actor\u0000${reference.actorId}`;
  if (interaction.type === "dm" && reference?.conversationId) {
    return `${prefix}\u0000dm-conversation\u0000${reference.conversationId}`;
  }
  if (interaction.direction === "outbound" && reference?.recipient) {
    return `${prefix}\u0000recipient\u0000${reference.recipient}`;
  }
  const handle = normalizedHandle(interaction.customerHandle);
  if (handle) return `${prefix}\u0000${interaction.type}\u0000handle\u0000${handle}`;
  return `${prefix}\u0000${interaction.type}\u0000interaction\u0000${interaction.id}`;
}

export function contactKeyFor(interaction: Interaction): string {
  return createHash("sha256").update(inboxPersonKey(interaction)).digest("base64url");
}

export function publicPostContext(interaction: Interaction): PublicPostContext | undefined {
  if (interaction.type !== "comment") return undefined;
  const post = interaction.metricoolRef?.post;
  const postId = post?.id || interaction.metricoolRef?.postId;
  if (!postId) return undefined;
  return {
    postId,
    permalink: safePublicUrl(post?.url),
    caption: post?.text,
    thumbnailUrl: safePublicUrl(post?.mediaUrl),
    publishedAt: safeIsoTimestamp(post?.publishedAt),
  };
}

export function publicInboxInteraction(interaction: Interaction): PublicInboxInteraction {
  const {
    metricoolRef: _metricoolRef,
    audit: _audit,
    internalNotes: _internalNotes,
    ...publicInteraction
  } = interaction;
  const text = metricoolContentForDisplay(interaction.text);
  const nonActionableContent = isMetricoolContentUnavailable(text);
  const automation = nonActionableContent ? undefined : interaction.automation;
  const hasHumanResponse = interaction.audit.some((entry) =>
    entry.actor === "agent" && (entry.action === "draft_created" || entry.action === "reply_sent"));
  const responseText = nonActionableContent && !hasHumanResponse
    ? undefined
    : interaction.responseText;
  return {
    ...publicInteraction,
    text,
    contentContext: metricoolContentContextForDisplay(text, interaction.metricoolRef?.contentContext),
    responseText,
    automation: automation ? {
      ...automation,
      conversation: {
        ...automation.conversation,
        key: createHash("sha256").update(automation.conversation.key).digest("base64url"),
      },
    } : undefined,
    postContext: publicPostContext(interaction),
  };
}

function timestamp(interaction: Interaction): number {
  const value = Date.parse(interaction.createdAt);
  return Number.isFinite(value) ? value : 0;
}

function replyPriority(interaction: Interaction): [number, number, number, string] {
  const statusWeights: Record<InteractionStatus, number> = {
    escalated: 4,
    drafted: 3,
    pending: 2,
    new: 1,
    replied: 0,
    resolved: 0,
  };
  const status = statusWeights[interaction.status];
  const risk = { critical: 4, high: 3, medium: 2, low: 1 }[interaction.automation?.risk ?? "low"];
  return [risk, status, timestamp(interaction), interaction.id];
}

function comparePriority(left: Interaction, right: Interaction): number {
  const leftRank = replyPriority(left);
  const rightRank = replyPriority(right);
  for (let index = 0; index < leftRank.length; index += 1) {
    const leftValue = leftRank[index]!;
    const rightValue = rightRank[index]!;
    if (leftValue === rightValue) continue;
    return leftValue > rightValue ? -1 : 1;
  }
  return 0;
}

export function interactionsForContact(interactions: Interaction[], selected: Interaction): Interaction[] {
  const key = inboxPersonKey(selected);
  return interactions.filter((interaction) => inboxPersonKey(interaction) === key);
}

function inboxPostIdentity(interaction: Interaction): string | undefined {
  if (interaction.type !== "comment") return undefined;
  const postId = interaction.metricoolRef?.post?.id || interaction.metricoolRef?.postId;
  if (!postId) return undefined;
  return [interaction.brandId, interaction.accountId, interaction.channel, postId].join("\u0000");
}

export function postKeyFor(interaction: Interaction): string | undefined {
  const identity = inboxPostIdentity(interaction);
  return identity
    ? createHash("sha256").update(identity).digest("base64url")
    : undefined;
}

export function interactionsForInboxPost(interactions: Interaction[], postKey: string): Interaction[] {
  return interactions
    .filter((interaction) => postKeyFor(interaction) === postKey)
    .sort((left, right) => timestamp(left) - timestamp(right) || left.id.localeCompare(right.id));
}

export function pendingCommentsForInboxPost(interactions: Interaction[], postKey: string): Interaction[] {
  return interactionsForInboxPost(interactions, postKey).filter((interaction) =>
    interaction.direction === "inbound" && OPEN_STATUSES.has(interaction.status));
}

function mergedPostContext(ordered: Interaction[]): PublicPostContext | undefined {
  const contexts = ordered.flatMap((interaction) => {
    const context = publicPostContext(interaction);
    return context ? [context] : [];
  });
  const first = contexts[0];
  if (!first) return undefined;
  const publishedAt = contexts
    .map((context) => context.publishedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  return {
    postId: first.postId,
    permalink: contexts.find((context) => context.permalink)?.permalink,
    caption: contexts.find((context) => context.caption)?.caption,
    thumbnailUrl: contexts.find((context) => context.thumbnailUrl)?.thumbnailUrl,
    publishedAt,
  };
}

export function groupInboxPosts(interactions: Interaction[]): InboxPostSummary[] {
  const groups = new Map<string, Interaction[]>();
  for (const interaction of interactions) {
    const identity = inboxPostIdentity(interaction);
    if (!identity) continue;
    const group = groups.get(identity) ?? [];
    group.push(interaction);
    groups.set(identity, group);
  }

  return [...groups.values()].flatMap((group) => {
    const ordered = [...group].sort((left, right) =>
      timestamp(right) - timestamp(left) || right.id.localeCompare(left.id));
    const inbound = ordered.filter((interaction) => interaction.direction === "inbound");
    if (!inbound.length) return [];
    const pending = inbound.filter((interaction) => OPEN_STATUSES.has(interaction.status));
    const latestComment = inbound[0]!;
    const postContext = mergedPostContext(ordered);
    const postKey = postKeyFor(latestComment);
    if (!postContext || !postKey) return [];
    const publishedAt = postContext.publishedAt;
    const latestCommentAt = latestComment.createdAt;
    return [{
      postKey,
      brandId: latestComment.brandId,
      accountId: latestComment.accountId,
      channel: latestComment.channel,
      postContext,
      publishedAt,
      latestCommentAt,
      sortAt: publishedAt ?? latestCommentAt,
      sortSource: publishedAt ? "published_at" as const : "latest_comment_at" as const,
      commentCount: inbound.length,
      pendingCount: pending.length,
      teamReplyCount: ordered.length - inbound.length,
      participantCount: new Set(inbound.map(inboxPersonKey)).size,
      latestComment: publicInboxInteraction(latestComment),
      replyTarget: pending.length
        ? publicInboxInteraction([...pending].sort(comparePriority)[0]!)
        : undefined,
    }];
  }).sort((left, right) =>
    Date.parse(right.sortAt) - Date.parse(left.sortAt)
    || Date.parse(right.latestCommentAt) - Date.parse(left.latestCommentAt)
    || right.postKey.localeCompare(left.postKey));
}

export function groupInboxContacts(interactions: Interaction[]): InboxContactSummary[] {
  const groups = new Map<string, Interaction[]>();
  for (const interaction of interactions) {
    const key = inboxPersonKey(interaction);
    const group = groups.get(key) ?? [];
    group.push(interaction);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const ordered = [...group].sort((left, right) => timestamp(right) - timestamp(left) || right.id.localeCompare(left.id));
    const latest = ordered[0]!;
    const openInbound = ordered.filter((interaction) =>
      interaction.direction === "inbound" && OPEN_STATUSES.has(interaction.status));
    const replyTarget = [...openInbound].sort(comparePriority)[0];
    const display = ordered.find((interaction) => interaction.direction === "inbound") ?? latest;
    const assignmentSource = openInbound.length ? openInbound : ordered;
    const assignmentStates = new Set(assignmentSource.map((interaction) => interaction.assignedTo?.userId ?? "unassigned"));
    return {
      contactKey: contactKeyFor(latest),
      brandId: latest.brandId,
      accountId: latest.accountId,
      channel: latest.channel,
      customerName: display.customerName,
      customerHandle: display.customerHandle,
      replyTarget: replyTarget ? publicInboxInteraction(replyTarget) : undefined,
      latest: {
        id: latest.id,
        direction: latest.direction,
        text: metricoolContentForDisplay(latest.text),
        createdAt: latest.createdAt,
        status: latest.status,
        type: latest.type,
        contentContext: metricoolContentContextForDisplay(latest.text, latest.metricoolRef?.contentContext),
        postContext: publicPostContext(latest),
      },
      messageCount: ordered.length,
      pendingCount: openInbound.length,
      dmCount: ordered.filter((interaction) => interaction.type === "dm").length,
      commentCount: ordered.filter((interaction) => interaction.type === "comment").length,
      reviewCount: ordered.filter((interaction) => interaction.type === "review").length,
      threadCount: new Set(ordered.map(conversationKey)).size,
      assignmentConflict: assignmentStates.size > 1,
    };
  }).sort((left, right) =>
    Date.parse(right.latest.createdAt) - Date.parse(left.latest.createdAt)
    || right.latest.id.localeCompare(left.latest.id));
}
