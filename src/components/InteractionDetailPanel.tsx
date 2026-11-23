import { can } from "../lib/permissions";
import { useEffect, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowRight,
  CaretDown,
  CaretUp,
  ArrowSquareOut,
  CheckCircle,
  ChatCenteredText,
  ClockCounterClockwise,
  NotePencil,
  ImageSquare,
  PaperPlaneTilt,
  Robot,
  Sparkle,
  ShieldCheck,
  UserMinus,
  UserPlus,
  UserFocus,
  WarningCircle,
  Trash,
  X,
} from "@phosphor-icons/react";
import type {
  InteractionDetail,
  InteractionPostContext,
  InteractionStatus,
  ReplyDelivery,
  SessionActor,
  StatusReasonCatalog,
} from "../types";
import { interactionKindLabel, platformLabel, SocialPlatformIcon } from "./SocialPlatformIcon";
import { ContentContext } from "./ContentContext";
import { PostThumbnail, safeThumbnailUrl } from "./PostThumbnail";
import { confirmAction } from "../lib/confirm";
import { ThinkingOrb } from "./ThinkingOrb";
import { AiReplySuggestion } from "./AiReplySuggestion";
import { categoryLabel } from "../lib/category-label";

export interface InteractionDetailPanelProps {
  detail: InteractionDetail | null;
  isLoading?: boolean;
  isSaving?: boolean;
  actor: SessionActor;
  statusReasons: StatusReasonCatalog;
  onClose: () => void;
  onSaveDraft: (detail: InteractionDetail, text: string) => void | Promise<void>;
  onDeleteDraft: (detail: InteractionDetail) => void | Promise<void>;
  onSendReply: (detail: InteractionDetail, text: string) => void | Promise<void>;
  onReconcileDelivery: (
    detail: InteractionDetail,
    delivery: ReplyDelivery,
    outcome: "sent" | "failed" | "cancelled",
    note: string,
  ) => void | Promise<void>;
  onResolve: (detail: InteractionDetail, reasonCode: string, reasonNote?: string) => void | Promise<void>;
  onEscalate: (detail: InteractionDetail, reasonCode: string, reasonNote?: string) => void | Promise<void>;
  /** Vuelve a pendiente un caso cerrado (p. ej. por un saludo automático) para poder responderlo. */
  onReopen?: (interactionId: string) => boolean | Promise<boolean>;
  onChangeAssignment: (detail: InteractionDetail) => void | Promise<void>;
  onAddInternalNote: (detail: InteractionDetail, text: string) => boolean | Promise<boolean>;
  /** Marca a mano si el mensaje cuenta como caso SAC en el reporte; `null` vuelve a lo automático. */
  onSetTriage?: (detail: InteractionDetail, esCasoSac: boolean | null, requiereDerivacion: boolean) => void | Promise<void>;
  /** Pasar al caso anterior (-1) o siguiente (1) de la bandeja; solo en la Bandeja SAC. */
  onNavigate?: (direction: 1 | -1) => void;
  navigation?: { hasPrevious: boolean; hasNext: boolean };
}

