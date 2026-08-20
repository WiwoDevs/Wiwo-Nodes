import type { MetricoolAccountReference, MetricoolInboxProvider } from "./types.js";
import { setTimeout as delay } from "node:timers/promises";

export interface MetricoolConversationReplyPayload {
  text: string;
  conversationId: string;
  provider: MetricoolInboxProvider;
  recipient: string;
}

export interface MetricoolPostCommentReplyPayload {
  text: string;
  objectId: string;
  provider: MetricoolInboxProvider;
}

export interface MetricoolReviewReplyPayload {
  text: string;
  reviewId: string;
  provider: MetricoolInboxProvider;
  attachment?: string;
}

export interface MetricoolGateway {
  getBrand?(account: MetricoolAccountReference): Promise<unknown>;
  listConversations(account: MetricoolAccountReference, provider: MetricoolInboxProvider): Promise<unknown>;
  listPostComments(account: MetricoolAccountReference, provider: MetricoolInboxProvider): Promise<unknown>;
  listReviews(account: MetricoolAccountReference, provider: MetricoolInboxProvider): Promise<unknown>;
  replyToConversation(account: MetricoolAccountReference, payload: MetricoolConversationReplyPayload): Promise<unknown>;
  replyToPostComment(account: MetricoolAccountReference, payload: MetricoolPostCommentReplyPayload): Promise<unknown>;
  replyToReview(account: MetricoolAccountReference, payload: MetricoolReviewReplyPayload): Promise<unknown>;
}

export class MetricoolRequestError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly retryAfterMs?: number;

  constructor(status: number, endpoint: string, retryAfterMs?: number) {
    super(`Metricool respondió con estado ${status}.`);
    this.name = "MetricoolRequestError";
    this.status = status;
    this.endpoint = endpoint;
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60 * 60_000, Math.ceil(seconds * 1_000));
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return undefined;
  return Math.min(60 * 60_000, Math.max(0, at - now));
}

interface MetricoolClientOptions {
  token: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const MAX_INBOX_PAGES = 100;
const MAX_INBOX_ITEMS = 10_000;
// Metricool does not publish a fixed request quota. Keep one token at a calm,
// serialized pace and let Retry-After become the authority when it is present.
const MIN_REQUEST_INTERVAL_MS = 250;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function inboxPageNext(value: unknown): string | undefined {
  const page = objectRecord(objectRecord(value)?.page);
  const next = page?.next;
  return typeof next === "string" && next.trim() ? next.trim() : undefined;
}

function inboxPageData(value: unknown): unknown[] | undefined {
  const data = objectRecord(value)?.data;
  return Array.isArray(data) ? data : undefined;
}

export class MetricoolClient implements MetricoolGateway {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private requestQueue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;

  constructor(options: MetricoolClientOptions) {
    if (!options.token.trim()) throw new Error("Se requiere un token de Metricool.");
    this.token = options.token;
    this.baseUrl = (options.baseUrl || "https://app.metricool.com/api").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = options.timeoutMs || 15_000;
  }

  getBrand(account: MetricoolAccountReference): Promise<unknown> {
    return this.request("GET", `/v2/settings/brands/${encodeURIComponent(account.blogId)}`, account, {});
  }

  listConversations(account: MetricoolAccountReference, provider: MetricoolInboxProvider): Promise<unknown> {
    return this.requestInboxList("/v2/inbox/conversations", account, { provider });
  }

  listPostComments(account: MetricoolAccountReference, provider: MetricoolInboxProvider): Promise<unknown> {
    return this.requestInboxList("/v2/inbox/post-comments", account, { provider });
  }

  listReviews(account: MetricoolAccountReference, provider: MetricoolInboxProvider): Promise<unknown> {
    return this.requestInboxList("/v2/inbox/reviews", account, { provider });
  }

  replyToConversation(account: MetricoolAccountReference, payload: MetricoolConversationReplyPayload): Promise<unknown> {
    return this.request("POST", "/v2/inbox/conversations", account, { body: payload });
  }

  replyToPostComment(account: MetricoolAccountReference, payload: MetricoolPostCommentReplyPayload): Promise<unknown> {
    return this.request("POST", "/v2/inbox/post-comments", account, { body: payload });
  }

  replyToReview(account: MetricoolAccountReference, payload: MetricoolReviewReplyPayload): Promise<unknown> {
    return this.request("POST", "/v2/inbox/reviews/replies", account, { body: payload });
  }

