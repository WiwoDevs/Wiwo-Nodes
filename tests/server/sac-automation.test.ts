import { describe, expect, it } from "vitest";
import {
  detectConversationResponses,
  evaluateSacInteraction,
  processSacInteractions,
  reconcileConversationResponses,
} from "../../server/sac-automation.js";
import { createDemoStore } from "../../server/seed.js";
import type { Interaction } from "../../server/types.js";

const now = new Date("2026-08-13T14:00:00.000Z");

function interaction(text: string): Interaction {
  return {
    id: `test-${Math.random()}`,
    externalId: `external-${Math.random()}`,
    brandId: "brand-01",
    accountId: "account-01",
    channel: "instagram",
    type: "dm",
    direction: "inbound",
    customerName: "Ana Cliente",
    customerHandle: "@ana",
    text,
    category: "sin_clasificar",
    sentiment: "neutral",
    confidence: 0,
    status: "new",
    source: "demo",
    version: 1,
    createdAt: "2026-08-13T13:55:00.000Z",
    updatedAt: "2026-08-13T13:55:00.000Z",
    internalNotes: [],
    audit: [],
  };
}

function readyStore() {
  const store = createDemoStore(now);
  store.workflow.autoReplyEnabled = true;
  store.workflow.autoReplyAccountIds = ["account-01"];
  return store;
}

