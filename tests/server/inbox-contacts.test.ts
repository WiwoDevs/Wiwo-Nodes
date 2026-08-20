import { describe, expect, it } from "vitest";
import {
  contactKeyFor,
  groupInboxContacts,
  groupInboxPosts,
  inboxPersonKey,
  interactionsForInboxPost,
  interactionsForContact,
  pendingCommentsForInboxPost,
  postKeyFor,
  publicInboxInteraction,
  publicPostContext,
} from "../../server/inbox-contacts.js";
import type { Interaction } from "../../server/types.js";

function interaction(overrides: Partial<Interaction> = {}): Interaction {
  const id = overrides.id ?? `interaction-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    externalId: `external-${id}`,
    brandId: "brand-01",
    accountId: "account-01",
    channel: "instagram",
    type: "comment",
    direction: "inbound",
    customerName: "Cliente Uno",
    customerHandle: "@cliente.uno",
    text: "Consulta",
    category: "consulta",
    sentiment: "neutral",
    confidence: 0.9,
    status: "pending",
    source: "metricool",
    version: 1,
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
    internalNotes: [],
    audit: [],
    metricoolRef: {
      actorId: "customer-1",
      threadId: "thread-1",
      postId: "post-1",
      post: { id: "post-1" },
    },
    ...overrides,
  };
}

describe("inbox contacts", () => {
  it("groups one person across comment threads while preserving an exact reply target", () => {
    const first = interaction({
      id: "comment-first",
      status: "escalated",
      createdAt: "2026-08-17T10:00:00.000Z",
      assignedTo: { userId: "agent-1", displayName: "Agente Uno" },
      metricoolRef: {
        actorId: "customer-1",
        threadId: "thread-1",
        postId: "post-1",
        post: {
          id: "post-1",
          url: "https://www.instagram.com/p/one/",
          text: "Primer post",
          mediaUrl: "https://cdn.example.test/one.jpg",
        },
      },
    });
    const latest = interaction({
      id: "comment-latest",
      status: "new",
      createdAt: "2026-08-17T11:00:00.000Z",
      assignedTo: { userId: "agent-2", displayName: "Agente Dos" },
      metricoolRef: { actorId: "customer-1", threadId: "thread-2", postId: "post-2", post: { id: "post-2" } },
    });

    const contacts = groupInboxContacts([first, latest]);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({
      contactKey: contactKeyFor(first),
      latest: { id: "comment-latest", status: "new" },
      replyTarget: {
        id: "comment-first",
        postContext: {
          postId: "post-1",
          permalink: "https://www.instagram.com/p/one/",
          caption: "Primer post",
          thumbnailUrl: "https://cdn.example.test/one.jpg",
        },
      },
      messageCount: 2,
      pendingCount: 2,
      commentCount: 2,
      threadCount: 2,
      assignmentConflict: true,
    });
    expect(contacts[0]?.replyTarget).not.toHaveProperty("metricoolRef");
    expect(interactionsForContact([first, latest], first)).toHaveLength(2);
  });

  it("keeps handle fallbacks separate by surface and never collapses generic handles", () => {
    const comment = interaction({ id: "comment-handle", metricoolRef: undefined });
    const dm = interaction({ id: "dm-handle", type: "dm", metricoolRef: undefined });
    const genericA = interaction({ id: "generic-a", customerHandle: "@usuario", metricoolRef: undefined });
    const genericB = interaction({ id: "generic-b", customerHandle: "@usuario", metricoolRef: undefined });

    expect(inboxPersonKey(comment)).not.toBe(inboxPersonKey(dm));
    expect(inboxPersonKey(genericA)).not.toBe(inboxPersonKey(genericB));
    expect(groupInboxContacts([comment, dm, genericA, genericB])).toHaveLength(4);
  });

  it("does not merge a platform actor across social accounts", () => {
    const first = interaction({ id: "account-a" });
    const second = interaction({ id: "account-b", accountId: "account-02" });
    expect(groupInboxContacts([first, second])).toHaveLength(2);
  });

  it("keeps ambiguous inbound recipients separate while grouping verified actors", () => {
    const ambiguousFirst = interaction({
      id: "ambiguous-first",
      type: "dm",
      customerHandle: "@usuario",
      metricoolRef: { recipient: "profile-brand", conversationId: "thread-first" },
    });
    const ambiguousSecond = interaction({
      id: "ambiguous-second",
      type: "dm",
      customerHandle: "@usuario",
      metricoolRef: { recipient: "profile-brand", conversationId: "thread-second" },
    });
    const verifiedFirst = interaction({
      id: "verified-first",
      type: "dm",
      metricoolRef: { actorId: "profile-client", recipient: "profile-client", conversationId: "verified-thread-first" },
    });
    const verifiedSecond = interaction({
      id: "verified-second",
      type: "dm",
      metricoolRef: { actorId: "profile-client", recipient: "profile-client", conversationId: "verified-thread-second" },
    });

    expect(groupInboxContacts([ambiguousFirst, ambiguousSecond])).toHaveLength(2);
    expect(groupInboxContacts([verifiedFirst, verifiedSecond])).toHaveLength(1);
  });

  it("publishes only HTTPS post links and media", () => {
    const item = interaction({
      metricoolRef: {
        actorId: "customer-1",
        postId: "post-http",
        post: {
          id: "post-http",
          url: "http://example.test/post",
          text: "Contexto seguro",
          mediaUrl: "http://example.test/image.jpg",
        },
      },
    });
    expect(publicPostContext(item)).toEqual({
      postId: "post-http",
      permalink: undefined,
      caption: "Contexto seguro",
      thumbnailUrl: undefined,
    });
  });

  it("never exposes legacy Metricool placeholders or stale AI proposals", () => {
    const item = interaction({
      text: "Mensaje recibido desde Metricool",
      automation: {
        protocolVersion: "sac-v1",
        evaluatedAt: "2026-08-17T10:01:00.000Z",
        intent: "otro",
        risk: "medium",
        classificationConfidence: 0.55,
        knowledge: { status: "missing", sourceIds: [] },
        conversation: {
          key: "private-thread",
          messageCount: 1,
          inboundCount: 1,
          outboundCount: 0,
          continuation: false,
        },
        replyWindow: { eligible: true, expiresAt: "2026-08-18T10:00:00.000Z" },
        recommendedRoute: "draft",
        effectiveRoute: "draft",
        reasonCodes: ["APPROVED_KNOWLEDGE_MISSING"],
        proposal: { text: "Sugerencia obsoleta", templateId: "legacy", sourceIds: [] },
      },
      responseText: "Borrador automático obsoleto",
      audit: [{
        id: "workflow-draft",
        at: "2026-08-17T10:02:00.000Z",
        action: "draft_created",
        actor: "workflow",
        detail: "Borrador automático heredado.",
      }],
    });

    expect(publicInboxInteraction(item)).toMatchObject({
      text: "Contenido no disponible",
      automation: undefined,
      responseText: undefined,
    });
    expect(groupInboxContacts([item])[0]?.latest.text).toBe("Contenido no disponible");
  });

  it("keeps a human draft for non-textual content", () => {
    const item = interaction({
      text: "Mención en una historia",
      responseText: "Respuesta redactada por una persona",
      audit: [{
        id: "human-draft",
        at: "2026-08-17T10:02:00.000Z",
        action: "draft_created",
        actor: "agent",
        detail: "Borrador humano.",
      }],
    });

    expect(publicInboxInteraction(item).responseText).toBe("Respuesta redactada por una persona");
  });

  it("groups comments by exact post and orders posts by their real publication date", () => {
    const oldPostRecentComment = interaction({
      id: "old-post-recent-comment",
      createdAt: "2026-08-18T12:00:00.000Z",
      metricoolRef: {
        actorId: "customer-1",
        postId: "post-old",
        post: { id: "post-old", text: "Post antiguo", publishedAt: "2026-08-01T09:00:00.000Z" },
      },
    });
    const newPostOlderComment = interaction({
      id: "new-post-older-comment",
      createdAt: "2026-08-12T12:00:00.000Z",
      metricoolRef: {
        actorId: "customer-2",
        postId: "post-new",
        post: { id: "post-new", text: "Post nuevo", publishedAt: "2026-08-10T09:00:00.000Z" },
      },
    });

    const posts = groupInboxPosts([oldPostRecentComment, newPostOlderComment]);

    expect(posts.map((post) => post.postContext.postId)).toEqual(["post-new", "post-old"]);
    expect(posts[0]).toMatchObject({
      publishedAt: "2026-08-10T09:00:00.000Z",
      sortAt: "2026-08-10T09:00:00.000Z",
      sortSource: "published_at",
      commentCount: 1,
      pendingCount: 1,
      teamReplyCount: 0,
    });
  });

  it("uses an explicit activity fallback and returns exact unanswered inbound comments oldest first", () => {
    const pendingOlder = interaction({
      id: "pending-older",
      createdAt: "2026-08-17T10:00:00.000Z",
      status: "drafted",
      metricoolRef: { actorId: "customer-1", postId: "post-fallback", post: { id: "post-fallback" } },
    });
    const pendingNewer = interaction({
      id: "pending-newer",
      createdAt: "2026-08-17T12:00:00.000Z",
      status: "escalated",
      metricoolRef: { actorId: "customer-2", postId: "post-fallback", post: { id: "post-fallback" } },
    });
    const answered = interaction({
      id: "answered",
      createdAt: "2026-08-17T11:00:00.000Z",
      status: "resolved",
      metricoolRef: { actorId: "customer-3", postId: "post-fallback", post: { id: "post-fallback" } },
    });
    const teamReply = interaction({
      id: "team-reply",
      direction: "outbound",
      status: "replied",
      createdAt: "2026-08-17T13:00:00.000Z",
      metricoolRef: { actorId: "customer-1", postId: "post-fallback", post: { id: "post-fallback" } },
    });
    const unrelated = interaction({
      id: "unrelated",
      metricoolRef: { actorId: "customer-4", postId: "other-post", post: { id: "other-post" } },
    });
    const all = [pendingOlder, pendingNewer, answered, teamReply, unrelated];
    const postKey = postKeyFor(pendingOlder)!;
    const summary = groupInboxPosts(all).find((post) => post.postKey === postKey)!;

    expect(summary).toMatchObject({
      publishedAt: undefined,
      latestCommentAt: "2026-08-17T12:00:00.000Z",
      sortAt: "2026-08-17T12:00:00.000Z",
      sortSource: "latest_comment_at",
      commentCount: 3,
      pendingCount: 2,
      teamReplyCount: 1,
      participantCount: 3,
    });
    expect(interactionsForInboxPost(all, postKey).map((item) => item.id)).toEqual([
      "pending-older",
      "answered",
      "pending-newer",
      "team-reply",
    ]);
    expect(pendingCommentsForInboxPost(all, postKey).map((item) => item.id)).toEqual([
      "pending-older",
      "pending-newer",
    ]);
  });
});
