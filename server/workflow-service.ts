import { randomUUID } from "node:crypto";
import type {
  Brand,
  Channel,
  DataStore,
  Interaction,
  InteractionType,
  MetricoolInboxProvider,
  RunAuditStep,
  WorkflowRun,
} from "./types.js";
import {
  channelForMetricoolProvider,
  METRICOOL_INBOX_PROVIDERS,
} from "./types.js";
import { evaluateSacInteraction } from "./sac-automation.js";
import { normalizeMetricoolContent } from "./metricool-content.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

function parseProvider(
  record: Record<string, unknown>,
  fallback: MetricoolInboxProvider = "INSTAGRAMBUSINESS",
): MetricoolInboxProvider {
  const raw = firstString(record, ["provider", "network", "socialNetwork", "platform"])
    ?.trim()
    .toUpperCase();
  const aliases: Record<string, MetricoolInboxProvider> = {
    X: "TWITTER",
    TWITTER: "TWITTER",
    TIKTOK: "TIKTOKBUSINESS",
    GOOGLE: "GMB",
    GOOGLEBUSINESS: "GMB",
    GOOGLE_BUSINESS: "GMB",
    GOOGLEBUSINESSPROFILE: "GMB",
    GOOGLE_BUSINESS_PROFILE: "GMB",
  };
  const value = raw ? aliases[raw] ?? raw : undefined;
  return value && METRICOOL_INBOX_PROVIDERS.includes(value as MetricoolInboxProvider)
    ? value as MetricoolInboxProvider
    : fallback;
}

function parseChannel(
  record: Record<string, unknown>,
  fallback: MetricoolInboxProvider = "INSTAGRAMBUSINESS",
): Channel {
  return channelForMetricoolProvider(parseProvider(record, fallback));
}

function extractArray(payload: unknown, candidateKeys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  for (const key of candidateKeys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
    const nested = asRecord(value);
    if (nested) {
      for (const nestedKey of candidateKeys) {
        if (Array.isArray(nested[nestedKey])) return nested[nestedKey] as unknown[];
      }
      if (Array.isArray(nested.items)) return nested.items;
    }
  }
  if (Array.isArray(record.items)) return record.items;
  return [];
}

export function normalizeMetricoolConnectedChannels(payload: unknown): Channel[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  const networks = asRecord(data?.networksData);
  if (!networks) return [];
  const fields: Array<[Channel, string]> = [
    ["instagram", "instagramData"],
    ["facebook", "facebookData"],
    ["x", "twitterData"],
    ["tiktok", "tiktokData"],
    ["youtube", "youtubeData"],
    ["linkedin", "linkedinData"],
    ["google_business", "gbpData"],
  ];
  return fields.flatMap(([channel, field]) => {
    const value = networks[field];
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      return normalized && !["null", "{}", "[]", "false"].includes(normalized) ? [channel] : [];
    }
    return value && value !== false ? [channel] : [];
  });
}

function referenceId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  const record = asRecord(value);
  return record ? firstString(record, ["id", "userId", "username"]) : undefined;
}

function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function postReference(
  elementValue: unknown,
  fallbackId?: string,
): NonNullable<NonNullable<Interaction["metricoolRef"]>["post"]> | undefined {
  const element = asRecord(elementValue);
  const id = referenceId(elementValue) || fallbackId;
  if (!id) return undefined;
  const mediaUrls = element && Array.isArray(element.mediaUrls) ? element.mediaUrls : [];
  const mediaUrl = mediaUrls.map(safeHttpUrl).find(Boolean);
  return {
    id,
    url: safeHttpUrl(element?.link),
    text: element ? firstString(element, ["text"]) : undefined,
    mediaUrl,
    publishedAt: element ? optionalIso(firstString(element, [
      "publicationDateTime",
      "publishedAt",
      "publicationDate",
      "creationDate",
      "createdAt",
      "date",
    ])) : undefined,
  };
}

type MetricoolReference = NonNullable<Interaction["metricoolRef"]>;

