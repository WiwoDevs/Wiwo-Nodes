import { randomUUID } from "node:crypto";
import type {
  Brand,
  DataStore,
  Interaction,
  SacAutomationAssessment,
  SacAutomationRoute,
  Sentiment,
} from "./types.js";
import { isMetricoolContentUnavailable } from "./metricool-content.js";

const DYNAMIC_INTENTS = new Set(["precio", "stock", "despacho", "seguimiento_pedido"]);
const CRITICAL_INTENTS = new Set(["amenaza", "fraude", "seguridad"]);
const HUMAN_INTENTS = new Set([
  ...CRITICAL_INTENTS,
  "crisis",
  "datos_personales",
  "legal",
  "pago",
  "reclamo",
  "reclamo_critico",
  "salud",
]);

const INTENT_RULES: Array<{ intent: string; patterns: RegExp[] }> = [
  { intent: "amenaza", patterns: [/\bamenaz/, /\bvoy a (?:funar|demandar|golpear)/, /\bte voy a/] },
  { intent: "datos_personales", patterns: [/\brut\b/, /\bclave\b/, /\bcontrase(?:n|ñ)a\b/, /\btarjeta\b/, /\bdato(?:s)? personal/] },
  { intent: "fraude", patterns: [/\bfraud/, /\bestafa/, /\bdesconozco (?:el )?cargo/, /\brobo/] },
  { intent: "pago", patterns: [/\bpago/, /\btransferencia/, /\bcobro/, /\bboleta/, /\bfactura/] },
  { intent: "legal", patterns: [/\blegal/, /\babogad/, /\bdemanda/, /\bsernac/] },
  { intent: "salud", patterns: [/\bsalud/, /\balerg/, /\blesion/, /\bmedic/] },
  { intent: "seguridad", patterns: [/\bseguridad/, /\baccidente/, /\bpeligro/] },
  { intent: "reclamo", patterns: [/\breclamo/, /\bpesim/, /\bmal servicio/, /\bno (?:me )?(?:llego|llegó|responden)/, /\bdecepcion/] },
  { intent: "seguimiento_pedido", patterns: [/\bpedido/, /\borden\b/, /\bseguimiento/, /\btracking/, /\bdonde (?:esta|está)/] },
  { intent: "stock", patterns: [/\bstock/, /\bdisponib/, /\bqueda(?:n)?\b/, /\breposicion/] },
  { intent: "precio", patterns: [/\bprecio/, /\bcuanto (?:cuesta|vale)/, /\bvalor\b/, /\bcotiz/] },
  { intent: "despacho", patterns: [/\bdespach/, /\benvio/, /\benvío/, /\bregion/, /\bcomuna/, /\bdemora/] },
  { intent: "horarios", patterns: [/\bhorario/, /\ba que hora/, /\babren/, /\bcierran/] },
  { intent: "ubicacion", patterns: [/\bubicaci/, /\bdireccion/, /\bdirección/, /\bdonde quedan/, /\bsucursal/] },
  { intent: "contacto", patterns: [/\bcontacto/, /\btelefono/, /\bteléfono/, /\bcorreo/, /\bwhatsapp/] },
  { intent: "agradecimiento", patterns: [/\bgracias\b/, /\bagradezco/, /\bexcelente/] },
  { intent: "saludo", patterns: [/^(?:hola|buenos dias|buenas tardes|buenas noches|buenas)[!,. ]*$/, /^hola[!,. ]+(?:como estan|cómo están)?/] },
];

