import { describe, expect, it, vi } from "vitest";
import { MetricoolClient, MetricoolRequestError } from "../../server/metricool-client.js";

describe("MetricoolClient", () => {
  it("reads the Metricool brand settings used to discover connected networks", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { id: 9 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
    const client = new MetricoolClient({ token: "secret-token", baseUrl: "https://metricool.test/api/", fetchImpl: fetchMock });

    await client.getBrand({ userId: "7", blogId: "9" });

    expect((fetchMock.mock.calls[0][0] as URL).pathname).toBe("/api/v2/settings/brands/9");
    expect((fetchMock.mock.calls[0][0] as URL).searchParams.get("userId")).toBe("7");
  });

  it("calls every inbox endpoint with X-Mc-Auth, userId and blogId", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
    const client = new MetricoolClient({
      token: "secret-token",
      baseUrl: "https://metricool.test/api/",
      fetchImpl: fetchMock,
    });
    const account = { userId: "user-7", blogId: "blog-9" };

    await client.listConversations(account, "INSTAGRAMBUSINESS");
    await client.listPostComments(account, "FACEBOOK");
    await client.listReviews(account, "GMB");
    await client.replyToConversation(account, {
      conversationId: "conversation-1",
      provider: "INSTAGRAMBUSINESS",
      recipient: "customer-1",
      text: "Hola",
    });
    await client.replyToPostComment(account, {
      objectId: "comment-1",
      provider: "FACEBOOK",
      text: "Gracias",
    });
    await client.replyToReview(account, {
      reviewId: "review-1",
      provider: "GMB",
      text: "Gracias por tu reseña",
    });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    const paths = fetchMock.mock.calls.map(([url]) => (url as URL).pathname);
    expect(paths).toEqual([
      "/api/v2/inbox/conversations",
      "/api/v2/inbox/post-comments",
      "/api/v2/inbox/reviews",
      "/api/v2/inbox/conversations",
      "/api/v2/inbox/post-comments",
      "/api/v2/inbox/reviews/replies",
    ]);
    for (const [url, init] of fetchMock.mock.calls) {
      const parsed = url as URL;
      expect(parsed.searchParams.get("userId")).toBe("user-7");
      expect(parsed.searchParams.get("blogId")).toBe("blog-9");
      expect(new Headers((init as RequestInit).headers).get("X-Mc-Auth")).toBe("secret-token");
    }
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("GET");
    expect((fetchMock.mock.calls[0][0] as URL).searchParams.get("provider")).toBe("INSTAGRAMBUSINESS");
    expect((fetchMock.mock.calls[1][0] as URL).searchParams.get("provider")).toBe("FACEBOOK");
    expect((fetchMock.mock.calls[2][0] as URL).searchParams.get("provider")).toBe("GMB");
    expect((fetchMock.mock.calls[3][1] as RequestInit).method).toBe("POST");
    expect((fetchMock.mock.calls[3][1] as RequestInit).body).toBe(JSON.stringify({
      conversationId: "conversation-1",
      provider: "INSTAGRAMBUSINESS",
      recipient: "customer-1",
      text: "Hola",
    }));
    expect((fetchMock.mock.calls[4][1] as RequestInit).body).toBe(JSON.stringify({
      objectId: "comment-1",
      provider: "FACEBOOK",
      text: "Gracias",
    }));
    expect((fetchMock.mock.calls[5][1] as RequestInit).body).toBe(JSON.stringify({
      reviewId: "review-1",
      provider: "GMB",
      text: "Gracias por tu reseña",
    }));
  });

  it("does not include the API token in upstream errors", async () => {
    const token = "super-secret";
    const fetchMock = vi.fn(async () => new Response(`echo ${token}`, { status: 401 })) as unknown as typeof fetch;
    const client = new MetricoolClient({ token, fetchImpl: fetchMock });
    let error: unknown;
    try {
      await client.listConversations({ userId: "1", blogId: "2" }, "INSTAGRAMBUSINESS");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(MetricoolRequestError);
    expect(JSON.stringify(error)).not.toContain(token);
    expect((error as Error).message).not.toContain(token);
  });

  it("follows same-origin Inbox pagination and merges every page", async () => {
    const fetchMock = vi.fn(async (url: URL) => {
      const cursor = url.searchParams.get("cursor");
      return new Response(JSON.stringify(cursor ? {
        data: [{ id: "thread-2" }],
        page: {},
      } : {
        data: [{ id: "thread-1" }],
        page: { next: "/api/v2/inbox/post-comments?cursor=second" },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const client = new MetricoolClient({ token: "secret-token", baseUrl: "https://metricool.test/api", fetchImpl: fetchMock });

    const payload = await client.listPostComments({ userId: "7", blogId: "9" }, "INSTAGRAM") as {
      data: Array<{ id: string }>;
    };

    expect(payload.data.map((item) => item.id)).toEqual(["thread-1", "thread-2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = fetchMock.mock.calls[1][0] as URL;
    expect(secondUrl.origin).toBe("https://metricool.test");
    expect(secondUrl.searchParams.get("userId")).toBe("7");
    expect(secondUrl.searchParams.get("blogId")).toBe("9");
    expect(secondUrl.searchParams.get("provider")).toBe("INSTAGRAM");
  });

  it("never forwards the Metricool token to a cross-origin next page", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [],
      page: { next: "https://attacker.example/collect" },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
    const client = new MetricoolClient({ token: "secret-token", fetchImpl: fetchMock });

    await expect(client.listPostComments({ userId: "7", blogId: "9" }, "INSTAGRAM"))
      .rejects.toThrow("fuera del API autorizado");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves a sanitized Retry-After duration for provider backpressure", async () => {
    const fetchMock = vi.fn(async () => new Response("quota", {
      status: 429,
      headers: { "Retry-After": "7" },
    })) as unknown as typeof fetch;
    const client = new MetricoolClient({ token: "secret-token", fetchImpl: fetchMock });

    await expect(client.replyToConversation(
      { userId: "1", blogId: "2" },
      { conversationId: "conversation", provider: "INSTAGRAMBUSINESS", recipient: "customer", text: "Hola" },
    )).rejects.toMatchObject({ status: 429, retryAfterMs: 7_000 });
  });

  it("does not make another upstream request while Metricool's Retry-After is active", async () => {
    const fetchMock = vi.fn(async () => new Response("quota", {
      status: 429,
      headers: { "Retry-After": "7" },
    })) as unknown as typeof fetch;
    const client = new MetricoolClient({ token: "secret-token", fetchImpl: fetchMock });
    const account = { userId: "1", blogId: "2" };

    await expect(client.listConversations(account, "INSTAGRAMBUSINESS"))
      .rejects.toMatchObject({ status: 429, retryAfterMs: 7_000 });
    await expect(client.listPostComments(account, "INSTAGRAM"))
      .rejects.toMatchObject({ status: 429, retryAfterMs: expect.any(Number) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