export function mergeMissingMetricoolRef(
  current: Interaction["metricoolRef"],
  incoming: Interaction["metricoolRef"],
): { value: Interaction["metricoolRef"]; changed: boolean } {
  if (!incoming) return { value: current, changed: false };
  const value: MetricoolReference = { ...(current ?? {}) };
  let changed = false;
  const scalarFields = [
    "provider",
    "conversationId",
    "recipient",
    "objectId",
    "commentId",
    "postId",
    "actorId",
    "threadId",
    "parentCommentId",
  ] as const;
  for (const field of scalarFields) {
    if (!value[field] && incoming[field]) {
      value[field] = incoming[field] as never;
      changed = true;
    }
  }
  if (incoming.contentContext) {
    if (incoming.contentContext.kind === "deleted") {
      if (value.contentContext?.kind !== "deleted"
        || value.contentContext.mediaUrls !== undefined
        || value.contentContext.permalink !== undefined
        || value.contentContext.storyId !== undefined) {
        value.contentContext = { kind: "deleted" };
        changed = true;
      }
    } else if (!value.contentContext) {
      value.contentContext = {
        ...incoming.contentContext,
        ...(incoming.contentContext.mediaUrls ? { mediaUrls: [...incoming.contentContext.mediaUrls] } : {}),
      };
      changed = true;
    } else {
      const contentContext = { ...value.contentContext };
      const specificity = {
        unavailable: 1,
        unsupported: 2,
        deleted: 3,
        attachment: 4,
        story_mention: 5,
        story_reply: 6,
        reaction: 7,
        text: 10,
      } as const;
      if (specificity[incoming.contentContext.kind] > specificity[contentContext.kind]) {
        contentContext.kind = incoming.contentContext.kind;
        changed = true;
      }
      const mediaUrls = [...new Set([
        ...(Array.isArray(incoming.contentContext.mediaUrls) ? incoming.contentContext.mediaUrls : []),
        ...(Array.isArray(contentContext.mediaUrls) ? contentContext.mediaUrls : []),
      ])].slice(0, 4);
      if (JSON.stringify(mediaUrls) !== JSON.stringify(Array.isArray(contentContext.mediaUrls) ? contentContext.mediaUrls : [])) {
        contentContext.mediaUrls = mediaUrls;
        changed = true;
      }
      const incomingPermalink = safeHttpUrl(incoming.contentContext.permalink);
      if (incomingPermalink?.startsWith("https://") && incomingPermalink !== contentContext.permalink) {
        contentContext.permalink = incomingPermalink;
        changed = true;
      }
      if (!contentContext.storyId && incoming.contentContext.storyId) {
        contentContext.storyId = incoming.contentContext.storyId;
        changed = true;
      }
      value.contentContext = contentContext;
    }
  }
  const postIdentityMatches = !incoming.post || (
    (!value.postId || value.postId === incoming.post.id)
    && (!value.post?.id || value.post.id === incoming.post.id)
  );
  if (incoming.post && postIdentityMatches) {
    if (!value.post) {
      value.post = { ...incoming.post };
      changed = true;
    } else {
      const post = { ...value.post };
      for (const field of ["id", "url", "text", "mediaUrl", "publishedAt"] as const) {
        if (!post[field] && incoming.post[field]) {
          post[field] = incoming.post[field] as never;
          changed = true;
        }
      }
      value.post = post;
    }
  }
  return { value, changed };
}

function optionalIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function safeIso(value: string | undefined): string {
  return optionalIso(value) ?? new Date().toISOString();
}

interface MetricoolParticipant {
  id: string;
  name?: string;
  username?: string;
  isSelf?: boolean;
}

function parseParticipants(value: unknown): MetricoolParticipant[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const id = firstString(record, ["id", "userId", "username"]);
    if (!id) return [];
    return [{
      id,
      name: firstString(record, ["name", "displayName"]),
      username: firstString(record, ["username", "handle", "screenName"]),
      isSelf: record.self === true || record.isSelf === true || record.fromMe === true,
    }];
  });
}