const NEGATIVE_PATTERNS = [
  /\breclamo/,
  /\bpesim/,
  /\bmal servicio/,
  /\bdecepcion/,
  /\benojad/,
  /\bmolest/,
  /\bno (?:me )?(?:llego|llegó|responden)/,
];

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const NON_ACTIONABLE_CONTENT_REASON = "NON_ACTIONABLE_CONTENT";

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function canonical(value: string): string {
  return normalized(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function classify(interaction: Interaction): {
  intent: string;
  sentiment: Sentiment;
  confidence: number;
  risk: SacAutomationAssessment["risk"];
} {
  const text = normalized(interaction.text);
  const matched = INTENT_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(text)));
  const existing = canonical(interaction.category);
  const intent = matched?.intent || (existing && existing !== "sin_clasificar" ? existing : "otro");
  const negative = interaction.sentiment === "negative"
    || NEGATIVE_PATTERNS.some((pattern) => pattern.test(text))
    || HUMAN_INTENTS.has(intent);
  const sentiment: Sentiment = negative ? "negative" : interaction.sentiment;
  const confidence = matched
    ? HUMAN_INTENTS.has(intent) ? 0.97 : 0.92
    : intent !== "otro" ? Math.max(interaction.confidence, 0.84) : 0.55;
  const risk = CRITICAL_INTENTS.has(intent)
    ? "critical"
    : HUMAN_INTENTS.has(intent) || negative
      ? "high"
      : DYNAMIC_INTENTS.has(intent) || intent === "otro"
        ? "medium"
        : "low";
  return { intent, sentiment, confidence, risk };
}

export function conversationKey(interaction: Interaction): string {
  if (interaction.type === "dm" && interaction.metricoolRef?.conversationId) {
    return `${interaction.accountId}:dm:${interaction.metricoolRef.conversationId}`;
  }
  if (interaction.type === "comment" && interaction.metricoolRef?.postId) {
    return `${interaction.accountId}:comment:${interaction.metricoolRef.postId}:${interaction.customerHandle}`;
  }
  if (interaction.type === "review" && interaction.metricoolRef?.objectId) {
    return `${interaction.accountId}:review:${interaction.metricoolRef.objectId}`;
  }
  return `${interaction.accountId}:${interaction.type}:${interaction.customerHandle}`;
}

export interface DetectedConversationResponse {
  interactionId: string;
  outboundInteractionId: string;
  respondedAt: string;
}

const OPEN_RESPONSE_STATUSES = new Set<Interaction["status"]>([
  "new",
  "pending",
  "drafted",
  "escalated",
]);

