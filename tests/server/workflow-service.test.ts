import { describe, expect, it } from "vitest";
import {
  mergeMissingMetricoolRef,
  normalizeMetricoolComments,
  normalizeMetricoolConnectedChannels,
  normalizeMetricoolConversations,
  normalizeMetricoolReviews,
} from "../../server/workflow-service.js";
import {
  isLegacyMetricoolPlaceholder,
  isMetricoolContentUnavailable,
  metricoolContentForDisplay,
  normalizeMetricoolContent,
  shouldReplaceMetricoolContent,
} from "../../server/metricool-content.js";
import type { Brand } from "../../server/types.js";

const brand: Brand = {
  id: "brand-contract",
  name: "Marca Contractual",
  color: "#2563eb",
  active: true,
  account: {
    id: "account-contract",
    brandId: "brand-contract",
    name: "Cuenta Contractual",
    handle: "@contractual",
    channels: ["instagram", "facebook"],
    active: true,
  },
};

describe("Metricool Inbox normalization", () => {
  it("rotates signed content URLs without mutating case state", () => {
    const current = {
      provider: "INSTAGRAM" as const,
      contentContext: {
        kind: "attachment" as const,
        mediaUrls: [1, 2, 3, 4].map((id) => `https://cdn.example.test/media/${id}?token=old`),
        permalink: "https://www.instagram.com/stories/example/1/?token=old",
      },
    };
    const currentSnapshot = structuredClone(current);
    const incoming = {
      provider: "INSTAGRAM" as const,
      contentContext: {
        kind: "attachment" as const,
        mediaUrls: [1, 2, 3, 4].map((id) => `https://cdn.example.test/media/${id}?token=new`),
        permalink: "https://www.instagram.com/stories/example/1/?token=new",
      },
    };
    const caseState = { status: "drafted", version: 7, metricoolRef: current };

    const merged = mergeMissingMetricoolRef(current, incoming);
    const enrichedCase = { ...caseState, metricoolRef: merged.value };

    expect(merged.changed).toBe(true);
    expect(merged.value?.contentContext).toEqual(incoming.contentContext);
    expect(current).toEqual(currentSnapshot);
    expect(enrichedCase).toMatchObject({ status: "drafted", version: 7 });
  });

  it("tombstones deleted content without retaining stale media", () => {
    const current = {
      provider: "INSTAGRAM" as const,
      contentContext: {
        kind: "text" as const,
        mediaUrls: ["https://cdn.example.test/media/1?token=old"],
        permalink: "https://www.instagram.com/stories/example/1/",
        storyId: "story-1",
      },
    };
    const currentSnapshot = structuredClone(current);
    const caseState = { status: "drafted", version: 4, metricoolRef: current };

    const merged = mergeMissingMetricoolRef(current, {
      provider: "INSTAGRAM",
      contentContext: {
        kind: "deleted",
        mediaUrls: ["https://cdn.example.test/media/1?token=new"],
        permalink: "https://www.instagram.com/stories/example/1/?token=new",
        storyId: "story-1",
      },
    });
    const enrichedCase = { ...caseState, metricoolRef: merged.value };

    expect(merged.value?.contentContext).toEqual({ kind: "deleted" });
    expect(merged.changed).toBe(true);
    expect(current).toEqual(currentSnapshot);
    expect(enrichedCase).toMatchObject({ status: "drafted", version: 4 });
  });

  it("preserves authored text exactly and gives it precedence over metadata", () => {
    const content = normalizeMetricoolContent({
      text: "  Texto real con  espacios  ",
      attachments: ["https://cdn.example.test/image.jpg"],
      properties: {
        is_unsupported: true,
        story: { mention: { id: "story-1" } },
        reactions: [{ reaction: "❤️" }],
      },
    });

    expect(content).toEqual({
      text: "  Texto real con  espacios  ",
      kind: "story_mention",
      automatable: true,
      contentContext: {
        kind: "story_mention",
        mediaUrls: ["https://cdn.example.test/image.jpg"],
        storyId: "story-1",
      },
    });
  });

  it("keeps safe attachment and story context without replacing authored text", () => {
    const storyReply = normalizeMetricoolContent({
      text: "¿Todavía tienen este producto?",
      attachments: [
        "https://cdn.example.test/one.jpg",
        "javascript:alert(1)",
        "http://cdn.example.test/insecure.jpg",
        "https://cdn.example.test/two.jpg",
        "https://cdn.example.test/three.jpg",
        "https://cdn.example.test/four.jpg",
        "https://cdn.example.test/five.jpg",
      ],
      properties: {
        permalink: "https://www.instagram.com/p/example/",
        story: { reply_to: { id: "story-reply-1", link: "https://cdn.example.test/story.mp4" } },
      },
    });

    expect(storyReply).toEqual({
      text: "¿Todavía tienen este producto?",
      kind: "story_reply",
      automatable: true,
      contentContext: {
        kind: "story_reply",
        mediaUrls: [
          "https://cdn.example.test/story.mp4",
          "https://cdn.example.test/one.jpg",
          "https://cdn.example.test/two.jpg",
          "https://cdn.example.test/three.jpg",
        ],
        permalink: "https://www.instagram.com/p/example/",
        storyId: "story-reply-1",
      },
    });
  });

  it("distinguishes empty story replies, deleted messages and top-level comment media", () => {
    expect(normalizeMetricoolContent({
      text: "",
      properties: { story: { reply_to: { id: "story-2", link: "https://cdn.example.test/reply.jpeg" } } },
    })).toEqual({
      text: "Respuesta a una historia",
      kind: "story_reply",
      automatable: false,
      contentContext: {
        kind: "story_reply",
        mediaUrls: ["https://cdn.example.test/reply.jpeg"],
        storyId: "story-2",
      },
    });

    expect(normalizeMetricoolContent({ status: "DELETED" })).toEqual({
      text: "Mensaje eliminado",
      kind: "deleted",
      automatable: false,
      contentContext: { kind: "deleted" },
    });
    expect(normalizeMetricoolContent({ status: "DELETED", text: "Texto que ya fue eliminado" })).toEqual({
      text: "Mensaje eliminado",
      kind: "deleted",
      automatable: false,
      contentContext: { kind: "deleted" },
    });

    expect(normalizeMetricoolContent({
      mediaUrl: "https://cdn.example.test/comment.png",
      properties: { permalink: "https://www.facebook.com/example/posts/1" },
    })).toEqual({
      text: "Archivo adjunto",
      kind: "attachment",
      automatable: false,
      contentContext: {
        kind: "attachment",
        mediaUrls: ["https://cdn.example.test/comment.png"],
        permalink: "https://www.facebook.com/example/posts/1",
      },
    });
  });

  it("accepts object attachments but rejects private or credentialed media URLs", () => {
    const content = normalizeMetricoolContent({
      attachments: [
        { url: "https://cdn.example.test/object.jpg" },
        { link: "https://media.example.test/object.mp4" },
        "https://user:password@cdn.example.test/secret.jpg",
        "https://127.0.0.1/internal.jpg",
        "https://localhost/internal.jpg",
        "https://192.168.1.10/internal.jpg",
      ],
    });

    expect(content.kind).toBe("attachment");
    expect(content.contentContext.mediaUrls).toEqual([
      "https://cdn.example.test/object.jpg",
      "https://media.example.test/object.mp4",
    ]);
  });

  it("represents non-text Instagram events without inventing received or sent messages", () => {
    const result = normalizeMetricoolConversations({
      data: [{
        id: "conversation-semantic",
        self: "profile-brand",
        provider: "INSTAGRAM",
        participants: [
          { id: "profile-brand", name: "Marca" },
          { id: "profile-client", name: "Cliente" },
        ],
        messages: [
          {
            id: "story-mention",
            from: "profile-client",
            to: "profile-brand",
            text: "",
            properties: { story: { mention: { id: "story-1", link: "" } } },
          },
          {
            id: "story-reaction",
            from: "profile-brand",
            to: "profile-client",
            text: "",
            properties: {
              story: { mention: { id: "story-1" } },
              reactions: [{ reaction: "❤️" }, { reaction: "❤️" }],
            },
          },
          {
            id: "attachment",
            from: "profile-client",
            to: "profile-brand",
            attachments: ["https://cdn.example.test/image.jpg"],
          },
          {
            id: "unsupported",
            from: "profile-client",
            to: "profile-brand",
            properties: { is_unsupported: true },
          },
          {
            id: "empty-outbound",
            from: "profile-brand",
            to: "profile-client",
          },
        ],
      }],
    }, brand, "INSTAGRAM");

    expect(result.map(({ externalId, direction, text }) => ({ externalId, direction, text }))).toEqual([
      { externalId: "story-mention", direction: "inbound", text: "Mención en una historia" },
      { externalId: "story-reaction", direction: "outbound", text: "Reacción a una historia: ❤️" },
      { externalId: "attachment", direction: "inbound", text: "Archivo adjunto" },
      { externalId: "unsupported", direction: "inbound", text: "Contenido no disponible desde Metricool" },
      { externalId: "empty-outbound", direction: "outbound", text: "Contenido no disponible" },
    ]);
    expect(result.find((item) => item.externalId === "story-mention")?.metricoolRef?.contentContext).toEqual({
      kind: "story_mention",
      storyId: "story-1",
    });
    expect(result.find((item) => item.externalId === "attachment")?.metricoolRef?.contentContext).toEqual({
      kind: "attachment",
      mediaUrls: ["https://cdn.example.test/image.jpg"],
    });
    expect(JSON.stringify(result)).not.toMatch(/Mensaje (?:recibido|enviado) desde Metricool/iu);
  });

  it("classifies legacy and semantic-only copy for safe enrichment and AI guards", () => {
    expect(isLegacyMetricoolPlaceholder("Mensaje recibido desde Metricool")).toBe(true);
    expect(isLegacyMetricoolPlaceholder("Mensaje enviado vía Metricool.")).toBe(true);
    expect(isLegacyMetricoolPlaceholder("[Adjunto recibido]")).toBe(true);
    expect(isLegacyMetricoolPlaceholder("Texto escrito por una persona")).toBe(false);

    for (const value of [
      "",
      "Mensaje recibido desde Metricool",
      "Contenido no disponible",
      "Contenido no compatible con Instagram",
      "Contenido no disponible desde Metricool",
      "Mención en una historia",
      "Respuesta a una historia",
      "Reacción a una historia: ❤️",
      "Archivo adjunto",
      "2 archivos adjuntos",
      "Mensaje eliminado",
    ]) {
      expect(isMetricoolContentUnavailable(value), value).toBe(true);
    }
    expect(isMetricoolContentUnavailable("¿Tienen stock?")).toBe(false);

    expect(metricoolContentForDisplay("Mensaje recibido desde Metricool")).toBe("Contenido no disponible");
    expect(metricoolContentForDisplay("  ")).toBe("Contenido no disponible");
    expect(metricoolContentForDisplay("Mención en una historia")).toBe("Mención en una historia");
    expect(metricoolContentForDisplay("  Texto exacto  ")).toBe("  Texto exacto  ");

    expect(shouldReplaceMetricoolContent("Mensaje recibido desde Metricool", "Mención en una historia")).toBe(true);
    expect(shouldReplaceMetricoolContent("Mención en una historia", "¿Tienen stock?")).toBe(true);
    expect(shouldReplaceMetricoolContent("¿Tienen stock?", "Mensaje eliminado")).toBe(true);
    expect(shouldReplaceMetricoolContent("¿Tienen stock?", "Contenido no disponible")).toBe(false);
    expect(shouldReplaceMetricoolContent("Respuesta original", "Respuesta diferente")).toBe(false);
  });

  it("discovers every supported connected network from Brand.networksData", () => {
    expect(normalizeMetricoolConnectedChannels({
      data: {
        networksData: {
          instagramData: "encrypted-instagram-reference",
          facebookData: "{}",
          twitterData: "encrypted-x-reference",
          tiktokData: "encrypted-tiktok-reference",
          youtubeData: null,
          linkedinData: "encrypted-linkedin-reference",
          gbpData: "encrypted-google-reference",
        },
      },
    })).toEqual(["instagram", "x", "tiktok", "linkedin", "google_business"]);
  });

  it("maps official Conversation messages, participants, direction and reply references", () => {
    const result = normalizeMetricoolConversations({
      data: [{
        id: "conversation-123",
        self: "profile-brand",
        provider: "INSTAGRAMBUSINESS",
        status: "PENDING",
        participants: [
          { id: "profile-brand", name: "Marca" },
          { id: "profile-client", name: "Ana Cliente", username: "ana.cliente", email: "must-not-be-stored@example.test" },
        ],
        messages: [
          {
            id: "message-in",
            from: "profile-client",
            to: "profile-brand",
            text: "¿Tienen stock?",
            publicationDateTime: "2026-08-12T10:00:00.000Z",
            attachments: [],
          },
          {
            id: "message-out",
            from: "profile-brand",
            to: "profile-client",
            text: "Sí, tenemos stock.",
            publicationDateTime: "2026-08-12T10:02:00.000Z",
            attachments: [],
          },
        ],
      }],
    }, brand);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      externalId: "message-in",
      channel: "instagram",
      type: "dm",
      direction: "inbound",
      customerName: "Ana Cliente",
      customerHandle: "ana.cliente",
      text: "¿Tienen stock?",
      createdAt: "2026-08-12T10:00:00.000Z",
      status: "new",
      metricoolRef: {
        provider: "INSTAGRAMBUSINESS",
        conversationId: "conversation-123",
        recipient: "profile-client",
        actorId: "profile-client",
      },
    });
    expect(result[1]).toMatchObject({
      externalId: "message-out",
      direction: "outbound",
      customerName: "Ana Cliente",
      text: "Sí, tenemos stock.",
      status: "replied",
      metricoolRef: { recipient: "profile-client" },
    });
  });

  it("does not expose brand-authored messages as actionable inbound items when self is absent", () => {
    const result = normalizeMetricoolConversations({
      data: [{
        id: "conversation-without-self",
        provider: "INSTAGRAMBUSINESS",
        participants: [
          { id: "profile-brand", username: "contractual" },
          { id: "profile-client", username: "clienta" },
        ],
        messages: [
          {
            id: "message-by-marker",
            from: "unknown-brand-id",
            to: "profile-client",
            fromMe: true,
            text: "Respuesta del equipo",
          },
          {
            id: "message-by-brand-participant",
            from: "profile-brand",
            to: "profile-client",
            text: "Otra respuesta del equipo",
          },
          {
            id: "message-by-brand-author",
            from: { id: "different-brand-id", username: "contractual" },
            to: "profile-client",
            text: "Respuesta con autor de marca",
          },
          {
            id: "message-explicitly-inbound",
            from: "profile-client",
            to: "profile-brand",
            fromMe: false,
            text: "Consulta de la clienta",
          },
          {
            id: "message-ambiguous",
            text: "Dirección sin evidencia",
          },
        ],
      }],
    }, brand);

    expect(result.map(({ externalId, direction, status }) => ({ externalId, direction, status }))).toEqual([
      { externalId: "message-by-marker", direction: "outbound", status: "replied" },
      { externalId: "message-by-brand-participant", direction: "outbound", status: "replied" },
      { externalId: "message-by-brand-author", direction: "outbound", status: "replied" },
      { externalId: "message-explicitly-inbound", direction: "inbound", status: "new" },
      { externalId: "message-ambiguous", direction: "outbound", status: "replied" },
    ]);
  });

  it("does not promote an inbound self recipient to a verified customer identity", () => {
    const result = normalizeMetricoolConversations({
      data: [
        {
          id: "legacy-message-one",
          conversationId: "legacy-thread-one",
          self: "profile-brand",
          recipient: "profile-brand",
          text: "Primera consulta sin autor",
          createdAt: "2026-08-12T10:00:00.000Z",
        },
        {
          id: "legacy-message-two",
          conversationId: "legacy-thread-two",
          self: "profile-brand",
          recipient: "profile-brand",
          text: "Segunda consulta sin autor",
          createdAt: "2026-08-12T10:01:00.000Z",
        },
      ],
    }, brand);

    expect(result).toHaveLength(2);
    expect(result.map((interaction) => interaction.metricoolRef)).toEqual([
      expect.objectContaining({ conversationId: "legacy-thread-one", recipient: undefined, actorId: undefined }),
      expect.objectContaining({ conversationId: "legacy-thread-two", recipient: undefined, actorId: undefined }),
    ]);
    expect(result.map((interaction) => interaction.customerHandle)).toEqual(["@usuario", "@usuario"]);
  });

  it("expands official PostCommentsThread root and replies into individual interactions", () => {
    const result = normalizeMetricoolComments({
      data: [{
        id: "thread-456",
        self: "page-brand",
        provider: "FACEBOOK",
        status: "READ",
        participants: [
          { id: "page-brand", name: "Marca" },
          { id: "profile-client", name: "Benjamín Cliente", username: "benja", email: "must-not-be-stored@example.test" },
        ],
        root: {
          id: "comment-root",
          element: {
            id: "post-789",
            link: "https://www.instagram.com/p/example/",
            text: "Publicación de contexto",
            mediaUrls: ["https://cdn.example.test/post.jpg", "https://cdn.example.test/second.jpg"],
            publicationDateTime: "2026-08-10T09:00:00.000Z",
            commentCount: 42,
            reactionCount: 15,
          },
          owner: "profile-client",
          text: "¿Despachan a regiones?",
          creationDate: "2026-08-12T11:00:00.000Z",
          comments: [{
            id: "comment-reply",
            parentId: "comment-root",
            owner: "page-brand",
            text: "Sí, despachamos a todo Chile.",
            creationDate: "2026-08-12T11:03:00.000Z",
          }],
        },
      }],
    }, brand);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      externalId: "comment-root",
      channel: "facebook",
      type: "comment",
      direction: "inbound",
      customerName: "Benjamín Cliente",
      status: "pending",
      metricoolRef: {
        provider: "FACEBOOK",
        objectId: "comment-root",
        commentId: "comment-root",
        postId: "post-789",
        actorId: "profile-client",
        threadId: "thread-456",
        post: {
          id: "post-789",
          url: "https://www.instagram.com/p/example/",
          text: "Publicación de contexto",
          mediaUrl: "https://cdn.example.test/post.jpg",
          publishedAt: "2026-08-10T09:00:00.000Z",
        },
      },
    });
    expect(result[1]).toMatchObject({
      externalId: "comment-reply",
      direction: "outbound",
      customerName: "Benjamín Cliente",
      status: "replied",
      metricoolRef: {
        provider: "FACEBOOK",
        objectId: "comment-reply",
        postId: "post-789",
        actorId: "profile-client",
        threadId: "thread-456",
        parentCommentId: "comment-root",
      },
    });
    expect(JSON.stringify(result)).not.toContain("must-not-be-stored@example.test");
    expect(JSON.stringify(result)).not.toContain("reactionCount");
  });

  it("infers comment direction from the brand participant when self is absent", () => {
    const result = normalizeMetricoolComments({
      data: [{
        id: "thread-without-self",
        provider: "INSTAGRAMBUSINESS",
        participants: [
          { id: "profile-brand", username: "contractual" },
          { id: "profile-client", username: "clienta" },
        ],
        root: {
          id: "comment-client",
          owner: "profile-client",
          text: "Consulta de la clienta",
          comments: [{
            id: "comment-brand",
            owner: "profile-brand",
            text: "Respuesta de la marca",
          }],
        },
      }],
    }, brand);

    expect(result.map(({ externalId, direction, status }) => ({ externalId, direction, status }))).toEqual([
      { externalId: "comment-client", direction: "inbound", status: "new" },
      { externalId: "comment-brand", direction: "outbound", status: "replied" },
    ]);
  });

  it("drops unsafe post and media URLs without inventing replacements", () => {
    const result = normalizeMetricoolComments({
      data: [{
        id: "unsafe-thread",
        self: "page-brand",
        provider: "FACEBOOK",
        participants: [{ id: "page-brand" }, { id: "customer-unsafe", name: "Cliente" }],
        root: {
          id: "unsafe-comment",
          owner: "customer-unsafe",
          element: {
            id: "unsafe-post",
            link: "javascript:alert(1)",
            text: "Post sin enlace seguro",
            mediaUrls: ["data:image/png;base64,unsafe"],
          },
          text: "Comentario",
          creationDate: "2026-08-12T11:00:00.000Z",
          comments: [],
        },
      }],
    }, brand);

    expect(result[0]?.metricoolRef?.post).toEqual({
      id: "unsafe-post",
      url: undefined,
      text: "Post sin enlace seguro",
      mediaUrl: undefined,
    });
  });

  it("uses the requested provider when TikTok comment payloads omit it", () => {
    const result = normalizeMetricoolComments({
      data: [{
        id: "tiktok-comment",
        owner: { id: "customer", name: "Cliente TikTok" },
        text: "¿Dónde lo encuentro?",
        creationDate: "2026-08-12T12:00:00.000Z",
      }],
    }, brand, "TIKTOKBUSINESS");

    expect(result[0]).toMatchObject({
      channel: "tiktok",
      type: "comment",
      metricoolRef: { provider: "TIKTOKBUSINESS" },
    });
  });

  it("maps X conversations to direct messages", () => {
    const result = normalizeMetricoolConversations({
      data: [{ id: "x-message", text: "Necesito ayuda", createdAt: "2026-08-12T12:00:00.000Z" }],
    }, brand, "TWITTER");

    expect(result[0]).toMatchObject({ channel: "x", type: "dm", metricoolRef: { provider: "TWITTER" } });
  });

  it("maps Google Business reviews and their existing replies", () => {
    const result = normalizeMetricoolReviews({
      data: [{
        id: "review-internal",
        providerId: "review-123",
        provider: "GMB",
        status: "PENDING",
        creationDate: "2026-08-12T13:00:00.000Z",
        participants: [{ id: "reviewer", name: "Cliente Google" }],
        message: "Excelente atención",
        stars: 5,
        reply: { comment: "Gracias por visitarnos", updateTime: "2026-08-12T14:00:00.000Z" },
      }],
    }, brand);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      externalId: "review-123",
      channel: "google_business",
      type: "review",
      direction: "inbound",
      sentiment: "positive",
      category: "resena_5_estrellas",
      metricoolRef: { provider: "GMB", objectId: "review-123" },
    });
    expect(result[1]).toMatchObject({
      externalId: "review-123:reply",
      type: "review",
      direction: "outbound",
      status: "replied",
    });
  });
});