  private async request(
    method: "GET" | "POST",
    endpoint: string,
    account: MetricoolAccountReference,
    input: {
      query?: Record<string, string | number | boolean | undefined>;
      body?: MetricoolConversationReplyPayload | MetricoolPostCommentReplyPayload | MetricoolReviewReplyPayload;
    },
  ): Promise<unknown> {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set("userId", account.userId);
    url.searchParams.set("blogId", account.blogId);
    for (const [key, value] of Object.entries(input.query || {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    return this.requestUrl(method, url, input.body, endpoint);
  }

  private async requestInboxList(
    endpoint: string,
    account: MetricoolAccountReference,
    query: Record<string, string | number | boolean | undefined>,
  ): Promise<unknown> {
    let url = new URL(`${this.baseUrl}${endpoint}`);
    url.searchParams.set("userId", account.userId);
    url.searchParams.set("blogId", account.blogId);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const visited = new Set<string>();
    const combined: unknown[] = [];
    let firstPage: Record<string, unknown> | undefined;

    for (let pageNumber = 1; pageNumber <= MAX_INBOX_PAGES; pageNumber += 1) {
      if (visited.has(url.href)) throw new Error("Metricool repitió el cursor de paginación.");
      visited.add(url.href);
      const payload = await this.requestUrl("GET", url, undefined, endpoint);
      const record = objectRecord(payload);
      const data = inboxPageData(payload);
      if (!record || !data) return pageNumber === 1 ? payload : { ...firstPage, data: combined };
      firstPage ||= record;
      combined.push(...data);
      if (combined.length > MAX_INBOX_ITEMS) {
        throw new Error(`Metricool superó el límite seguro de ${MAX_INBOX_ITEMS} elementos por lectura.`);
      }

      const next = inboxPageNext(payload);
      if (!next) {
        const page = objectRecord(firstPage.page);
        return {
          ...firstPage,
          data: combined,
          ...(page ? { page: { ...page, next: undefined } } : {}),
        };
      }
      url = this.resolveNextPage(next, endpoint, account, query);
    }
    throw new Error(`Metricool superó el límite seguro de ${MAX_INBOX_PAGES} páginas por lectura.`);
  }

  private resolveNextPage(
    next: string,
    endpoint: string,
    account: MetricoolAccountReference,
    query: Record<string, string | number | boolean | undefined>,
  ): URL {
    const base = new URL(this.baseUrl);
    let url: URL;
    if (/^https?:\/\//i.test(next)) url = new URL(next);
    else if (next.startsWith("/")) url = new URL(next, base.origin);
    else if (next.startsWith("?")) url = new URL(`${this.baseUrl}${endpoint}${next}`);
    else if (next.includes("=")) url = new URL(`${this.baseUrl}${endpoint}?${next}`);
    else throw new Error("Metricool entregó un cursor de paginación no reconocido.");

    const basePath = base.pathname.replace(/\/$/, "");
    if (url.origin !== base.origin || (basePath && url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`))) {
      throw new Error("Metricool entregó una página fuera del API autorizado.");
    }
    if (!url.searchParams.has("userId")) url.searchParams.set("userId", account.userId);
    if (!url.searchParams.has("blogId")) url.searchParams.set("blogId", account.blogId);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && !url.searchParams.has(key)) url.searchParams.set(key, String(value));
    }
    return url;
  }

  private async requestUrl(
    method: "GET" | "POST",
    url: URL,
    body: MetricoolConversationReplyPayload | MetricoolPostCommentReplyPayload | MetricoolReviewReplyPayload | undefined,
    endpoint: string,
  ): Promise<unknown> {
    const previous = this.requestQueue;
    let release!: () => void;
    this.requestQueue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const remainingMs = this.nextRequestAt - Date.now();
      if (remainingMs > MIN_REQUEST_INTERVAL_MS) {
        throw new MetricoolRequestError(429, endpoint, remainingMs);
      }
      if (remainingMs > 0) await delay(remainingMs);
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          Accept: "application/json",
          "X-Mc-Auth": this.token,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        // The upstream response body is deliberately not propagated: some APIs echo
        // request metadata and it must never make a credential appear in our API.
        const retryAfter = retryAfterMs(response.headers.get("retry-after"));
        this.nextRequestAt = Date.now() + (response.status === 429
          ? retryAfter ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS
          : MIN_REQUEST_INTERVAL_MS);
        throw new MetricoolRequestError(response.status, endpoint, retryAfter);
      }
      this.nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
      if (response.status === 204) return null;
      const text = await response.text();
      if (!text) return null;
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return { ok: true };
      }
    } catch (error) {
      if (error instanceof MetricoolRequestError) throw error;
      if (["AbortError", "TimeoutError"].includes((error as Error).name)) {
        throw new Error("La solicitud a Metricool excedió el tiempo máximo.");
      }
      throw new Error("No fue posible conectar con Metricool.");
    } finally {
      release();
    }
  }
}