function participantDetails(
  participants: MetricoolParticipant[],
  participantId: string | undefined,
): { name: string; handle: string } {
  const participant = participantId
    ? participants.find((item) => item.id === participantId)
    : undefined;
  const name = participant?.name || participant?.username || participantId || "Usuario social";
  const handle = participant?.username || participant?.id || participantId || "@usuario";
  return { name, handle };
}

function normalizedSocialHandle(value: string | undefined): string | undefined {
  const normalized = value?.trim().normalize("NFKC").replace(/^@/, "").toLocaleLowerCase("es-CL");
  return normalized || undefined;
}

function authorRepresentsBrand(
  author: Record<string, unknown>,
  authorId: string | undefined,
  selfId: string | undefined,
  brand: Brand,
): boolean {
  if (selfId && authorId === selfId) return true;
  const authorHandle = normalizedSocialHandle(firstString(author, ["username", "handle", "screenName"]));
  return Boolean(authorHandle && authorHandle === normalizedSocialHandle(brand.account.handle));
}

function participantRepresentsBrand(participant: MetricoolParticipant, brand: Brand): boolean {
  if (participant.isSelf) return true;
  const brandHandle = normalizedSocialHandle(brand.account.handle);
  return Boolean(brandHandle && (
    normalizedSocialHandle(participant.username) === brandHandle
    || normalizedSocialHandle(participant.id) === brandHandle
  ));
}

function inferredSelfId(
  explicitSelfId: string | undefined,
  participants: MetricoolParticipant[],
  brand: Brand,
): string | undefined {
  return explicitSelfId
    ?? participants.find((participant) => participantRepresentsBrand(participant, brand))?.id;
}

function ownershipMarker(record: Record<string, unknown>): boolean | undefined {
  const values = [record.fromMe, record.isMine, record.owned];
  if (values.includes(true)) return true;
  if (values.includes(false)) return false;
  return undefined;
}

function metricoolRecordIsOutbound(input: {
  record: Record<string, unknown>;
  author: Record<string, unknown>;
  authorId?: string;
  recipientId?: string;
  selfId?: string;
  participants?: MetricoolParticipant[];
  brand: Brand;
}): boolean {
  const participants = input.participants ?? [];
  const authorIsBrand = authorRepresentsBrand(
    input.author,
    input.authorId,
    input.selfId,
    input.brand,
  ) || Boolean(participants.find((participant) => (
    participant.id === input.authorId && participantRepresentsBrand(participant, input.brand)
  )));
  const ownership = ownershipMarker(input.record);
  if (ownership === true || authorIsBrand) return true;
  if (ownership === false) return false;
  if (input.selfId && input.recipientId === input.selfId) return false;
  if (input.selfId && input.authorId && input.authorId !== input.selfId) return false;
  if (participants.some((participant) => (
    participant.id === input.recipientId && participantRepresentsBrand(participant, input.brand)
  ))) return false;
  // Sin evidencia suficiente, una entrada incierta no debe quedar accionable como mensaje de cliente.
  return true;
}

function threadStatus(value: string | undefined, outbound: boolean): Interaction["status"] {
  if (outbound) return "replied";
  if (value?.toUpperCase() === "RESOLVED") return "resolved";
  if (value?.toUpperCase() === "READ") return "pending";
  return "new";
}

interface MetricoolInteractionInput {
  externalId: string;
  brand: Brand;
  channel: Channel;
  type: InteractionType;
  outbound: boolean;
  customerName: string;
  customerHandle: string;
  text: string;
  createdAt: string;
  status?: string;
  metricoolRef: NonNullable<Interaction["metricoolRef"]>;
}

function buildMetricoolInteraction(input: MetricoolInteractionInput): Interaction {
  return {
    id: randomUUID(),
    externalId: input.externalId,
    brandId: input.brand.id,
    accountId: input.brand.account.id,
    channel: input.channel,
    type: input.type,
    direction: input.outbound ? "outbound" : "inbound",
    customerName: input.customerName,
    customerHandle: input.customerHandle,
    text: input.text,
    category: "sin_clasificar",
    sentiment: "neutral",
    confidence: 0,
    status: threadStatus(input.status, input.outbound),
    source: "metricool",
    version: 1,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    internalNotes: [],
    metricoolRef: input.metricoolRef,
    audit: [{
      id: randomUUID(),
      at: input.createdAt,
      action: "ingested",
      actor: "system",
      detail: "Interacción obtenida mediante la API de Metricool.",
    }],
  };
}

