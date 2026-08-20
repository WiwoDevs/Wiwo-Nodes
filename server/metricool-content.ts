import {
  INTERACTION_CONTENT_KINDS,
  type InteractionContentContext,
  type InteractionContentKind,
} from "./types.js";

export const METRICOOL_UNAVAILABLE_CONTENT = "Contenido no disponible";

export type MetricoolContentKind = InteractionContentKind;

export interface MetricoolContent {
  text: string;
  kind: MetricoolContentKind;
  automatable: boolean;
  contentContext: InteractionContentContext;
}

const STORY_MENTION_CONTENT = "Mención en una historia";
const STORY_REPLY_CONTENT = "Respuesta a una historia";
const ATTACHMENT_CONTENT = "Archivo adjunto";
const UNSUPPORTED_CONTENT = "Contenido no disponible desde Metricool";
const DELETED_CONTENT = "Mensaje eliminado";
const MAX_MEDIA_URLS = 4;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function authoredText(record: Record<string, unknown>): string | undefined {
  for (const key of ["text", "message", "content", "body", "caption"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }

  for (const key of ["lastMessage", "message", "comment"]) {
    const nested = asRecord(record[key]);
    if (!nested) continue;
    for (const nestedKey of ["text", "message", "content", "body"]) {
      const value = nested[nestedKey];
      if (typeof value === "string" && value.trim()) return value;
    }
  }

  return undefined;
}

function reactionValues(record: Record<string, unknown>): string[] {
  const properties = asRecord(record.properties);
  const candidates = Array.isArray(properties?.reactions)
    ? properties.reactions
    : Array.isArray(record.reactions)
      ? record.reactions
      : [];
  const values = candidates.flatMap((candidate) => {
    if (typeof candidate === "string" && candidate.trim()) return [candidate.trim()];
    const reaction = asRecord(candidate)?.reaction;
    return typeof reaction === "string" && reaction.trim() ? [reaction.trim()] : [];
  });
  return [...new Set(values)];
}

function storyFor(record: Record<string, unknown>): Record<string, unknown> | undefined {
  return asRecord(asRecord(record.properties)?.story);
}

function hasStoryValue(story: Record<string, unknown> | undefined, key: string): boolean {
  return Boolean(
    story
    && Object.prototype.hasOwnProperty.call(story, key)
    && story[key] !== null
    && story[key] !== false,
  );
}

function attachmentCount(record: Record<string, unknown>): number {
  const attachments = Array.isArray(record.attachments) ? record.attachments : [];
  const mediaUrls = Array.isArray(record.mediaUrls) ? record.mediaUrls : [];
  const count = [...attachments, ...mediaUrls].filter((attachment) => {
    if (typeof attachment === "string") return Boolean(attachment.trim());
    const value = asRecord(attachment);
    return Boolean(value && Object.keys(value).length);
  }).length;
  return count + (typeof record.mediaUrl === "string" && record.mediaUrl.trim() ? 1 : 0);
}

function safeHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.startsWith("[")
      || !hostname.includes(".")
    ) return undefined;
    const octets = hostname.split(".").map(Number);
    if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const [first, second] = octets;
      if (
        first === 0
        || first === 10
        || first === 127
        || (first === 100 && second >= 64 && second <= 127)
        || (first === 169 && second === 254)
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168)
        || (first === 198 && (second === 18 || second === 19))
        || first >= 224
      ) return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function safeIdentifier(value: unknown): string | undefined {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  return text && text.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(text) ? text : undefined;
}

