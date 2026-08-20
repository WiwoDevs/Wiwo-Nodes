import { randomUUID } from "node:crypto";
import type {
  Brand,
  BrandSacPolicy,
  Channel,
  DataStore,
  Interaction,
  InteractionStatus,
  InteractionType,
  Sentiment,
  Workflow,
} from "./types.js";
import { MANDATORY_HUMAN_REVIEW_CATEGORIES } from "./safety-policy.js";
import { createDemoAutomationState } from "./automation-seed.js";

const BRAND_NAMES = [
  "Aurora", "Bosque", "Cumbre", "Duna", "Estuario",
  "Faro", "Greda", "Horizonte", "Índigo", "Jardín",
  "Kutral", "Litoral", "Marea", "Nativo", "Origen",
  "Pacífico", "Quillay", "Río Claro", "Sur", "Travesía",
] as const;

const COLORS = [
  "#7C3AED", "#0F766E", "#2563EB", "#4F46E5", "#BE123C",
  "#0369A1", "#4D7C0F", "#9333EA", "#4338CA", "#1D4ED8",
] as const;

const MESSAGE_TEMPLATES: Array<{
  type: InteractionType;
  channel: Channel;
  text: string;
  category: string;
  sentiment: Sentiment;
}> = [
  {
    type: "dm",
    channel: "instagram",
    text: "Hola, ¿me pueden confirmar el precio y si hacen envíos a regiones?",
    category: "preventa",
    sentiment: "neutral",
  },
  {
    type: "comment",
    channel: "facebook",
    text: "Me encantó el producto, ¿cuándo vuelve a estar disponible?",
    category: "stock",
    sentiment: "positive",
  },
  {
    type: "dm",
    channel: "facebook",
    text: "Mi pedido todavía no llega y necesito ayuda con el seguimiento.",
    category: "reclamo",
    sentiment: "negative",
  },
  {
    type: "comment",
    channel: "instagram",
    text: "¿Cuál es el horario de atención de este fin de semana?",
    category: "horarios",
    sentiment: "neutral",
  },
] as const;

function buildDemoSacPolicy(brandName: string, verifiedAt: string): BrandSacPolicy {
  return {
    enabled: true,
    locale: "es-CL",
    tone: "claro, cordial y directo",
    timeZone: "America/Santiago",
    businessHours: {
      monday: { start: "09:00", end: "18:00" },
      tuesday: { start: "09:00", end: "18:00" },
      wednesday: { start: "09:00", end: "18:00" },
      thursday: { start: "09:00", end: "18:00" },
      friday: { start: "09:00", end: "17:00" },
      saturday: null,
      sunday: null,
    },
    approvedAnswers: [
      {
        id: `demo-${brandName.toLocaleLowerCase("es-CL").replace(/[^a-z0-9]+/g, "-")}-horarios-v1`,
        intent: "horarios",
        answer: "¡Hola, {firstName}! El horario de atención demo de {brand} es de lunes a jueves de 09:00 a 18:00 y viernes de 09:00 a 17:00.",
        sourceLabel: "Perfil SAC ficticio aprobado",
        verifiedAt,
      },
      {
        id: `demo-${brandName.toLocaleLowerCase("es-CL").replace(/[^a-z0-9]+/g, "-")}-contacto-v1`,
        intent: "contacto",
        answer: "¡Hola, {firstName}! Puedes continuar por este mismo canal y el equipo SAC de {brand} te ayudará.",
        sourceLabel: "Perfil SAC ficticio aprobado",
        verifiedAt,
      },
    ],
  };
}

function isoMinutesAgo(reference: Date, minutes: number): string {
  return new Date(reference.getTime() - minutes * 60_000).toISOString();
}