/** Atajos solo cuando la persona no está escribiendo en un campo. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function statusLabel(status: InteractionStatus) {
  if (status === "automated") return "Respondido";
  if (status === "answered_by_team") return "Respondido por el equipo";
  if (status === "needs_review") return "Revisión humana";
  if (status === "resolved") return "Resuelto";
  return "Pendiente";
}

function auditActionLabel(action: string) {
  if (action === "draft_created") return "Borrador";
  if (action === "draft_deleted") return "Borrador eliminado";
  if (action === "delivery_reconciled") return "Conciliación de entrega";
  if (action === "reply_sent") return "Respuesta enviada";
  if (action === "status_changed") return "Cambio de estado";
  if (action === "escalated") return "Escalamiento";
  if (action === "classified") return "Clasificación";
  if (action === "automation_evaluated") return "Protocolo SAC";
  if (action === "assigned") return "Asignación";
  if (action === "unassigned") return "Liberación";
  if (action === "note_added") return "Nota interna";
  return "Ingreso";
}

function deliveryStatusLabel(status: ReplyDelivery["status"]) {
  if (status === "pending") return "Preparada";
  if (status === "sending") return "En curso";
  if (status === "sent") return "Confirmada";
  if (status === "failed") return "Rechazada";
  if (status === "uncertain") return "Requiere conciliación";
  if (status === "cancelled") return "Cancelada";
  return "Simulada";
}

function routeLabel(route: NonNullable<InteractionDetail["automation"]>["effectiveRoute"]) {
  if (route === "auto_reply") return "Auto-respuesta elegible";
  if (route === "draft") return "Borrador seguro";
  if (route === "human_review") return "Revisión humana";
  if (route === "quarantine") return "Cuarentena";
  return "Sin acción";
}

function knowledgeLabel(status: NonNullable<InteractionDetail["automation"]>["knowledge"]["status"]) {
  if (status === "approved") return "Respuesta aprobada";
  if (status === "not_required") return "No requiere hechos";
  if (status === "live_source_required") return "Requiere fuente en vivo";
  return "Falta conocimiento aprobado";
}

function automationReasonLabel(reasonCode: string) {
  const labels: Record<string, string> = {
    ACCOUNT_NOT_ALLOWLISTED: "Cuenta fuera de la lista de auto-respuesta",
    APPROVED_KNOWLEDGE_MISSING: "Falta conocimiento aprobado",
    AUTO_REPLY_DISABLED: "Auto-respuesta desactivada",
    AUTO_REPLY_ELIGIBLE: "Elegible para auto-respuesta",
    AUTO_REPLY_SHADOW_MODE: "Auto-respuesta en modo de observación",
    AUTOMATION_POLICY_DISABLED: "Política automática desactivada",
    DELIVERY_OUTBOX_NOT_READY: "Cola de envíos no disponible",
    LIVE_SOURCE_REQUIRED: "Requiere una fuente de datos en vivo",
    LOW_CLASSIFICATION_CONFIDENCE: "Confianza de clasificación baja",
    METRICOOL_MUTATIONS_DISABLED: "Cambios en Metricool desactivados",
    OUTBOUND_CIRCUIT_BREAKER: "Envíos detenidos por seguridad",
    OUTBOUND_INTERACTION: "Mensaje enviado por la cuenta",
    OUTSIDE_BUSINESS_HOURS: "Fuera del horario de atención",
    PUBLIC_REVIEW_REQUIRES_APPROVAL: "Reseña pública sujeta a aprobación",
    REPLY_WINDOW_EXPIRED: "Fuera del plazo para auto-respuesta",
    SENSITIVE_OR_NEGATIVE: "Caso sensible o negativo",
    WORKFLOW_NOT_PUBLISHED: "Workflow sin publicar",
  };
  return labels[reasonCode] || "Condición de revisión detectada";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-CL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function safeHttpsUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function PostContextPreview({
  postContext,
  compact = false,
}: {
  postContext?: InteractionPostContext;
  compact?: boolean;
}) {
  const permalink = safeHttpsUrl(postContext?.permalink);
  const thumbnailUrl = safeThumbnailUrl(postContext?.thumbnailUrl);
  const caption = postContext?.caption?.trim();

  return (
    <section
      className={`case-post-context${compact ? " case-post-context--compact" : ""}`}
      aria-label="Publicación comentada"
    >
      <span className="case-post-context__media">
        <PostThumbnail url={thumbnailUrl} iconSize={compact ? 18 : 24} />
      </span>
      <span className="case-post-context__copy">
        <strong>Publicación comentada</strong>
        <span>{caption || "Metricool no entregó una vista previa de esta publicación."}</span>
      </span>
      {permalink ? (
        <a href={permalink} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
          <ArrowSquareOut size={15} weight="bold" aria-hidden="true" />
          Ver publicación original
        </a>
      ) : (
        <small>Enlace no disponible</small>
      )}
    </section>
  );
}

export function InteractionDetailPanel({
  detail,
  isLoading = false,
  isSaving = false,
  actor,
  statusReasons,
  onClose,
  onSaveDraft,
  onDeleteDraft,
  onSendReply,
  onReconcileDelivery,
  onResolve,
  onEscalate,
  onReopen,
  onChangeAssignment,
  onAddInternalNote,
  onSetTriage,
  onNavigate,
  navigation,
}: InteractionDetailPanelProps) {
  const shortcutsRef = useRef<{
    onNavigate?: (direction: 1 | -1) => void;
    navigation?: { hasPrevious: boolean; hasNext: boolean };
    canReply: boolean;
    canEscalate: boolean;
    focusComposer?: () => void;
    openEscalate?: () => void;
  }>({ canReply: false, canEscalate: false });
  const [draftText, setDraftText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [statusIntent, setStatusIntent] = useState<"escalated" | "resolved" | null>(null);
  const [statusReasonCode, setStatusReasonCode] = useState("");
  const [statusReasonNote, setStatusReasonNote] = useState("");
  const [reconciliationNote, setReconciliationNote] = useState("");
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [isDraftDirty, setDraftDirty] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const activeDetailIdRef = useRef<string | null>(null);
  const draftDirtyRef = useRef(false);
  const isOpen = Boolean(detail || isLoading);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const nextDetailId = detail?.id ?? null;
    const changedConversation = activeDetailIdRef.current !== nextDetailId;

    if (detail && (changedConversation || !draftDirtyRef.current)) {
      setDraftText(detail.responseText || detail.automation?.proposal?.text || "");
      draftDirtyRef.current = false;
      setDraftDirty(false);
    }

    if (changedConversation) {
      setNoteText("");
      setStatusIntent(null);
      setStatusReasonCode("");
      setStatusReasonNote("");
      setReconciliationNote("");
      setHistoryExpanded(false);
    }

    activeDetailIdRef.current = nextDetailId;
  }, [detail?.automation?.proposal?.text, detail?.id, detail?.responseText, detail?.version]);

  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frameId = window.requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener("keydown", handleEscape);

    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener("keydown", handleEscape);
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [isOpen]);

  const changeDraft = (value: string) => {
    setDraftText(value);
    draftDirtyRef.current = true;
    setDraftDirty(true);
  };

  // Atajos de teclado del detalle: J/K siguiente/anterior, R responder, E escalar. El efecto
  // va antes del return temprano para no cambiar el número de hooks entre renders.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) return;
      const state = shortcutsRef.current;
      const key = event.key.toLowerCase();
      if (key === "j" && state.onNavigate && state.navigation?.hasNext) { event.preventDefault(); state.onNavigate(1); }
      else if (key === "k" && state.onNavigate && state.navigation?.hasPrevious) { event.preventDefault(); state.onNavigate(-1); }
      else if (key === "r" && state.canReply) { event.preventDefault(); state.focusComposer?.(); }
      else if (key === "e" && state.canEscalate) { event.preventDefault(); state.openEscalate?.(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!detail && !isLoading) return null;

  const canWrite = can(actor, "inbox.reply");
  const canTriage = can(actor, "inbox.triage");
  const canAssign = can(actor, "inbox.assign");
  const canRelease = detail?.assignedTo
    ? detail.assignedTo.userId === actor.userId || can(actor, "inbox.assign_others")
    : false;
  const canChangeAssignment = canAssign && (!detail?.assignedTo || canRelease);
  const providerReplyWindowMs = !detail || !["instagram", "facebook"].includes(detail.platform) || detail.kind === "review"
    ? undefined
    : detail.kind === "comment" ? 24 * 60 * 60_000 : 7 * 24 * 60 * 60_000;
  const providerReplyDeadline = detail && providerReplyWindowMs !== undefined
    ? Date.parse(detail.receivedAt) + providerReplyWindowMs
    : Number.NaN;
  const providerReplyWindowExpired = detail && providerReplyWindowMs !== undefined
    ? !Number.isFinite(providerReplyDeadline) || Date.now() > providerReplyDeadline
    : false;
  const reasonOptions = statusIntent ? statusReasons[statusIntent] : [];
  const selectedReason = reasonOptions.find((option) => option.code === statusReasonCode);
  const latestDelivery = detail?.deliveries[0];
  const deliveryBlocksSend = latestDelivery
    ? ["pending", "sending", "uncertain"].includes(latestDelivery.status)
    : false;
  const canReconcile = can(actor, "deliveries.reconcile");
  // Versión del caso y otros datos internos: útiles para supervisión y soporte, ruido para el Agente.
  const canSeeTechnical = canReconcile || can(actor, "metrics.read");
  const aiRecommendation = detail?.automation?.proposal?.text || "";
  const hasConversationHistory = (detail?.conversationHistory.length ?? 0) > 1;
  const caseClosed = detail
    ? detail.direction === "outbound" || ["answered_by_team", "automated", "resolved"].includes(detail.status)
    : false;
  const closedCaseMessage = detail?.status === "answered_by_team"
    ? detail.direction === "outbound"
      ? "Este mensaje fue enviado por el equipo; no requiere respuesta."
      : "El equipo respondió después de este mensaje; no hay una respuesta pendiente."
    : detail?.status === "automated"
      ? "Se registró una respuesta automática; no hay una respuesta pendiente."
      : detail?.status === "resolved"
        ? "El caso está resuelto; no hay una respuesta pendiente."
        : "No hay una respuesta pendiente.";

  // Un caso cerrado se puede volver a pendiente para responderlo (p. ej. si lo cerró un saludo
  // automático de la cuenta y el cliente sigue sin respuesta real).
  // Si el caso abierto es el mensaje de la cuenta, se reabre el último mensaje del cliente.
  const reopenTargetId = detail && caseClosed
    ? detail.direction === "inbound"
      ? detail.id
      : [...detail.conversationHistory]
        .filter((message) => message.direction === "inbound")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .at(-1)?.id
    : undefined;
  const canReopen = Boolean(reopenTargetId && onReopen && canTriage);
  const reopenCase = async () => {
    if (!reopenTargetId || !onReopen) return;
    const confirmed = await confirmAction({
      title: "¿Reabrir este caso?",
      message: "El último mensaje del cliente vuelve a pendiente para que puedas responderlo. Queda registrado quién lo reabrió.",
      confirmLabel: "Reabrir",
    });
    if (confirmed) await onReopen(reopenTargetId);
  };

  const openStatusForm = (intent: "escalated" | "resolved") => {
    setStatusIntent(intent);
    setStatusReasonCode(statusReasons[intent][0]?.code || "");
    setStatusReasonNote("");
  };

  const focusComposer = () => {
    const composer = document.getElementById("case-draft-text");
    composer?.scrollIntoView({ behavior: "smooth", block: "center" });
    composer?.focus({ preventScroll: true });
  };

  // Estado que leen los atajos de teclado (el hook vive antes del return temprano).
  shortcutsRef.current = {
    onNavigate,
    navigation,
    canReply: Boolean(detail) && canWrite && !caseClosed,
    canEscalate: Boolean(detail) && canTriage && !caseClosed && !isSaving,
    focusComposer,
    openEscalate: () => openStatusForm("escalated"),
  };

  // Clic fuera del panel: lo cierra, pero una respuesta sin guardar no se pierde por un clic accidental.
  const closeFromBackdrop = async () => {
    if (draftDirtyRef.current) {
      const confirmed = await confirmAction({
        title: "¿Cerrar sin guardar la respuesta?",
        message: "Tienes cambios en la respuesta que no se han guardado. Si cierras el detalle, se descartan.",
        confirmLabel: "Cerrar y descartar",
        cancelLabel: "Seguir editando",
        tone: "danger",
      });
      if (!confirmed) return;
    }
    onClose();
  };

  return (
    <>
    <div className="case-detail-backdrop" aria-hidden="true" onClick={() => void closeFromBackdrop()} />
    <aside
      ref={panelRef}
      className="case-detail-panel"
      aria-label="Detalle de conversación"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
    >
      <header className="case-detail-panel__header">
        <div>
          <span>Detalle de caso</span>
          <h2>{detail ? detail.customerName : "Cargando interacción"}</h2>
        </div>
        <span className="case-detail-panel__header-actions">
          {detail && caseClosed && onNavigate && navigation?.hasNext ? (
            <button
              className="button button--primary case-detail-panel__jump"
              type="button"
              onClick={() => onNavigate(1)}
              title="Abrir el siguiente caso de la bandeja (J)"
            >
              Siguiente caso
              <ArrowRight size={14} weight="bold" aria-hidden="true" />
            </button>
          ) : detail && canWrite && !caseClosed ? (
            <button
              className="button button--secondary case-detail-panel__jump"
              type="button"
              onClick={focusComposer}
              title="Ir a la respuesta (R)"
            >
              <PaperPlaneTilt size={14} weight="bold" aria-hidden="true" />
              Responder
            </button>
          ) : null}
          {onNavigate ? (
            <span className="case-detail-panel__nav" role="group" aria-label="Moverse entre casos">
              <button
                className="icon-button"
                type="button"
                onClick={() => onNavigate(-1)}
                disabled={!navigation?.hasPrevious}
                aria-label="Caso anterior"
                title="Caso anterior (K)"
              >
                <CaretUp size={16} weight="bold" aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                type="button"
                onClick={() => onNavigate(1)}
                disabled={!navigation?.hasNext}
                aria-label="Caso siguiente"
                title="Caso siguiente (J)"
              >
                <CaretDown size={16} weight="bold" aria-hidden="true" />
              </button>
            </span>
          ) : null}
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar detalle">
            <X size={17} weight="bold" aria-hidden="true" />
          </button>
        </span>
      </header>

      {isLoading || !detail ? (
        <div className="case-detail-panel__loading">
          <ThinkingOrb size="lg" className="loading-orb" label="" />
          <strong>Cargando conversación</strong>
          <p>Consultando la API operativa y la auditoría del caso.</p>
        </div>
      ) : (
        <div className="case-detail-panel__body">
          <section className="case-summary-card">
            <div className="case-summary-card__topline">
              <span className={`channel-label channel-label--${detail.platform}`}>
                <SocialPlatformIcon platform={detail.platform} size={17} weight="fill" aria-hidden="true" />
                <span>
                  {platformLabel(detail.platform)}
                  <small>{interactionKindLabel(detail.kind)}</small>
                </span>
              </span>
              <span className={`status-badge status-badge--${detail.status}`}>
                {detail.status === "automated" ? (
                  <Robot size={14} weight="fill" aria-hidden="true" />
                ) : detail.status === "resolved" || detail.status === "answered_by_team" ? (
                  <CheckCircle size={14} weight="fill" aria-hidden="true" />
                ) : detail.status === "needs_review" ? (
                  <UserFocus size={14} weight="fill" aria-hidden="true" />
                ) : (
                  <WarningCircle size={14} weight="fill" aria-hidden="true" />
                )}
                {statusLabel(detail.status)}
              </span>
            </div>
            <dl className="case-meta-grid">
              <div>
                <dt>Marca</dt>
                <dd>{detail.brandName}</dd>
              </div>
              <div>
                <dt>Usuario</dt>
                <dd>{detail.customerHandle}</dd>
              </div>
              <div>
                <dt>Categoría</dt>
                <dd>{categoryLabel(detail.category)}</dd>
              </div>
              <div>
                <dt>Confianza</dt>
                <dd>{Math.round(detail.confidence * 100)}%</dd>
              </div>
              <div>
                <dt>Asignación</dt>
                <dd>{detail.assignedTo?.displayName ?? "Sin asignar"}</dd>
              </div>
              {canSeeTechnical ? (
                <div>
                  <dt>Versión</dt>
                  <dd>v{detail.version}</dd>
                </div>
              ) : null}
              {detail.statusReason ? (
                <div>
                  <dt>Último motivo</dt>
                  <dd>{detail.statusReason.label}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="case-coordination-card">
            <div>
              <span className="case-coordination-card__icon">
                {detail.assignedTo ? <UserFocus size={18} weight="duotone" /> : <UserPlus size={18} weight="duotone" />}
              </span>
              <div>
                <strong>{detail.assignedTo?.displayName ?? "Caso disponible"}</strong>
                <p>{detail.assignedTo
                  ? "Responsable actual del seguimiento."
                  : caseClosed
                    ? closedCaseMessage
                    : "Asígnatelo antes de responder para evitar colisiones."}</p>
              </div>
            </div>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void onChangeAssignment(detail)}
              disabled={isSaving || !canChangeAssignment}
            >
              {detail.assignedTo ? <UserMinus size={15} weight="bold" /> : <UserPlus size={15} weight="bold" />}
              {!canAssign ? "Solo lectura" : detail.assignedTo && !canRelease ? "Asignado" : detail.assignedTo ? "Liberar" : "Asignarme"}
            </button>
          </section>

          {detail.kind === "comment" ? <PostContextPreview postContext={detail.postContext} /> : null}

          <section className="case-message-card">
            <header>
              <strong>{detail.direction === "outbound" ? "Mensaje enviado por el equipo" : "Mensaje recibido"}</strong>
              <span>
                <time dateTime={detail.receivedAt}>{formatDate(detail.receivedAt)}</time>
                {hasConversationHistory ? (
                  <button type="button" className="case-history-toggle" onClick={() => setHistoryExpanded((current) => !current)} aria-expanded={historyExpanded}>
                    <ChatCenteredText size={15} weight="bold" aria-hidden="true" />
                    {historyExpanded ? "Ocultar historial" : `Ver historial (${detail.conversationHistory.length})`}
                  </button>
                ) : null}
              </span>
            </header>
            <ContentContext text={detail.text} context={detail.contentContext} />
            <small className={`case-reply-window${providerReplyWindowExpired ? " case-reply-window--expired" : ""}`}>
              {caseClosed
                ? closedCaseMessage
                : detail.kind === "review"
                ? "Respuesta manual disponible · sujeta a validación del proveedor"
                : providerReplyWindowExpired
                ? "Respuesta manual disponible · fuera del plazo recomendado de Metricool/Meta"
                // TikTok, LinkedIn y YouTube no tienen plazo informado: sin esta rama, la fecha
                // inválida rompía el detalle (RangeError en toISOString) y la página quedaba en blanco.
                : !Number.isFinite(providerReplyDeadline)
                ? "Respuesta manual disponible · Metricool no informa un plazo para esta red"
                : `Respuesta manual disponible · plazo recomendado hasta ${formatDate(new Date(providerReplyDeadline).toISOString())}`}
            </small>
            {canReopen ? (
              <button className="button button--secondary case-reopen-button" type="button" onClick={() => void reopenCase()} disabled={isSaving}>
                <ArrowCounterClockwise size={15} weight="bold" aria-hidden="true" />
                Reabrir caso
              </button>
            ) : null}
          </section>

          {historyExpanded ? (
            <section className="case-conversation-history" aria-label="Historial de conversación">
              <header>
                <div>
                  <strong>Historial de conversación</strong>
                  <small>{detail.conversationHistory.length} mensajes recientes de esta persona</small>
                </div>
              </header>
              <ol>
                {detail.conversationHistory.map((message) => (
                  <li className={`case-conversation-message case-conversation-message--${message.direction}`} key={message.id}>
                    <div>
                      <strong>{message.direction === "inbound" ? detail.customerName : `${detail.brandName} · Equipo`}</strong>
                      <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
                    </div>
                    <ContentContext text={message.text} context={message.contentContext} />
                    <small>{interactionKindLabel(message.kind)} · {platformLabel(message.platform)}</small>
                    {message.kind === "comment" && message.postContext ? (
                      <PostContextPreview postContext={message.postContext} compact />
                    ) : null}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {latestDelivery ? (
            <section className={`case-delivery-card case-delivery-card--${latestDelivery.status}`}>
              <header>
                <span className="case-delivery-card__icon">
                  {latestDelivery.status === "uncertain"
                    ? <WarningCircle size={18} weight="duotone" />
                    : <ShieldCheck size={18} weight="duotone" />}
                </span>
                <div>
                  <strong>Entrega de respuesta</strong>
                  <small>{deliveryStatusLabel(latestDelivery.status)} · intento {latestDelivery.attemptCount}</small>
                </div>
              </header>
              <dl>
                <div><dt>Estado</dt><dd>{deliveryStatusLabel(latestDelivery.status)}</dd></div>
                <div><dt>Actualizada</dt><dd>{formatDate(latestDelivery.updatedAt)}</dd></div>
                {latestDelivery.nextAttemptAt ? <div><dt>Próximo intento</dt><dd>{formatDate(latestDelivery.nextAttemptAt)}</dd></div> : null}
                {latestDelivery.errorCode ? <div><dt>Código</dt><dd>{latestDelivery.errorCode}</dd></div> : null}
                {latestDelivery.reconciledAt ? <div><dt>Conciliada</dt><dd>{formatDate(latestDelivery.reconciledAt)}</dd></div> : null}
              </dl>
              {latestDelivery.status === "uncertain" ? (
                <div className="case-delivery-card__reconcile">
                  <p>
                    No se reenviará automáticamente. Verifica la conversación en Metricool y registra aquí el resultado real.
                  </p>
                  {canReconcile ? (
                    <>
                      <textarea
                        aria-label="Evidencia de conciliación"
                        value={reconciliationNote}
                        onChange={(event) => setReconciliationNote(event.target.value)}
                        rows={2}
                        maxLength={2_000}
                        placeholder="Evidencia de la verificación manual (mínimo 10 caracteres)"
                        disabled={isSaving}
                      />
                      <div>
                        <button
                          className="button button--secondary"
                          type="button"
                          disabled={isSaving || reconciliationNote.trim().length < 10}
                          onClick={() => void onReconcileDelivery(detail, latestDelivery, "failed", reconciliationNote.trim())}
                        >
                          No fue enviada
                        </button>
                        <button
                          className="button button--primary"
                          type="button"
                          disabled={isSaving || reconciliationNote.trim().length < 10}
                          onClick={() => void onReconcileDelivery(detail, latestDelivery, "sent", reconciliationNote.trim())}
                        >
                          Confirmar enviada
                        </button>
                      </div>
                    </>
                  ) : (
                    <small>La conciliación requiere rol supervisor.</small>
                  )}
                </div>
              ) : null}
            </section>
          ) : null}

          <AiReplySuggestion
            variant="panel"
            interactionId={detail.id}
            accountId={detail.accountId}
            active={!caseClosed && detail.direction === "inbound"}
            closedMessage="Este hilo ya fue respondido por el equipo; no se generará una nueva sugerencia mientras siga cerrado."
            ruleText={aiRecommendation}
            ruleGrounded={detail.automation?.knowledge.status === "approved"}
            ruleSourceCount={detail.automation?.knowledge.sourceIds.length ?? 0}
            disabled={!canWrite || isSaving}
            onUse={changeDraft}
          />

          <form
            className="case-reply-card"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await onSaveDraft(detail, draftText);
                draftDirtyRef.current = false;
                setDraftDirty(false);
              } catch {
                // App comunica el error; conservar el borrador local permite reintentar.
              }
            }}
          >
            <header className="case-reply-card__header">
              <div>
                <label htmlFor="case-draft-text">Respuesta editable</label>
                <small>Puedes ajustar la recomendación o escribir una respuesta completamente personal.</small>
              </div>
              <button className="button button--tertiary" type="button" onClick={() => changeDraft("")} disabled={isSaving || !canWrite || caseClosed || !draftText}>
                Escribir personalmente
              </button>
            </header>
            <textarea
              id="case-draft-text"
              aria-label="Respuesta editable"
              value={draftText}
              onChange={(event) => changeDraft(event.target.value)}
              placeholder="Escribe o ajusta el borrador para revisión humana"
              rows={5}
              disabled={!canWrite || caseClosed}
            />
            <small className="case-reply-card__draft-state" aria-live="polite">
              {isDraftDirty ? "Cambios locales sin guardar · la actualización automática no los reemplazará" : "Borrador sincronizado con el caso"}
            </small>
            {!caseClosed && detail.direction === "inbound" ? (
              <p
                id="reply-provider-notice"
                className={`case-reply-provider-note${providerReplyWindowExpired ? " case-reply-provider-note--caution" : ""}`}
              >
                {providerReplyWindowExpired
                  ? "Puedes intentar enviarla. Metricool o la red social podrían rechazarla por antigüedad; si ocurre, el borrador seguirá disponible."
                  : "El envío solo se marcará como respondido cuando Metricool confirme la entrega."}
              </p>
            ) : null}
            <div className="case-reply-card__actions">
              <button
                className="button button--danger-ghost"
                type="button"
                disabled={isSaving || !canWrite || caseClosed || !detail.responseText}
                onClick={async () => {
                  const confirmed = await confirmAction({
                    title: "¿Borrar el borrador guardado?",
                    message: "El mensaje original del cliente no se modificará.",
                    confirmLabel: "Borrar borrador",
                    tone: "danger",
                  });
                  if (confirmed) void onDeleteDraft(detail);
                }}
              >
                <Trash size={16} weight="bold" aria-hidden="true" />
                Borrar borrador
              </button>
              <button className="button button--secondary" type="button" onClick={() => openStatusForm("escalated")} disabled={isSaving || !canTriage || caseClosed}>
                <UserFocus size={16} weight="bold" aria-hidden="true" />
                Escalar
              </button>
              <button className="button button--secondary" type="button" onClick={() => openStatusForm("resolved")} disabled={isSaving || !canTriage || caseClosed}>
                <CheckCircle size={16} weight="bold" aria-hidden="true" />
                Resolver
              </button>
              <button className="button button--primary" type="submit" disabled={isSaving || !canWrite || caseClosed || draftText.trim().length === 0}>
                <NotePencil size={16} weight="bold" aria-hidden="true" />
                {isSaving ? "Guardando" : "Guardar borrador"}
              </button>
              <button
                className="button button--primary button--send"
                type="button"
                onClick={async () => {
                  const text = draftText.trim();
                  const confirmed = await confirmAction(providerReplyWindowExpired
                    ? {
                      title: "¿Intentar enviar fuera de plazo?",
                      message: "El plazo recomendado de Meta ya venció y la plataforma puede rechazar esta respuesta.",
                      confirmLabel: "Intentar enviar",
                    }
                    : {
                      title: "¿Enviar esta respuesta ahora?",
                      message: "En modo live se publicará mediante Metricool y la acción quedará auditada.",
                      confirmLabel: "Enviar respuesta",
                    });
                  if (confirmed) void onSendReply(detail, text);
                }}
                disabled={isSaving || !canWrite || caseClosed || deliveryBlocksSend || draftText.trim().length === 0 || detail.direction !== "inbound"}
                aria-describedby={!caseClosed && detail.direction === "inbound" ? "reply-provider-notice" : undefined}
                title={caseClosed
                  ? "El caso ya fue respondido por el equipo"
                  : deliveryBlocksSend
                  ? "Existe una entrega activa o pendiente de conciliación"
                  : providerReplyWindowExpired
                    ? "Intentar envío manual sujeto a validación de Metricool"
                    : "Requiere confirmación antes de enviar"}
              >
                <PaperPlaneTilt size={16} weight="bold" aria-hidden="true" />
                {providerReplyWindowExpired ? "Intentar enviar" : "Enviar respuesta"}
              </button>
            </div>
          </form>

          {/* Clasificación para el reporte mensual: después de responder, no antes del mensaje. */}
          {detail.direction === "inbound" && detail.reportTriage ? (() => {
            const triage = detail.reportTriage;
            const manual = triage.source === "manual";
            const sourceText = manual
              ? `Marcado a mano${triage.marcadoPor ? ` por ${triage.marcadoPor}` : ""}.`
              : triage.source === "ia"
                ? "Clasificado con IA. Puedes corregirlo."
                : "Decidido por reglas: no cuentan reacciones, menciones, emojis ni textos muy cortos. Corrígelo si no corresponde.";
            return (
              <section className={`case-triage-card${triage.esCasoSac ? "" : " is-noise"}`} aria-label="Clasificación para el reporte mensual">
                <div className="case-triage-card__copy">
                  <strong>Para el reporte: {triage.esCasoSac ? "cuenta como caso SAC" : "no cuenta (ruido)"}{triage.esCasoSac && triage.requiereDerivacion ? " · requiere derivación" : ""}</strong>
                  <p>{sourceText}</p>
                </div>
                {canTriage && onSetTriage ? (
                  <div className="case-triage-card__actions" role="group" aria-label="Marcar para el reporte">
                    <button
                      className={`button button--secondary${manual && triage.esCasoSac ? " is-selected" : ""}`}
                      type="button"
                      aria-pressed={manual && triage.esCasoSac}
                      disabled={isSaving}
                      onClick={() => void onSetTriage(detail, true, triage.requiereDerivacion)}
                    >
                      Es caso
                    </button>
                    <button
                      className={`button button--secondary${manual && !triage.esCasoSac ? " is-selected" : ""}`}
                      type="button"
                      aria-pressed={manual && !triage.esCasoSac}
                      disabled={isSaving}
                      onClick={() => void onSetTriage(detail, false, false)}
                    >
                      No es caso
                    </button>
                    <label className="case-triage-card__check">
                      <input
                        type="checkbox"
                        checked={triage.esCasoSac && triage.requiereDerivacion}
                        disabled={isSaving || !triage.esCasoSac}
                        onChange={(event) => void onSetTriage(detail, true, event.target.checked)}
                      />
                      Requiere derivación
                    </label>
                    {manual ? (
                      <button className="text-button" type="button" disabled={isSaving} onClick={() => void onSetTriage(detail, null, false)}>
                        Volver a automático
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </section>
            );
          })() : null}

          <section className="case-automation-card">
            <header>
              <span className="case-automation-card__icon">
                {detail.automation ? <ShieldCheck size={18} weight="duotone" /> : <Robot size={18} weight="duotone" />}
              </span>
              <div>
                <strong>Protocolo de respuesta SAC</strong>
                <small>{detail.automation ? "Evaluación trazable sac-v1" : "Pendiente de evaluación"}</small>
              </div>
            </header>
            {detail.automation ? (
              <>
                <dl>
                  <div><dt>Ruta</dt><dd>{routeLabel(detail.automation.effectiveRoute)}</dd></div>
                  <div><dt>Intención</dt><dd>{detail.automation.intent.replaceAll("_", " ")}</dd></div>
                  <div><dt>Riesgo</dt><dd>{detail.automation.risk}</dd></div>
                  <div><dt>Conocimiento</dt><dd>{knowledgeLabel(detail.automation.knowledge.status)}</dd></div>
                  <div><dt>Contexto</dt><dd>{detail.automation.conversation.messageCount} mensaje(s)</dd></div>
                  <div>
                    <dt>Plazo automático</dt>
                    <dd>{providerReplyWindowMs === undefined ? "Según proveedor" : providerReplyWindowExpired ? "Fuera del plazo" : "Dentro del plazo"}</dd>
                  </div>
                </dl>
                <p>{detail.automation.reasonCodes.map(automationReasonLabel).join(" · ")}</p>
              </>
            ) : (
              <p>Ejecuta “Protocolo SAC” desde la bandeja para clasificar, proponer y enrutar este caso sin escribir en Metricool.</p>
            )}
          </section>

          {statusIntent ? (
            <form
              className="case-status-form"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!statusReasonCode || (selectedReason?.noteRequired && !statusReasonNote.trim())) return;
                if (statusIntent === "resolved") {
                  await onResolve(detail, statusReasonCode, statusReasonNote.trim() || undefined);
                } else {
                  await onEscalate(detail, statusReasonCode, statusReasonNote.trim() || undefined);
                }
                setStatusIntent(null);
              }}
            >
              <header>
                <div>
                  <strong>{statusIntent === "resolved" ? "Resolver caso" : "Escalar caso"}</strong>
                  <small>El motivo queda disponible para auditoría y reportes.</small>
                </div>
                <button className="icon-button" type="button" onClick={() => setStatusIntent(null)} aria-label="Cancelar cambio de estado">
                  <X size={15} weight="bold" aria-hidden="true" />
                </button>
              </header>
              <label>
                <span>Motivo</span>
                <select
                  value={statusReasonCode}
                  onChange={(event) => setStatusReasonCode(event.target.value)}
                  disabled={isSaving}
                  required
                >
                  {reasonOptions.map((option) => (
                    <option key={option.code} value={option.code}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Nota {selectedReason?.noteRequired ? "obligatoria" : "opcional"}</span>
                <textarea
                  aria-label="Nota del motivo"
                  value={statusReasonNote}
                  onChange={(event) => setStatusReasonNote(event.target.value)}
                  rows={2}
                  maxLength={500}
                  required={selectedReason?.noteRequired}
                  placeholder="Contexto breve para el equipo"
                  disabled={isSaving}
                />
              </label>
              <button
                className="button button--primary"
                type="submit"
                disabled={isSaving || !statusReasonCode || Boolean(selectedReason?.noteRequired && !statusReasonNote.trim())}
              >
                {statusIntent === "resolved" ? <CheckCircle size={16} weight="bold" /> : <UserFocus size={16} weight="bold" />}
                {isSaving ? "Guardando" : statusIntent === "resolved" ? "Confirmar resolución" : "Confirmar escalamiento"}
              </button>
            </form>
          ) : null}

          <section className="case-notes-card">
            <header>
              <NotePencil size={17} weight="duotone" aria-hidden="true" />
              <div>
                <strong>Notas internas</strong>
                <small>No se envían a Metricool</small>
              </div>
              <span>{detail.internalNotes.length}</span>
            </header>
            {detail.internalNotes.length ? (
              <ol>
                {[...detail.internalNotes].reverse().map((note) => (
                  <li key={note.id}>
                    <div><strong>{note.authorName}</strong><time dateTime={note.createdAt}>{formatDate(note.createdAt)}</time></div>
                    <p>{note.text}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="case-notes-card__empty">Aún no hay contexto interno para este caso.</p>
            )}
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const value = noteText.trim();
                if (!value) return;
                if (await onAddInternalNote(detail, value)) setNoteText("");
              }}
            >
              <label htmlFor="case-internal-note">Nueva nota interna</label>
              <textarea
                id="case-internal-note"
                aria-label="Nota interna"
                value={noteText}
                onChange={(event) => setNoteText(event.target.value)}
                placeholder="Contexto para el siguiente agente"
                rows={3}
                maxLength={2000}
                disabled={!canTriage}
              />
              <button className="button button--secondary" type="submit" disabled={isSaving || !canTriage || !noteText.trim()}>
                <NotePencil size={15} weight="bold" aria-hidden="true" />
                Guardar nota
              </button>
            </form>
          </section>

          <section className="case-audit-card">
            <header>
              <ClockCounterClockwise size={17} weight="duotone" aria-hidden="true" />
              <strong>Auditoría del caso</strong>
            </header>
            <ol>
              {detail.audit.map((entry) => (
                <li key={entry.id}>
                  <span className="case-audit-card__dot" />
                  <div>
                    <strong>{auditActionLabel(entry.action)}</strong>
                    <p>{entry.detail}</p>
                    <small>{entry.actor} · {formatDate(entry.at)}</small>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </aside>
    </>
  );
}