function mediaUrlsFor(
  record: Record<string, unknown>,
  story: Record<string, unknown> | undefined,
): string[] {
  const mention = asRecord(story?.mention);
  const reply = asRecord(story?.reply_to);
  const attachments = Array.isArray(record.attachments) ? record.attachments : [];
  const attachmentUrls = attachments.flatMap((attachment) => {
    if (typeof attachment === "string") return [attachment];
    const value = asRecord(attachment);
    return value ? [value.url, value.link, value.mediaUrl, value.src] : [];
  });
  const candidates = [
    reply?.link,
    reply?.url,
    mention?.link,
    mention?.url,
    ...attachmentUrls,
    ...(Array.isArray(record.mediaUrls) ? record.mediaUrls : []),
    record.mediaUrl,
  ];
  return [...new Set(candidates.map(safeHttpsUrl).filter((value): value is string => Boolean(value)))]
    .slice(0, MAX_MEDIA_URLS);
}

function contentContextFor(
  kind: InteractionContentKind,
  record: Record<string, unknown>,
  story: Record<string, unknown> | undefined,
): InteractionContentContext {
  const reply = asRecord(story?.reply_to);
  const mention = asRecord(story?.mention);
  const mediaUrls = mediaUrlsFor(record, story);
  const permalink = safeHttpsUrl(asRecord(record.properties)?.permalink)
    ?? safeHttpsUrl(record.permalink);
  const storyId = safeIdentifier(reply?.id) ?? safeIdentifier(mention?.id) ?? safeIdentifier(story?.id);
  return {
    kind,
    ...(mediaUrls.length ? { mediaUrls } : {}),
    ...(permalink ? { permalink } : {}),
    ...(storyId ? { storyId } : {}),
  };
}

function isDeleted(record: Record<string, unknown>): boolean {
  const properties = asRecord(record.properties);
  return (
    (typeof record.status === "string" && record.status.trim().toUpperCase() === "DELETED")
    || record.deleted === true
    || record.isDeleted === true
    || properties?.deleted === true
    || properties?.isDeleted === true
  );
}

function semanticContentKind(value: string): MetricoolContentKind | "legacy" | undefined {
  const normalized = value.trim();
  if (!normalized) return "unavailable";
  if (isLegacyMetricoolPlaceholder(normalized)) return "legacy";
  if (normalized === METRICOOL_UNAVAILABLE_CONTENT) return "unavailable";
  if (
    normalized === UNSUPPORTED_CONTENT
    || normalized === "Contenido no compatible con Instagram"
    || normalized === "Contenido no compatible con esta integración"
  ) return "unsupported";
  if (normalized === DELETED_CONTENT) return "deleted";
  if (normalized === STORY_REPLY_CONTENT) return "story_reply";
  if (normalized === STORY_MENTION_CONTENT) return "story_mention";
  if (/^Reacción(?: a una historia)?(?::|$)/u.test(normalized)) return "reaction";
  if (normalized === ATTACHMENT_CONTENT || /^\d+ archivos adjuntos$/u.test(normalized)) {
    return "attachment";
  }
  return undefined;
}

/**
 * Converts one Metricool message/comment payload into safe display content.
 * Literal authored text always wins and is returned without trimming or rewriting.
 */