function buildWorkflow(now: string): Workflow {
  return {
    id: "workflow-sac-metricool",
    name: "SAC multicuenta · Metricool",
    version: 1,
    publishedVersion: 1,
    publishedAt: now,
    publishedBy: "system",
    enabled: true,
    pollIntervalMinutes: 5,
    autoReplyEnabled: false,
    autoReplyAccountIds: [],
    minimumConfidence: 0.82,
    requireHumanFor: [...MANDATORY_HUMAN_REVIEW_CATEGORIES],
    businessHoursOnly: false,
    updatedAt: now,
    nodes: [
      { id: "schedule", type: "schedule", label: "Cada 5 minutos", enabled: true, position: { x: 24, y: 272 }, config: { intervalMinutes: 5 } },
      { id: "accounts", type: "metricool", label: "Cuentas autorizadas", enabled: true, position: { x: 235, y: 272 }, config: { channels: ["instagram", "facebook", "x", "tiktok", "youtube", "linkedin", "google_business"] } },
      { id: "loop", type: "metricool", label: "Procesar por cuenta", enabled: true, position: { x: 446, y: 272 }, config: { concurrency: 3 } },
      { id: "dms", type: "metricool", label: "Traer mensajes", enabled: true, position: { x: 657, y: 190 }, config: { resource: "conversations" } },
      { id: "comments", type: "metricool", label: "Traer comentarios", enabled: true, position: { x: 657, y: 355 }, config: { resource: "post-comments" } },
      { id: "reviews", type: "metricool", label: "Traer reseñas", enabled: true, position: { x: 657, y: 500 }, config: { resource: "reviews", provider: "GMB" } },
      { id: "merge", type: "normalize", label: "Unificar interacciones", enabled: true, position: { x: 868, y: 272 }, config: {} },
      { id: "normalize", type: "normalize", label: "Normalizar campos", enabled: true, position: { x: 1079, y: 190 }, config: {} },
      { id: "dedupe", type: "deduplicate", label: "Evitar duplicados", enabled: true, position: { x: 868, y: 500 }, config: { key: "accountId:type:externalId" } },
      { id: "excelRows", type: "excel", label: "Registrar interacciones", enabled: true, position: { x: 1290, y: 190 }, config: { sheet: "Interacciones" } },
      { id: "aggregate", type: "excel", label: "Recuento por cuenta", enabled: true, position: { x: 1501, y: 190 }, config: { sheet: "Resumen" } },
      { id: "classifier", type: "classify", label: "Intención y riesgo", enabled: true, position: { x: 1079, y: 500 }, config: { minimumConfidence: 0.82 } },
      { id: "faq", type: "guardrail", label: "¿Puede responder?", enabled: true, position: { x: 1290, y: 500 }, config: { sensitiveCategories: [...MANDATORY_HUMAN_REVIEW_CATEGORIES] } },
      { id: "generate", type: "reply", label: "Redactar respuesta", enabled: true, position: { x: 1501, y: 405 }, config: { humanApprovalRequired: true } },
      { id: "confidence", type: "guardrail", label: "Confianza ≥ 82%", enabled: true, position: { x: 1712, y: 405 }, config: { minimumConfidence: 0.82 } },
      { id: "reply", type: "reply", label: "Enviar respuesta", enabled: true, position: { x: 1923, y: 325 }, config: { autoReply: false } },
      { id: "human", type: "escalate", label: "Derivar a agente", enabled: true, position: { x: 1501, y: 565 }, config: {} },
      { id: "pending", type: "escalate", label: "Marcar pendiente", enabled: true, position: { x: 1712, y: 565 }, config: {} },
      { id: "errors", type: "escalate", label: "Reintentos y alertas", enabled: true, position: { x: 1923, y: 565 }, config: { maxAttempts: 5 } },
    ],
    edges: [
      { id: "schedule-accounts", source: "schedule", target: "accounts" },
      { id: "accounts-loop", source: "accounts", target: "loop" },
      { id: "loop-dms", source: "loop", target: "dms" },
      { id: "loop-comments", source: "loop", target: "comments" },
      { id: "loop-reviews", source: "loop", target: "reviews" },
      { id: "dms-merge", source: "dms", target: "merge" },
      { id: "comments-merge", source: "comments", target: "merge" },
      { id: "reviews-merge", source: "reviews", target: "merge" },
      { id: "merge-normalize", source: "merge", target: "normalize" },
      { id: "normalize-dedupe", source: "normalize", target: "dedupe" },
      { id: "dedupe-excelRows", source: "dedupe", target: "excelRows" },
      { id: "dedupe-aggregate", source: "dedupe", target: "aggregate" },
      { id: "excelRows-classifier", source: "excelRows", target: "classifier" },
      { id: "aggregate-classifier", source: "aggregate", target: "classifier" },
      { id: "classifier-faq", source: "classifier", target: "faq" },
      { id: "faq-generate", source: "faq", target: "generate", label: "seguro" },
      { id: "faq-human", source: "faq", target: "human", label: "revisión humana" },
      { id: "generate-confidence", source: "generate", target: "confidence" },
      { id: "confidence-reply", source: "confidence", target: "reply", label: "umbral cumplido" },
      { id: "confidence-human", source: "confidence", target: "human", label: "baja confianza" },
      { id: "human-pending", source: "human", target: "pending" },
      { id: "merge-errors", source: "merge", target: "errors", label: "error" },
    ],
  };
}