function normalizeOne(
  rawValue: unknown,
  brand: Brand,
  type: InteractionType,
  providerHint: MetricoolInboxProvider,
  inherited: Record<string, unknown> = {},
): Interaction | undefined {
  const raw = asRecord(rawValue);
  if (!raw) return undefined;
  const record = { ...inherited, ...raw };
  const externalId = firstString(record, [
    type === "dm" ? "messageId" : "commentId",
    "id",
    "externalId",
    "uuid",
  ]);
  if (!externalId) return undefined;
  const author = asRecord(record.author) || asRecord(record.user) || asRecord(record.sender) || {};
  const createdCandidate = firstString(record, [
    "publicationDateTime",
    "creationDate",
    "createdAt",
    "created",
    "date",
    "publishedAt",
    "timestamp",
  ]);
  const createdAt = safeIso(createdCandidate);
  const conversationId = firstString(record, ["conversationId", "threadId"]);
  const commentId = type === "comment" ? firstString(record, ["commentId", "id"]) : undefined;
  const postId = firstString(record, ["postId", "publicationId"]) || referenceId(record.element);
  const provider = parseProvider(record, providerHint);
  const recipient = firstString(record, ["recipient"]);
  const participants = parseParticipants(record.participants);
  const selfId = inferredSelfId(referenceId(record.self), participants, brand);
  const authorId = referenceId(author);
  const outbound = metricoolRecordIsOutbound({
    record,
    author,
    authorId,
    recipientId: recipient,
    selfId,
    participants,
    brand,
  });
  const authorIsBrand = outbound || authorRepresentsBrand(author, authorId, selfId, brand);
  const externalAuthorId = !authorIsBrand && authorId !== selfId ? authorId : undefined;
  const externalRecipient = recipient && recipient !== selfId ? recipient : undefined;
  const replyRecipient = outbound ? externalRecipient : externalAuthorId || externalRecipient;
  const customerAuthor = authorIsBrand ? {} : author;
  const content = normalizeMetricoolContent(record);

  return {
    id: randomUUID(),
    externalId,
    brandId: brand.id,
    accountId: brand.account.id,
    channel: parseChannel(record, providerHint),
    type,
    direction: outbound ? "outbound" : "inbound",
    customerName: firstString(customerAuthor, ["name", "displayName", "username"]) || "Usuario social",
    customerHandle: firstString(customerAuthor, ["username", "handle", "screenName"]) || "@usuario",
    text: content.text,
    category: "sin_clasificar",
    sentiment: "neutral",
    confidence: 0,
    status: outbound ? "replied" : "new",
    source: "metricool",
    version: 1,
    createdAt,
    updatedAt: createdAt,
    internalNotes: [],
    metricoolRef: {
      provider,
      conversationId,
      recipient: replyRecipient,
      objectId: type === "comment" ? commentId : undefined,
      commentId,
      postId,
      actorId: outbound ? externalRecipient : externalAuthorId,
      threadId: type === "comment" ? firstString(record, ["threadId"]) : undefined,
      parentCommentId: type === "comment" ? firstString(record, ["parentId", "parentCommentId"]) : undefined,
      contentContext: content.contentContext,
      post: type === "comment" ? postReference(record.element, postId) : undefined,
    },
    audit: [{
      id: randomUUID(),
      at: createdAt,
      action: "ingested",
      actor: "system",
      detail: "Interacción obtenida mediante la API de Metricool.",
    }],
  };
}