export function normalizeMetricoolContent(record: Record<string, unknown>): MetricoolContent {
  const story = storyFor(record);
  const storyReply = hasStoryValue(story, "reply_to");
  const storyMention = hasStoryValue(story, "mention");
  const attachments = attachmentCount(record);
  if (isDeleted(record)) {
    return {
      text: DELETED_CONTENT,
      kind: "deleted",
      automatable: false,
      contentContext: { kind: "deleted" },
    };
  }
  const text = authoredText(record);
  if (text !== undefined) {
    const kind = storyReply ? "story_reply" : storyMention ? "story_mention" : attachments ? "attachment" : "text";
    return { text, kind, automatable: true, contentContext: contentContextFor(kind, record, story) };
  }

  const reactions = reactionValues(record);
  if (reactions.length) {
    return {
      text: `${storyMention ? "Reacción a una historia" : "Reacción"}: ${reactions.join(" ")}`,
      kind: "reaction",
      automatable: false,
      contentContext: contentContextFor("reaction", record, story),
    };
  }
  if (storyReply) {
    return {
      text: STORY_REPLY_CONTENT,
      kind: "story_reply",
      automatable: false,
      contentContext: contentContextFor("story_reply", record, story),
    };
  }
  if (storyMention) {
    return {
      text: STORY_MENTION_CONTENT,
      kind: "story_mention",
      automatable: false,
      contentContext: contentContextFor("story_mention", record, story),
    };
  }

  if (attachments) {
    return {
      text: attachments === 1 ? ATTACHMENT_CONTENT : `${attachments} archivos adjuntos`,
      kind: "attachment",
      automatable: false,
      contentContext: contentContextFor("attachment", record, story),
    };
  }

  const properties = asRecord(record.properties);
  if (record.is_unsupported === true || properties?.is_unsupported === true) {
    return {
      text: UNSUPPORTED_CONTENT,
      kind: "unsupported",
      automatable: false,
      contentContext: contentContextFor("unsupported", record, story),
    };
  }

  return {
    text: METRICOOL_UNAVAILABLE_CONTENT,
    kind: "unavailable",
    automatable: false,
    contentContext: contentContextFor("unavailable", record, story),
  };
}

/** Detects obsolete synthetic copy that must never reach API/UI/export output. */
export function isLegacyMetricoolPlaceholder(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return (
    /^Mensaje\s+(?:recibido|enviado)\s+(?:desde|por|v[ií]a)\s+Metricool[.!]?$/iu.test(normalized)
    || /^\[Adjunto\s+(?:recibido|enviado)\]$/iu.test(normalized)
  );
}

/**
 * Returns true when the value has no literal authored text suitable for SAC AI.
 * This includes visible semantic events such as story mentions, reactions and attachments.
 */
export function isMetricoolContentUnavailable(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return true;
  return semanticContentKind(value) !== undefined;
}

/** Replaces only obsolete/empty persistence copy; authored and semantic text stays byte-for-byte intact. */
export function metricoolContentForDisplay(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || isLegacyMetricoolPlaceholder(value)) {
    return METRICOOL_UNAVAILABLE_CONTENT;
  }
  return value;
}

export function metricoolContentContextForDisplay(
  value: unknown,
  stored?: InteractionContentContext,
): InteractionContentContext {
  const fallbackKind = semanticContentKind(typeof value === "string" ? value : "");
  const fallback: InteractionContentKind = fallbackKind && fallbackKind !== "legacy"
    ? fallbackKind
    : fallbackKind === "legacy" ? "unavailable" : "text";
  const kind = stored && INTERACTION_CONTENT_KINDS.includes(stored.kind) ? stored.kind : fallback;
  const mediaUrls = Array.isArray(stored?.mediaUrls)
    ? [...new Set(stored.mediaUrls.map(safeHttpsUrl).filter((url): url is string => Boolean(url)))].slice(0, MAX_MEDIA_URLS)
    : [];
  const permalink = safeHttpsUrl(stored?.permalink);
  return {
    kind,
    ...(mediaUrls.length ? { mediaUrls } : {}),
    ...(permalink ? { permalink } : {}),
  };
}

function contentSpecificity(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return 0;
  switch (semanticContentKind(value)) {
    case "legacy": return 0;
    case "unavailable": return 1;
    case "unsupported": return 2;
    case "deleted": return 3;
    case "attachment": return 4;
    case "story_mention": return 5;
    case "story_reply": return 6;
    case "reaction": return 7;
    default: return 10;
  }
}

/** Allows persistence to enrich synthetic content without ever overwriting real text. */
export function shouldReplaceMetricoolContent(current: unknown, incoming: unknown): boolean {
  if (typeof incoming === "string" && semanticContentKind(incoming) === "deleted") {
    return !(typeof current === "string" && semanticContentKind(current) === "deleted");
  }
  return contentSpecificity(incoming) > contentSpecificity(current);
}