function interactionTimestamp(interaction: Interaction): number {
  const timestamp = Date.parse(interaction.createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function detectConversationResponses(
  interactions: Interaction[],
  accountIds?: ReadonlySet<string>,
): DetectedConversationResponse[] {
  const threads = new Map<string, Interaction[]>();
  for (const interaction of interactions) {
    if (accountIds && !accountIds.has(interaction.accountId)) continue;
    const key = conversationKey(interaction);
    const messages = threads.get(key) ?? [];
    messages.push(interaction);
    threads.set(key, messages);
  }

  const detected: DetectedConversationResponse[] = [];
  for (const messages of threads.values()) {
    const ordered = [...messages].sort((left, right) =>
      interactionTimestamp(left) - interactionTimestamp(right)
      || (left.direction === right.direction ? left.id.localeCompare(right.id) : left.direction === "inbound" ? -1 : 1));
    let nextOutbound: Interaction | undefined;
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const message = ordered[index];
      if (!message) continue;
      if (message.direction === "outbound") {
        nextOutbound = message;
        continue;
      }
      if (!nextOutbound || !OPEN_RESPONSE_STATUSES.has(message.status)) continue;
      detected.push({
        interactionId: message.id,
        outboundInteractionId: nextOutbound.id,
        respondedAt: nextOutbound.createdAt,
      });
    }
  }
  return detected;
}

export function reconcileConversationResponses(
  store: DataStore,
  accountIds?: ReadonlySet<string>,
  reconciledAt = new Date(),
): DetectedConversationResponse[] {
  const detected = detectConversationResponses(store.interactions, accountIds);
  const byId = new Map(store.interactions.map((interaction) => [interaction.id, interaction]));
  const at = reconciledAt.toISOString();

  for (const response of detected) {
    const interaction = byId.get(response.interactionId);
    if (!interaction) continue;
    interaction.status = "replied";
    interaction.respondedAt = response.respondedAt;
    interaction.responseText = undefined;
    interaction.statusReason = undefined;
    interaction.automation = undefined;
    interaction.updatedAt = at;
    interaction.version = Math.max(1, interaction.version || 1) + 1;
    interaction.audit.push({
      id: randomUUID(),
      at,
      action: "status_changed",
      actor: "system",
      detail: "Se detectó una respuesta posterior enviada desde la cuenta; el caso quedó respondido por el equipo.",
      metadata: {
        reason: "OUTBOUND_MESSAGE_DETECTED",
        outboundInteractionId: response.outboundInteractionId,
      },
    });
  }

  return detected;
}

function contextFor(interaction: Interaction, store: DataStore) {
  const key = conversationKey(interaction);
  const messages = store.interactions.filter((item) => conversationKey(item) === key);
  const inboundCount = messages.filter((item) => item.direction === "inbound").length;
  const outboundTimestamps = new Set(
    messages.filter((item) => item.direction === "outbound").map((item) => item.createdAt),
  );
  const outboundCount = outboundTimestamps.size + messages.filter((item) =>
    item.direction === "inbound"
    && Boolean(item.respondedAt && item.responseText)
    && !outboundTimestamps.has(item.respondedAt!)).length;
  return {
    key,
    messageCount: messages.length,
    inboundCount,
    outboundCount,
    continuation: messages.length > 1,
  };
}

function timeParts(date: Date, timeZone: string): { weekday: typeof WEEKDAYS[number]; minutes: number } | undefined {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const weekday = parts.find((part) => part.type === "weekday")?.value.toLowerCase();
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!WEEKDAYS.includes(weekday as typeof WEEKDAYS[number]) || !Number.isFinite(hour) || !Number.isFinite(minute)) {
      return undefined;
    }
    return { weekday: weekday as typeof WEEKDAYS[number], minutes: hour * 60 + minute };
  } catch {
    return undefined;
  }
}

function parseClock(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? hour * 60 + minute : undefined;
}

function isWithinBusinessHours(brand: Brand, at: Date): boolean | undefined {
  const policy = brand.sacPolicy;
  if (!policy?.businessHours) return undefined;
  const local = timeParts(at, policy.timeZone);
  if (!local) return undefined;
  const interval = policy.businessHours[local.weekday];
  if (!interval) return false;
  const start = parseClock(interval.start);
  const end = parseClock(interval.end);
  if (start === undefined || end === undefined || end <= start) return undefined;
  return local.minutes >= start && local.minutes < end;
}

function interpolate(answer: string, brand: Brand, interaction: Interaction): string {
  const firstName = interaction.customerName.split(/\s+/)[0]?.trim() || "Hola";
  return answer
    .replaceAll("{brand}", brand.name)
    .replaceAll("{firstName}", firstName);
}

function genericProposal(intent: string, brand: Brand, interaction: Interaction): { text: string; templateId: string } {
  const firstName = interaction.customerName.split(/\s+/)[0]?.trim() || "Hola";
  if (intent === "saludo") {
    return {
      text: `¡Hola, ${firstName}! Gracias por escribir a ${brand.name}. ¿En qué podemos ayudarte?`,
      templateId: "builtin-greeting-v1",
    };
  }
  if (intent === "agradecimiento") {
    return {
      text: `¡Gracias a ti, ${firstName}! Nos alegra poder ayudarte. Si necesitas algo más, escríbenos por este mismo canal.`,
      templateId: "builtin-thanks-v1",
    };
  }
  if (HUMAN_INTENTS.has(intent)) {
    return {
      text: `${firstName}, gracias por contarnos lo ocurrido. Dejamos tu caso priorizado para que una persona del equipo SAC lo revise con el contexto completo.`,
      templateId: "builtin-sensitive-ack-v1",
    };
  }
  return {
    text: `${firstName}, gracias por escribirnos. Recibimos tu consulta sobre ${intent.replaceAll("_", " ")} y la estamos verificando para responderte con información correcta.`,
    templateId: "builtin-safe-ack-v1",
  };
}