describe("SAC automation protocol", () => {
  it("uses approved brand knowledge but retains the candidate until delivery outbox exists", () => {
    const store = readyStore();
    const item = interaction("¿Cuál es el horario de atención?");
    store.interactions.push(item);

    const result = evaluateSacInteraction(item, store, { evaluatedAt: now });

    expect(result).toMatchObject({
      intent: "horarios",
      knowledge: { status: "approved" },
      recommendedRoute: "auto_reply",
      effectiveRoute: "draft",
    });
    expect(result.reasonCodes).toContain("DELIVERY_OUTBOX_NOT_READY");
    expect(result.proposal?.text).toContain("lunes a jueves");
  });

  it("keeps eligible replies in shadow mode until live dispatch is explicitly armed", () => {
    const store = readyStore();
    const item = interaction("¿Cuál es el horario de atención?");
    store.interactions.push(item);

    const shadow = evaluateSacInteraction(item, store, {
      evaluatedAt: now,
      autoSendInfrastructureReady: true,
      autoReplyDispatchMode: "shadow",
    });
    const live = evaluateSacInteraction(item, store, {
      evaluatedAt: now,
      autoSendInfrastructureReady: true,
      autoReplyDispatchMode: "live",
    });

    expect(shadow.effectiveRoute).toBe("draft");
    expect(shadow.reasonCodes).toContain("AUTO_REPLY_SHADOW_MODE");
    expect(live.effectiveRoute).toBe("auto_reply");
  });

  it("queues a safe candidate only when the live delivery path is ready", () => {
    const store = readyStore();
    const item = interaction("Hola");
    store.interactions.push(item);

    const result = processSacInteractions(store, [item.id], {
      evaluatedAt: now,
      autoSendInfrastructureReady: true,
      autoReplyDispatchMode: "live",
    });

    expect(result).toMatchObject({ evaluated: 1, drafted: 0, queuedAutoReplies: 1 });
    expect(item).toMatchObject({ status: "pending", version: 2 });
    expect(item.audit.at(-1)?.metadata).toMatchObject({ queued: true });
  });

  it("requires a live source for price and stock facts", () => {
    const store = readyStore();
    const item = interaction("¿Cuál es el precio y tienen stock?");
    store.interactions.push(item);

    const result = evaluateSacInteraction(item, store, { evaluatedAt: now });

    expect(result.knowledge.status).toBe("live_source_required");
    expect(result.effectiveRoute).toBe("draft");
    expect(result.reasonCodes).toContain("LIVE_SOURCE_REQUIRED");
  });

  it("routes complaints to mandatory human review", () => {
    const store = readyStore();
    const item = interaction("Mi pedido no llegó, pésimo servicio. Quiero hacer un reclamo.");
    store.interactions.push(item);

    const result = evaluateSacInteraction(item, store, { evaluatedAt: now });

    expect(result).toMatchObject({ intent: "reclamo", risk: "high", effectiveRoute: "human_review" });
    expect(result.reasonCodes).toContain("SENSITIVE_OR_NEGATIVE");
  });

  it("keeps public reviews in human approval even when positive", () => {
    const store = readyStore();
    const item = interaction("Excelente atención, muchas gracias");
    item.channel = "google_business";
    item.type = "review";
    item.metricoolRef = { provider: "GMB", objectId: "review-1" };
    store.interactions.push(item);

    const result = evaluateSacInteraction(item, store, { evaluatedAt: now });

    expect(result.effectiveRoute).toBe("human_review");
    expect(result.replyWindow.eligible).toBe(true);
    expect(result.reasonCodes).toContain("PUBLIC_REVIEW_REQUIRES_APPROVAL");
  });

  it("applies the Meta reply deadline only to Instagram and Facebook", () => {
    const store = readyStore();
    const oldInstagramDm = interaction("Hola");
    oldInstagramDm.createdAt = "2026-08-01T12:00:00.000Z";
    const oldXMessage = interaction("Hola");
    oldXMessage.id = "old-x-message";
    oldXMessage.channel = "x";
    oldXMessage.createdAt = "2026-08-01T12:00:00.000Z";
    store.interactions.push(oldInstagramDm, oldXMessage);

    const instagramAssessment = evaluateSacInteraction(oldInstagramDm, store, { evaluatedAt: now });
    const xAssessment = evaluateSacInteraction(oldXMessage, store, { evaluatedAt: now });

    expect(instagramAssessment.replyWindow.eligible).toBe(false);
    expect(instagramAssessment.reasonCodes).toContain("REPLY_WINDOW_EXPIRED");
    expect(xAssessment.replyWindow.eligible).toBe(true);
    expect(xAssessment.reasonCodes).not.toContain("REPLY_WINDOW_EXPIRED");
  });

  it("persists classification, proposal and audit as one local protocol step", () => {
    const store = readyStore();
    const item = interaction("Hola");
    store.interactions.push(item);

    const result = processSacInteractions(store, [item.id], { evaluatedAt: now });

    expect(result).toMatchObject({ evaluated: 1, drafted: 1, autoReplyCandidates: 1 });
    expect(item).toMatchObject({ category: "saludo", status: "drafted", version: 2 });
    expect(item.responseText).toContain("¿En qué podemos ayudarte?");
    expect(item.audit.map((entry) => entry.action)).toEqual([
      "classified",
      "automation_evaluated",
      "draft_created",
    ]);
  });

  it.each([
    "",
    "   ",
    "Mensaje recibido desde Metricool",
    "Mensaje enviado desde Metricool",
    "Contenido no disponible",
    "Contenido no compatible con Instagram",
    "Mención en una historia",
    "Reacción a una historia: ❤️",
    "Archivo adjunto",
    "[Adjunto recibido]",
  ])("does not classify or recommend a reply for non-textual provider content: %s", (text) => {
    const store = readyStore();
    const item = interaction(text);
    store.interactions.push(item);

    const result = evaluateSacInteraction(item, store, { evaluatedAt: now });

    expect(result).toMatchObject({
      intent: "sin_clasificar",
      classificationConfidence: 0,
      knowledge: { status: "not_required", sourceIds: [] },
      recommendedRoute: "ignore",
      effectiveRoute: "ignore",
      reasonCodes: ["NON_ACTIONABLE_CONTENT"],
    });
    expect(result.proposal).toBeUndefined();
  });

  it("leaves provider events unchanged when the SAC protocol is executed", () => {
    const store = readyStore();
    const item = interaction("Mención en una historia");
    item.status = "pending";
    item.responseText = "Borrador manual que debe conservarse";
    store.interactions.push(item);
    const before = structuredClone(item);

    const result = processSacInteractions(store, [item.id], { evaluatedAt: now });

    expect(result).toMatchObject({
      interactions: [],
      evaluated: 0,
      drafted: 0,
      escalated: 0,
      autoReplyCandidates: 0,
      queuedAutoReplies: 0,
      quarantined: 0,
    });
    expect(item).toEqual(before);
  });

  it("still classifies a real customer question that mentions an attachment", () => {
    const store = readyStore();
    const item = interaction("Adjunto la foto del producto. ¿Tienen stock?");
    store.interactions.push(item);

    const result = evaluateSacInteraction(item, store, { evaluatedAt: now });

    expect(result.intent).toBe("stock");
    expect(result.recommendedRoute).toBe("draft");
    expect(result.reasonCodes).toContain("LIVE_SOURCE_REQUIRED");
    expect(result.proposal?.text).toContain("stock");
  });

  it("marks an inbound DM as answered by the team when a later outbound message exists", () => {
    const store = readyStore();
    store.interactions = [];
    const inbound = interaction("¿Tienen mi talla?");
    inbound.id = "inbound-answered";
    inbound.externalId = "message-inbound";
    inbound.status = "drafted";
    inbound.responseText = "Borrador que ya no corresponde";
    inbound.metricoolRef = { provider: "INSTAGRAM", conversationId: "conversation-answered" };
    const outbound: Interaction = {
      ...interaction("Sí, tenemos disponibilidad."),
      id: "outbound-team",
      externalId: "message-outbound",
      direction: "outbound",
      status: "replied",
      createdAt: "2026-08-13T13:58:00.000Z",
      updatedAt: "2026-08-13T13:58:00.000Z",
      metricoolRef: { provider: "INSTAGRAM", conversationId: "conversation-answered" },
    };
    store.interactions.push(inbound, outbound);

    expect(detectConversationResponses(store.interactions)).toEqual([{
      interactionId: inbound.id,
      outboundInteractionId: outbound.id,
      respondedAt: outbound.createdAt,
    }]);

    const reconciled = reconcileConversationResponses(store, undefined, now);

    expect(reconciled).toHaveLength(1);
    expect(inbound).toMatchObject({
      status: "replied",
      respondedAt: outbound.createdAt,
      responseText: undefined,
      version: 2,
    });
    expect(inbound.audit.at(-1)).toMatchObject({
      action: "status_changed",
      actor: "system",
      metadata: { reason: "OUTBOUND_MESSAGE_DETECTED", outboundInteractionId: outbound.id },
    });
  });

  it("keeps a new inbound DM pending when it arrives after the team response", () => {
    const store = readyStore();
    store.interactions = [];
    const firstInbound = interaction("Primera consulta");
    firstInbound.id = "first-inbound";
    firstInbound.createdAt = "2026-08-13T13:50:00.000Z";
    firstInbound.metricoolRef = { conversationId: "conversation-reopened" };
    const outbound: Interaction = {
      ...interaction("Primera respuesta"),
      id: "first-outbound",
      direction: "outbound",
      status: "replied",
      createdAt: "2026-08-13T13:52:00.000Z",
      metricoolRef: { conversationId: "conversation-reopened" },
    };
    const latestInbound = interaction("Tengo otra consulta");
    latestInbound.id = "latest-inbound";
    latestInbound.createdAt = "2026-08-13T13:54:00.000Z";
    latestInbound.metricoolRef = { conversationId: "conversation-reopened" };
    store.interactions.push(firstInbound, outbound, latestInbound);

    reconcileConversationResponses(store, undefined, now);

    expect(firstInbound.status).toBe("replied");
    expect(latestInbound.status).toBe("new");
  });
});