export function normalizeMetricoolConversations(
  payload: unknown,
  brand: Brand,
  providerHint: MetricoolInboxProvider = "INSTAGRAMBUSINESS",
): Interaction[] {
  const conversations = extractArray(payload, ["data", "conversations", "results"]);
  const normalized: Interaction[] = [];
  for (const value of conversations) {
    const conversation = asRecord(value);
    if (!conversation) continue;
    const messages = extractArray(conversation.messages, ["data", "messages", "results"]);
    if (messages.length) {
      const conversationId = firstString(conversation, ["conversationId", "id", "threadId"]);
      const provider = parseProvider(conversation, providerHint);
      const channel = parseChannel(conversation, providerHint);
      const participants = parseParticipants(conversation.participants);
      const selfId = inferredSelfId(referenceId(conversation.self), participants, brand);
      const externalParticipant = selfId
        ? participants.find((participant) => participant.id !== selfId)
        : undefined;
      const status = firstString(conversation, ["status"]);
      for (const message of messages) {
        const record = asRecord(message);
        if (!record) continue;
        const externalId = firstString(record, ["messageId", "id", "externalId", "uuid"]);
        if (!externalId) continue;
        const author = asRecord(record.from) || asRecord(record.author) || asRecord(record.sender) || {};
        const fromId = referenceId(record.from) || referenceId(author);
        const toId = referenceId(record.to);
        const outbound = metricoolRecordIsOutbound({
          record,
          author,
          authorId: fromId,
          recipientId: toId,
          selfId,
          participants,
          brand,
        });
        const directionalParticipantId = outbound ? toId : fromId;
        const recipient = directionalParticipantId && directionalParticipantId !== selfId
          ? directionalParticipantId
          : externalParticipant?.id;
        const customer = participantDetails(participants, recipient);
        const content = normalizeMetricoolContent(record);
        normalized.push(buildMetricoolInteraction({
          externalId,
          brand,
          channel,
          type: "dm",
          outbound,
          customerName: customer.name,
          customerHandle: customer.handle,
          text: content.text,
          createdAt: safeIso(firstString(record, [
            "publicationDateTime",
            "creationDate",
            "createdAt",
            "timestamp",
          ])),
          status,
          metricoolRef: {
            provider,
            conversationId,
            recipient,
            actorId: recipient,
            contentContext: content.contentContext,
          },
        }));
      }
    } else {
      const item = normalizeOne(conversation, brand, "dm", providerHint);
      if (item) normalized.push(item);
    }
  }
  return normalized;
}

export function normalizeMetricoolComments(
  payload: unknown,
  brand: Brand,
  providerHint: MetricoolInboxProvider = "INSTAGRAMBUSINESS",
): Interaction[] {
  const threads = extractArray(payload, ["data", "comments", "postComments", "results"]);
  const normalized: Interaction[] = [];
  for (const value of threads) {
    const thread = asRecord(value);
    if (!thread) continue;
    const root = asRecord(thread.root);
    if (!root) {
      const legacy = normalizeOne(thread, brand, "comment", providerHint);
      if (legacy) normalized.push(legacy);
      continue;
    }

    const provider = parseProvider(thread, providerHint);
    const channel = parseChannel(thread, providerHint);
    const participants = parseParticipants(thread.participants);
    const selfId = inferredSelfId(referenceId(thread.self), participants, brand);
    const status = firstString(thread, ["status"]);
    const threadId = firstString(thread, ["threadId", "id"]);
    const element = asRecord(root.element);
    const postId = referenceId(root.element) || firstString(element || {}, ["id", "objectId", "postId"]);
    const post = postReference(root.element, postId);
    const comments = [root, ...extractArray(root.comments, ["data", "comments", "results"])];

    for (const comment of comments) {
      const record = asRecord(comment);
      if (!record) continue;
      const commentId = firstString(record, ["commentId", "id", "externalId", "uuid"]);
      if (!commentId) continue;
      const author = asRecord(record.owner) || asRecord(record.author) || asRecord(record.user) || {};
      const ownerId = referenceId(record.owner) || referenceId(record.author) || referenceId(record.user);
      const outbound = metricoolRecordIsOutbound({
        record,
        author,
        authorId: ownerId,
        selfId,
        participants,
        brand,
      });
      const externalParticipant = selfId
        ? participants.find((participant) => participant.id !== selfId)
        : undefined;
      const customerId = outbound ? externalParticipant?.id : ownerId;
      const customer = participantDetails(participants, customerId);
      const content = normalizeMetricoolContent(record);
      normalized.push(buildMetricoolInteraction({
        externalId: commentId,
        brand,
        channel,
        type: "comment",
        outbound,
        customerName: customer.name,
        customerHandle: customer.handle,
        text: content.text,
        createdAt: safeIso(firstString(record, ["creationDate", "createdAt", "publishedAt", "timestamp"])),
        status,
        metricoolRef: {
          provider,
          objectId: commentId,
          commentId,
          postId,
          actorId: customerId,
          threadId,
          parentCommentId: firstString(record, ["parentId", "parentCommentId"]),
          contentContext: content.contentContext,
          post,
        },
      }));
    }
  }
  return normalized;
}