export interface SacAutomationOptions {
  outboundSendsDisabled?: boolean;
  metricoolMutationsDisabled?: boolean;
  autoSendInfrastructureReady?: boolean;
  autoReplyDispatchMode?: "shadow" | "live";
  evaluatedAt?: Date;
}

export function evaluateSacInteraction(
  interaction: Interaction,
  store: DataStore,
  options: SacAutomationOptions = {},
): SacAutomationAssessment {
  const evaluatedAt = options.evaluatedAt ?? new Date();
  const brand = store.brands.find((item) => item.id === interaction.brandId);
  if (!brand) throw new Error(`No existe la marca ${interaction.brandId} para evaluar la interacción.`);
  const context = contextFor(interaction, store);
  const windowMs = !["instagram", "facebook"].includes(interaction.channel) || interaction.type === "review"
    ? undefined
    : interaction.type === "comment" ? 24 * 60 * 60_000 : 7 * 24 * 60 * 60_000;
  const receivedAtMs = Date.parse(interaction.createdAt);
  const expiresAt = windowMs === undefined
    ? new Date("9999-12-31T23:59:59.999Z")
    : new Date(Number.isFinite(receivedAtMs) ? receivedAtMs + windowMs : evaluatedAt.getTime());
  const replyWindowEligible = windowMs === undefined
    ? true
    : Number.isFinite(receivedAtMs) && evaluatedAt.getTime() <= expiresAt.getTime();

  if (isMetricoolContentUnavailable(interaction.text)) {
    const existingIntent = canonical(interaction.category);
    return {
      protocolVersion: "sac-v1",
      evaluatedAt: evaluatedAt.toISOString(),
      intent: existingIntent || "sin_clasificar",
      risk: interaction.sentiment === "negative" ? "high" : "medium",
      classificationConfidence: interaction.confidence,
      knowledge: {
        status: "not_required",
        sourceIds: [],
      },
      conversation: context,
      replyWindow: {
        eligible: replyWindowEligible,
        expiresAt: expiresAt.toISOString(),
      },
      recommendedRoute: "ignore",
      effectiveRoute: "ignore",
      reasonCodes: [NON_ACTIONABLE_CONTENT_REASON],
    };
  }

  const classification = classify(interaction);
  const approved = brand.sacPolicy?.approvedAnswers.find((answer) => {
    if (canonical(answer.intent) !== classification.intent) return false;
    if (answer.channels?.length && !answer.channels.includes(interaction.channel)) return false;
    if (answer.interactionTypes?.length && !answer.interactionTypes.includes(interaction.type)) return false;
    return !answer.expiresAt || Date.parse(answer.expiresAt) > evaluatedAt.getTime();
  });
  const knowledgeStatus = classification.intent === "saludo" || classification.intent === "agradecimiento"
    ? "not_required" as const
    : DYNAMIC_INTENTS.has(classification.intent)
      ? "live_source_required" as const
      : approved
        ? "approved" as const
        : "missing" as const;
  const generic = genericProposal(classification.intent, brand, interaction);
  const proposal = approved
    ? {
        text: interpolate(approved.answer, brand, interaction),
        templateId: approved.id,
        sourceIds: [approved.id],
      }
    : {
        ...generic,
        sourceIds: [] as string[],
      };
  const reasonCodes: string[] = [];
  let recommendedRoute: SacAutomationRoute;

  if (interaction.direction !== "inbound") {
    recommendedRoute = "ignore";
    reasonCodes.push("OUTBOUND_INTERACTION");
  } else if (interaction.type === "review") {
    recommendedRoute = "human_review";
    reasonCodes.push("PUBLIC_REVIEW_REQUIRES_APPROVAL");
  } else if (HUMAN_INTENTS.has(classification.intent) || classification.sentiment === "negative") {
    recommendedRoute = "human_review";
    reasonCodes.push("SENSITIVE_OR_NEGATIVE");
  } else if (!replyWindowEligible) {
    recommendedRoute = "human_review";
    reasonCodes.push("REPLY_WINDOW_EXPIRED");
  } else if (classification.confidence < store.workflow.minimumConfidence) {
    recommendedRoute = "draft";
    reasonCodes.push("LOW_CLASSIFICATION_CONFIDENCE");
  } else if (knowledgeStatus === "live_source_required") {
    recommendedRoute = "draft";
    reasonCodes.push("LIVE_SOURCE_REQUIRED");
  } else if (knowledgeStatus === "missing") {
    recommendedRoute = "draft";
    reasonCodes.push("APPROVED_KNOWLEDGE_MISSING");
  } else if (!store.workflow.enabled || !brand.sacPolicy?.enabled) {
    recommendedRoute = "draft";
    reasonCodes.push("AUTOMATION_POLICY_DISABLED");
  } else if (!store.workflow.autoReplyEnabled) {
    recommendedRoute = "draft";
    reasonCodes.push("AUTO_REPLY_DISABLED");
  } else if (!store.workflow.autoReplyAccountIds.includes(interaction.accountId)) {
    recommendedRoute = "draft";
    reasonCodes.push("ACCOUNT_NOT_ALLOWLISTED");
  } else if (store.workflow.version !== store.workflow.publishedVersion) {
    recommendedRoute = "draft";
    reasonCodes.push("WORKFLOW_NOT_PUBLISHED");
  } else if (store.workflow.businessHoursOnly && isWithinBusinessHours(brand, evaluatedAt) !== true) {
    recommendedRoute = "draft";
    reasonCodes.push("OUTSIDE_BUSINESS_HOURS");
  } else {
    recommendedRoute = "auto_reply";
    reasonCodes.push("AUTO_REPLY_ELIGIBLE");
  }

  let effectiveRoute = recommendedRoute;
  if (recommendedRoute === "auto_reply" && options.outboundSendsDisabled) {
    effectiveRoute = "draft";
    reasonCodes.push("OUTBOUND_CIRCUIT_BREAKER");
  } else if (recommendedRoute === "auto_reply" && options.metricoolMutationsDisabled) {
    effectiveRoute = "draft";
    reasonCodes.push("METRICOOL_MUTATIONS_DISABLED");
  } else if (recommendedRoute === "auto_reply" && options.autoReplyDispatchMode === "shadow") {
    effectiveRoute = "draft";
    reasonCodes.push("AUTO_REPLY_SHADOW_MODE");
  } else if (recommendedRoute === "auto_reply" && !options.autoSendInfrastructureReady) {
    effectiveRoute = "draft";
    reasonCodes.push("DELIVERY_OUTBOX_NOT_READY");
  }

  return {
    protocolVersion: "sac-v1",
    evaluatedAt: evaluatedAt.toISOString(),
    intent: classification.intent,
    risk: classification.risk,
    classificationConfidence: classification.confidence,
    knowledge: {
      status: knowledgeStatus,
      sourceIds: approved ? [approved.id] : [],
    },
    conversation: context,
    replyWindow: {
      eligible: replyWindowEligible,
      expiresAt: expiresAt.toISOString(),
    },
    recommendedRoute,
    effectiveRoute,
    reasonCodes,
    ...(interaction.direction === "inbound" ? { proposal } : {}),
  };
}

