import type { InteractionStatus } from "./types.js";

interface StatusReasonOption {
  code: string;
  label: string;
  noteRequired?: boolean;
}

type StatusReasonCatalog = Record<"pending" | "escalated" | "resolved", StatusReasonOption[]>;

export const INTERACTION_STATUS_REASON_CATALOG: StatusReasonCatalog = {
  pending: [
    { code: "awaiting_customer", label: "Esperando respuesta del cliente" },
    { code: "awaiting_internal", label: "Esperando gestión interna" },
    { code: "awaiting_information", label: "Falta información" },
    { code: "follow_up_scheduled", label: "Seguimiento programado" },
    { code: "other", label: "Otro motivo", noteRequired: true },
  ],
  escalated: [
    { code: "specialist_required", label: "Requiere especialista" },
    { code: "critical_complaint", label: "Reclamo crítico" },
    { code: "legal_or_privacy", label: "Legal o privacidad" },
    { code: "payment_or_fraud", label: "Pago o posible fraude" },
    { code: "threat_or_safety", label: "Amenaza o seguridad" },
    { code: "technical_incident", label: "Incidente técnico" },
    { code: "other", label: "Otro motivo", noteRequired: true },
  ],
  resolved: [
    { code: "answered", label: "Consulta respondida" },
    { code: "request_completed", label: "Solicitud completada" },
    { code: "duplicate", label: "Caso duplicado" },
    { code: "spam", label: "Spam o contenido no válido" },
    { code: "no_response", label: "Sin respuesta del cliente" },
    { code: "transferred_external", label: "Derivado fuera de SAC" },
    { code: "other", label: "Otro motivo", noteRequired: true },
  ],
};

export function statusReasonFor(
  status: Extract<InteractionStatus, "pending" | "escalated" | "resolved">,
  code: string,
): StatusReasonOption | undefined {
  return INTERACTION_STATUS_REASON_CATALOG[status].find((option) => option.code === code);
}