export function normalizeMetricoolReviews(
  payload: unknown,
  brand: Brand,
  providerHint: MetricoolInboxProvider = "GMB",
): Interaction[] {
  const reviews = extractArray(payload, ["data", "reviews", "results"]);
  const normalized: Interaction[] = [];
  for (const value of reviews) {
    const review = asRecord(value);
    if (!review) continue;
    const reviewId = firstString(review, ["providerId", "reviewId", "id", "externalId"]);
    if (!reviewId) continue;
    const provider = parseProvider(review, providerHint);
    const participants = parseParticipants(review.participants);
    const customer = participantDetails(participants, participants[0]?.id);
    const createdAt = safeIso(firstString(review, ["creationDate", "createdAt", "publishedAt", "timestamp"]));
    const stars = typeof review.stars === "number" && Number.isFinite(review.stars)
      ? Math.max(1, Math.min(5, Math.round(review.stars)))
      : undefined;
    const inbound = buildMetricoolInteraction({
      externalId: reviewId,
      brand,
      channel: channelForMetricoolProvider(provider),
      type: "review",
      outbound: false,
      customerName: customer.name,
      customerHandle: customer.handle,
      text: firstString(review, ["message", "text", "comment"]) || "[Reseña sin comentario]",
      createdAt,
      status: firstString(review, ["status"]),
      metricoolRef: { provider, objectId: reviewId, actorId: participants[0]?.id },
    });
    inbound.category = stars ? `resena_${stars}_estrellas` : "resena";
    inbound.sentiment = stars === undefined || stars === 3 ? "neutral" : stars >= 4 ? "positive" : "negative";
    inbound.confidence = stars === undefined ? 0.7 : 0.98;
    normalized.push(inbound);

    const reply = asRecord(review.reply);
    const replyText = reply ? firstString(reply, ["comment", "text", "message"]) : undefined;
    if (replyText) {
      normalized.push(buildMetricoolInteraction({
        externalId: `${reviewId}:reply`,
        brand,
        channel: channelForMetricoolProvider(provider),
        type: "review",
        outbound: true,
        customerName: brand.name,
        customerHandle: brand.account.handle,
        text: replyText,
        createdAt: safeIso(reply ? firstString(reply, ["updateTime", "createdAt", "timestamp"]) : undefined),
        status: "RESOLVED",
        metricoolRef: { provider, objectId: reviewId, actorId: participants[0]?.id },
      }));
    }
  }
  return normalized;
}

export function createDemoSyncInteractions(brands: Brand[], _runId: string): Interaction[] {
  const now = new Date();
  return brands.flatMap((brand, index) => {
    const base = now.getTime() + index;
    const entries: Array<Pick<Interaction, "channel" | "type" | "text" | "category" | "sentiment" | "confidence">> = [
      {
        channel: "instagram",
        type: "dm",
        text: "Hola, quisiera conocer precio y disponibilidad.",
        category: "preventa",
        sentiment: "neutral",
        confidence: 0.91,
      },
      {
        channel: "facebook",
        type: "comment",
        text: "¿Realizan despachos a mi comuna?",
        category: "despacho",
        sentiment: "neutral",
        confidence: 0.89,
      },
    ];
    return entries.map((entry, entryIndex) => {
      const createdAt = new Date(base + entryIndex).toISOString();
      return {
        id: randomUUID(),
        externalId: `demo-sync-${brand.account.id}-${entryIndex + 1}`,
        brandId: brand.id,
        accountId: brand.account.id,
        channel: entry.channel,
        type: entry.type,
        direction: "inbound" as const,
        customerName: `Contacto demo ${index + 1}`,
        customerHandle: `@contacto_demo_${index + 1}`,
        text: entry.text,
        category: entry.category,
        sentiment: entry.sentiment,
        confidence: entry.confidence,
        status: "new" as const,
        source: "demo" as const,
        version: 1,
        createdAt,
        updatedAt: createdAt,
        internalNotes: [],
        audit: [{
          id: randomUUID(),
          at: createdAt,
          action: "ingested" as const,
          actor: "system" as const,
          detail: "Interacción generada por la sincronización de demostración.",
        }],
      };
    });
  });
}