export interface SacProtocolResult {
  interactions: Interaction[];
  evaluated: number;
  drafted: number;
  escalated: number;
  autoReplyCandidates: number;
  queuedAutoReplies: number;
  quarantined: number;
}

export function processSacInteractions(
  store: DataStore,
  interactionIds: string[],
  options: SacAutomationOptions = {},
): SacProtocolResult {
  const ids = new Set(interactionIds);
  const interactions: Interaction[] = [];
  let drafted = 0;
  let escalated = 0;
  let autoReplyCandidates = 0;
  let queuedAutoReplies = 0;
  let quarantined = 0;

  for (const interaction of store.interactions) {
    if (!ids.has(interaction.id)) continue;
    const assessment = evaluateSacInteraction(interaction, store, options);
    if (assessment.reasonCodes.includes(NON_ACTIONABLE_CONTENT_REASON)) continue;
    const at = assessment.evaluatedAt;
    interaction.automation = assessment;
    interaction.category = assessment.intent;
    interaction.confidence = assessment.classificationConfidence;
    interaction.sentiment = assessment.risk === "high" || assessment.risk === "critical"
      ? "negative"
      : interaction.sentiment;
    interaction.audit.push({
      id: randomUUID(),
      at,
      action: "classified",
      actor: "workflow",
      detail: `Intención ${assessment.intent}; riesgo ${assessment.risk}; confianza ${Math.round(assessment.classificationConfidence * 100)}%.`,
      metadata: { intent: assessment.intent, risk: assessment.risk, confidence: assessment.classificationConfidence },
    });
    interaction.audit.push({
      id: randomUUID(),
      at,
      action: "automation_evaluated",
      actor: "workflow",
      detail: `Ruta recomendada: ${assessment.recommendedRoute}; ruta efectiva: ${assessment.effectiveRoute}.`,
      metadata: {
        recommendedRoute: assessment.recommendedRoute,
        effectiveRoute: assessment.effectiveRoute,
        knowledgeStatus: assessment.knowledge.status,
      },
    });

    if (assessment.recommendedRoute === "auto_reply") autoReplyCandidates += 1;
    if (assessment.effectiveRoute === "human_review") {
      interaction.status = "escalated";
      interaction.responseText = assessment.proposal?.text;
      interaction.audit.push({
        id: randomUUID(),
        at,
        action: "escalated",
        actor: "workflow",
        detail: "El protocolo SAC exige revisión humana antes de cualquier respuesta.",
        metadata: { reasonCodes: assessment.reasonCodes.join(",") },
      });
      escalated += 1;
    } else if (assessment.effectiveRoute === "auto_reply") {
      interaction.status = "pending";
      interaction.responseText = assessment.proposal?.text;
      interaction.audit.push({
        id: randomUUID(),
        at,
        action: "draft_created",
        actor: "workflow",
        detail: "Respuesta automática preparada para entrega asíncrona.",
        metadata: { templateId: assessment.proposal?.templateId || "none", queued: true },
      });
      queuedAutoReplies += 1;
    } else if (assessment.effectiveRoute === "draft") {
      interaction.status = "drafted";
      interaction.responseText = assessment.proposal?.text;
      interaction.audit.push({
        id: randomUUID(),
        at,
        action: "draft_created",
        actor: "workflow",
        detail: assessment.recommendedRoute === "auto_reply"
          ? "Candidato de auto-respuesta retenido como borrador seguro."
          : "Borrador generado por el protocolo SAC para revisión.",
        metadata: { templateId: assessment.proposal?.templateId || "none" },
      });
      drafted += 1;
    } else if (assessment.effectiveRoute === "quarantine") {
      interaction.status = "resolved";
      quarantined += 1;
    }
    interaction.updatedAt = at;
    interaction.version = Math.max(1, interaction.version || 1) + 1;
    interactions.push(structuredClone(interaction));
  }

  return {
    interactions,
    evaluated: interactions.length,
    drafted,
    escalated,
    autoReplyCandidates,
    queuedAutoReplies,
    quarantined,
  };
}
