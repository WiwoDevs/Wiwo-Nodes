/**
 * Explicación en palabras simples de lo que el protocolo SAC (reglas, sin IA) detectó en un caso.
 * Lo lee quien abre un mensaje: nada de claves internas («medium», «otro», «sac-v1»).
 */
import { categoryLabel } from "./category-label";
import type { SacAutomationAssessment } from "../types";

type Route = SacAutomationAssessment["effectiveRoute"];
type Risk = SacAutomationAssessment["risk"];
type Knowledge = SacAutomationAssessment["knowledge"]["status"];

/** Qué pasa con el caso, en una frase. */
export function routeSummary(route: Route): { title: string; detail: string } {
  if (route === "auto_reply") {
    return { title: "Se podría responder solo", detail: "Cumple todas las condiciones, pero hoy siempre responde una persona." };
  }
  if (route === "draft") {
    return { title: "Lo responde una persona", detail: "Hay una respuesta sugerida para revisar, ajustar y enviar." };
  }
  if (route === "human_review") {
    return { title: "Necesita revisión de una persona", detail: "Es un tema delicado o falta información: no uses una respuesta automática sin leerlo." };
  }
  if (route === "quarantine") {
    return { title: "Apartado por seguridad", detail: "Revísalo con cuidado antes de responder." };
  }
  return { title: "No requiere respuesta", detail: "Es un mensaje enviado por la cuenta." };
}

/** Tema detectado por las reglas («otro» = ninguna regla calzó). */
export function topicLabel(intent: string): string {
  if (!intent || intent === "otro") return "No se reconoció un tema";
  if (intent === "saludo") return "Saludo";
  if (intent === "horarios") return "Horarios";
  if (intent === "ubicacion") return "Ubicación";
  if (intent === "fraude") return "Posible fraude";
  if (intent === "amenaza") return "Amenaza";
  if (intent === "legal") return "Tema legal";
  if (intent === "salud") return "Salud";
  if (intent === "seguridad") return "Seguridad";
  return categoryLabel(intent);
}

export function riskLabel(risk: Risk): string {
  if (risk === "critical") return "Muy delicado (pagos, datos personales, legal o amenazas)";
  if (risk === "high") return "Delicado (reclamo o tono negativo)";
  if (risk === "medium") return "Revisar con atención";
  return "Consulta común";
}

export function knowledgeExplain(status: Knowledge): string {
  if (status === "approved") return "Sí: hay una respuesta aprobada de la marca para este tema.";
  if (status === "not_required") return "No hace falta: el mensaje no pide datos de la marca.";
  if (status === "live_source_required") return "Necesita datos actuales (stock, pedido): verifícalos antes de responder.";
  return "No hay una respuesta aprobada de la marca para este tema: escríbela tú.";
}

/** Motivos que configuran el sistema y no dicen nada del mensaje: se resumen en una sola línea. */
const SYSTEM_REASONS = new Set([
  "ACCOUNT_NOT_ALLOWLISTED",
  "AUTO_REPLY_DISABLED",
  "AUTO_REPLY_SHADOW_MODE",
  "AUTOMATION_POLICY_DISABLED",
  "DELIVERY_OUTBOX_NOT_READY",
  "METRICOOL_MUTATIONS_DISABLED",
  "OUTBOUND_CIRCUIT_BREAKER",
  "WORKFLOW_NOT_PUBLISHED",
]);

const REASON_TEXT: Record<string, string> = {
  AI_SENSITIVE_SIGNAL: "La IA lo marcó como posible caso delicado.",
  APPROVED_KNOWLEDGE_MISSING: "No hay una respuesta aprobada de la marca para este tema.",
  AUTO_REPLY_ELIGIBLE: "Cumple las condiciones para una respuesta automática.",
  LIVE_SOURCE_REQUIRED: "Pide datos que cambian (stock, estado de un pedido).",
  LOW_CLASSIFICATION_CONFIDENCE: "No se reconoció bien de qué trata el mensaje.",
  OUTBOUND_INTERACTION: "Lo escribió la cuenta, no el cliente.",
  OUTSIDE_BUSINESS_HOURS: "Llegó fuera del horario de atención.",
  PUBLIC_REVIEW_REQUIRES_APPROVAL: "Es una reseña pública: la respuesta se aprueba antes.",
  REPLY_WINDOW_EXPIRED: "Ya pasó el plazo de Meta para responder.",
  SENSITIVE_OR_NEGATIVE: "Es un tema delicado o el cliente está molesto.",
};

/** «Por qué»: motivos del mensaje en frases simples, más una línea si el envío automático está apagado. */
export function reasonLines(reasonCodes: string[]): string[] {
  const lines = reasonCodes.filter((code) => !SYSTEM_REASONS.has(code)).map((code) => REASON_TEXT[code]).filter(Boolean) as string[];
  if (reasonCodes.some((code) => SYSTEM_REASONS.has(code))) {
    lines.push("El envío automático está apagado: la respuesta siempre la envía una persona.");
  }
  return [...new Set(lines)];
}