export function createDemoStore(reference = new Date()): DataStore {
  const now = reference.toISOString();
  const brands: Brand[] = BRAND_NAMES.map((name, index) => {
    const number = String(index + 1).padStart(2, "0");
    const brandId = `brand-${number}`;
    return {
      id: brandId,
      name: `Marca ${name}`,
      color: COLORS[index % COLORS.length],
      active: true,
      sacPolicy: buildDemoSacPolicy(`Marca ${name}`, now),
      account: {
        id: `account-${number}`,
        brandId,
        name: `Cuenta ${name}`,
        handle: `@${name.toLocaleLowerCase("es-CL").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "")}`,
        channels: ["instagram", "facebook"],
        active: true,
      },
    };
  });

  const interactions: Interaction[] = brands.flatMap((brand, brandIndex) =>
    MESSAGE_TEMPLATES.slice(0, 3).map((template, templateIndex) => {
      const index = brandIndex * 3 + templateIndex;
      const status: InteractionStatus =
        template.category === "reclamo"
          ? "escalated"
          : index % 4 === 0
            ? "replied"
            : index % 4 === 1
              ? "pending"
              : "new";
      const createdAt = isoMinutesAgo(reference, 18 + index * 37);
      const respondedAt = status === "replied" ? isoMinutesAgo(reference, 8 + index * 37) : undefined;
      return {
        id: `interaction-${String(index + 1).padStart(3, "0")}`,
        externalId: `demo-${brand.account.id}-${templateIndex + 1}`,
        brandId: brand.id,
        accountId: brand.account.id,
        channel: template.channel,
        type: template.type,
        direction: "inbound",
        customerName: `Cliente ${index + 1}`,
        customerHandle: `@cliente_${index + 1}`,
        text: template.text,
        category: template.category,
        sentiment: template.sentiment,
        confidence: template.category === "reclamo" ? 0.94 : 0.88,
        status,
        source: "demo",
        version: 1,
        createdAt,
        updatedAt: respondedAt ?? createdAt,
        internalNotes: [],
        responseText: status === "replied" ? "¡Hola! Claro, te enviamos la información por este medio." : undefined,
        respondedAt,
        audit: [
          {
            id: randomUUID(),
            at: createdAt,
            action: "ingested",
            actor: "system",
            detail: "Interacción cargada por el conjunto de demostración.",
          },
          ...(status === "escalated"
            ? [{
                id: randomUUID(),
                at: createdAt,
                action: "escalated" as const,
                actor: "workflow" as const,
                detail: "Reclamo derivado para revisión humana.",
              }]
            : []),
        ],
      };
    }),
  );

  const workflow = buildWorkflow(now);
  workflow.edges.forEach((edge) => {
    edge.connectorType = "smoothstep";
  });
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    brands,
    interactions,
    deliveries: [],
    workflow,
    workflowVersions: [{
      id: "workflow-sac-metricool-v1",
      workflowId: workflow.id,
      version: 1,
      status: "published",
      snapshot: structuredClone(workflow),
      createdAt: now,
      createdBy: "system",
      changeNote: "Versión inicial segura.",
    }],
    runs: [],
    jobs: [],
    idempotency: [],
    automation: createDemoAutomationState(reference),
  };
}