function auditStep(
  node: string,
  detail: string,
  count: number,
  status: RunAuditStep["status"] = "success",
): RunAuditStep {
  return {
    id: randomUUID(),
    node,
    status,
    detail,
    count,
    at: new Date().toISOString(),
  };
}

export function simulateWorkflow(
  store: DataStore,
  accountIds: string[],
  sampleSize: number,
  demoMode: boolean,
  outboundSendsDisabled = false,
): WorkflowRun {
  const startedAt = new Date().toISOString();
  const selected = store.interactions
    .filter((item) => accountIds.includes(item.accountId) && ["new", "pending"].includes(item.status))
    .slice(0, sampleSize);
  const assessments = selected.map((item) => evaluateSacInteraction(item, store, {
    outboundSendsDisabled,
    autoSendInfrastructureReady: true,
  }));
  const sensitive = assessments.filter((assessment) => assessment.effectiveRoute === "human_review");
  const autoReplyCandidates = assessments.filter((assessment) => assessment.recommendedRoute === "auto_reply");
  const sendable = assessments.filter((assessment) => assessment.effectiveRoute === "auto_reply");
  const drafted = assessments.filter((assessment) => assessment.effectiveRoute === "draft").length;
  const knowledgeBlocked = assessments.filter((assessment) =>
    assessment.knowledge.status === "missing" || assessment.knowledge.status === "live_source_required",
  ).length;
  const finishedAt = new Date().toISOString();

  return {
    id: randomUUID(),
    kind: "simulation",
    startedAt,
    finishedAt,
    status: "success",
    workflowVersion: store.workflow.version,
    demoMode,
    accountIds,
    totals: {
      fetched: selected.length,
      created: 0,
      duplicates: 0,
      drafted,
      replied: sendable.length,
      escalated: sensitive.length,
      errors: 0,
    },
    auditTrail: [
      auditStep("Seleccionar interacciones", `${selected.length} casos incluidos en la simulación.`, selected.length),
      auditStep("Clasificar", `${selected.length - sensitive.length} casos aptos y ${sensitive.length} sensibles.`, selected.length),
      auditStep(
        "Conocimiento",
        `${knowledgeBlocked} casos requieren una respuesta aprobada o una fuente en vivo.`,
        knowledgeBlocked,
        knowledgeBlocked ? "warning" : "success",
      ),
      auditStep("Guardrails", `${sensitive.length} casos requieren revisión humana.`, sensitive.length, sensitive.length ? "warning" : "success"),
      auditStep("Preparar borradores", `${drafted} respuestas quedarían como borrador.`, drafted),
      auditStep(
        "Auto-respuesta",
        outboundSendsDisabled
          ? `${autoReplyCandidates.length} respuestas elegibles quedarían bloqueadas por el cortacorriente de envíos.`
          : `${sendable.length} respuestas serían enviadas según la allowlist.`,
        outboundSendsDisabled ? autoReplyCandidates.length : sendable.length,
        outboundSendsDisabled
          ? (autoReplyCandidates.length ? "warning" : "skipped")
          : sendable.length ? "warning" : "skipped",
      ),
      auditStep("Exportar", "El libro Excel se actualizaría al finalizar.", selected.length),
    ],
  };
}
