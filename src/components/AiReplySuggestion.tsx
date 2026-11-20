/**
 * Recomendación de respuesta con IA (DeepSeek vía BytePlus, o el proveedor configurado),
 * basada en el QA aprobado de la marca. Se pide sola al abrir un caso abierto de una marca
 * autorizada; el servidor la guarda en caché, así que reabrir el caso no vuelve a cobrar.
 *
 * Es una ayuda: el texto solo pasa al compositor con "Usar recomendación" y se envía por el
 * camino manual de siempre. Si la IA no está disponible para la marca, se muestra la
 * sugerencia por reglas del protocolo SAC, rotulada como tal.
 */
import { ArrowClockwise, Sparkle, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { loadAiAvailability, requestAiReplyDraft, type AiAvailability, type AiReplyDraft } from "../lib/api";
import { BusyOrb } from "./ThinkingOrb";

export interface AiReplySuggestionProps {
  interactionId: string;
  accountId: string;
  /** Hay algo que sugerir: caso entrante y abierto, y la persona puede responder. */
  active: boolean;
  /** Mensaje para un caso cerrado (solo en la variante de panel). */
  closedMessage?: string;
  /** Sugerencia por reglas del protocolo SAC, para cuando la IA no está disponible. */
  ruleText: string;
  ruleGrounded: boolean;
  ruleSourceCount: number;
  disabled: boolean;
  onUse: (text: string) => void;
  variant: "panel" | "compact";
}

type DraftState =
  | { status: "idle" }
  | { status: "loading"; regenerate: boolean }
  | { status: "ready"; draft: AiReplyDraft }
  | { status: "error"; message: string };

function providerLabel(draft: AiReplyDraft): string {
  return draft.proveedor === "byteplus" ? "DeepSeek" : draft.proveedor === "anthropic" ? "Claude" : "IA";
}

export function AiReplySuggestion(props: AiReplySuggestionProps) {
  const { interactionId, accountId, active, variant } = props;
  const [availability, setAvailability] = useState<AiAvailability | null>(null);
  const [state, setState] = useState<DraftState>({ status: "idle" });
  const requestRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void loadAiAvailability().then((result) => {
      if (!cancelled) setAvailability(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const aiEnabled = Boolean(availability?.replyDrafts && availability.accountIds.includes(accountId));

  const generate = (regenerate: boolean) => {
    const requestId = ++requestRef.current;
    setState({ status: "loading", regenerate });
    requestAiReplyDraft(interactionId, regenerate)
      .then((draft) => {
        if (requestRef.current === requestId) setState({ status: "ready", draft });
      })
      .catch((error: unknown) => {
        if (requestRef.current === requestId) {
          setState({ status: "error", message: error instanceof Error ? error.message : "No fue posible generar la recomendación." });
        }
      });
  };

  useEffect(() => {
    requestRef.current += 1;
    if (aiEnabled && active) generate(false);
    else setState({ status: "idle" });
    // Una sugerencia por caso: cambia al abrir otro caso, no con cada edición del compositor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiEnabled, active, interactionId]);

  const draft = state.status === "ready" ? state.draft : undefined;
  const usingAi = aiEnabled && active;
  const text = usingAi ? draft?.texto ?? "" : active ? props.ruleText : "";
  const grounded = usingAi ? Boolean(draft && !draft.sinRespuestaAprobada && draft.fuentes.length) : props.ruleGrounded;

  const title = usingAi ? "Recomendación de respuesta con IA" : "Respuesta sugerida por reglas";
  const subtitle = usingAi
    ? state.status === "loading"
      ? "Leyendo el caso y el QA aprobado…"
      : state.status === "error"
        ? "No se pudo generar"
        : draft
          ? draft.sinRespuestaAprobada
            ? `${providerLabel(draft)} · sin respuesta aprobada que la cubra; revisa antes de usar`
            : `${providerLabel(draft)} · basada en QA aprobado · ${draft.fuentes.length} fuente(s)`
          : "Requiere revisión humana"
    : props.ruleGrounded
      ? `QA aprobado · ${props.ruleSourceCount} fuente(s)`
      : "Plantilla del protocolo SAC; requiere revisión humana";

  const notes: string[] = [];
  if (draft?.requiereHumano) notes.push("Caso delicado: revísalo con criterio antes de responder.");
  if (draft) notes.push(...draft.advertencias);

  const regenerateButton = usingAi && state.status !== "loading" ? (
    <button
      className={variant === "panel" ? "button button--tertiary" : undefined}
      type="button"
      onClick={() => generate(true)}
      disabled={props.disabled}
      title="Pedir otra recomendación"
    >
      <ArrowClockwise size={14} weight="bold" aria-hidden="true" />
      {variant === "panel" ? "Otra sugerencia" : <span className="sr-only">Otra sugerencia</span>}
    </button>
  ) : null;

  if (variant === "compact") {
    const body = state.status === "loading"
      ? <p className="ai-suggestion__busy"><BusyOrb size="xs" /> Generando…</p>
      : state.status === "error"
        ? <p role="alert" title={state.message}>{state.message}</p>
        : <p title={text || undefined}>{text || "Sin sugerencia para este caso."}</p>;
    return (
      <div className={`manual-inbox-recommendation${text || state.status !== "idle" ? "" : " is-empty"}${notes.length ? " has-notes" : ""}`}>
        <span>{state.status === "loading" ? <BusyOrb size="xs" /> : <Sparkle size={14} weight="fill" aria-hidden="true" />}</span>
        <div>
          <strong>{usingAi ? "Recomendación IA" : "Sugerencia por reglas"}</strong>
          <small>{subtitle}</small>
          {body}
          {notes.length ? (
            <small className="ai-suggestion__note" title={notes.join(" ")}>
              <WarningCircle size={12} weight="fill" aria-hidden="true" /> {notes[0]}
            </small>
          ) : null}
        </div>
        <div className="ai-suggestion__actions">
          {regenerateButton}
          {text ? (
            <button type="button" onClick={() => props.onUse(text)} disabled={props.disabled}>
              Usar sugerencia
            </button>
          ) : state.status === "error" ? (
            <button type="button" onClick={() => generate(false)} disabled={props.disabled}>Reintentar</button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <section className={`case-ai-recommendation${grounded ? " case-ai-recommendation--grounded" : ""}`} aria-busy={state.status === "loading"}>
      <header>
        <span className="case-ai-recommendation__icon">
          {state.status === "loading" ? <BusyOrb size="xs" /> : <Sparkle size={18} weight="fill" aria-hidden="true" />}
        </span>
        <div>
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </div>
        <span>{usingAi ? draft ? providerLabel(draft) : "IA" : "Reglas"}</span>
      </header>
      {!active && props.closedMessage
        ? <p>{props.closedMessage}</p>
        : state.status === "loading"
          ? <p className="ai-suggestion__busy"><BusyOrb size="xs" /> Generando una respuesta con el QA aprobado de la marca…</p>
          : state.status === "error"
            ? <p role="alert">{state.message}</p>
            : text
              ? <p>{text}</p>
              : <p>No hay una recomendación disponible. Ejecuta el Protocolo SAC para evaluar este caso.</p>}
      {notes.length ? (
        <ul className="ai-suggestion__notes">
          {notes.map((note) => (
            <li key={note}><WarningCircle size={13} weight="fill" aria-hidden="true" /> {note}</li>
          ))}
        </ul>
      ) : null}
      {draft?.motivo ? <small className="ai-suggestion__reason">{draft.motivo}</small> : null}
      <div className="ai-suggestion__actions">
        <button
          className="button button--secondary"
          type="button"
          disabled={props.disabled || !active || !text}
          onClick={() => props.onUse(text)}
        >
          <Sparkle size={15} weight="bold" aria-hidden="true" />
          Usar recomendación
        </button>
        {regenerateButton}
        {state.status === "error" ? (
          <button className="button button--tertiary" type="button" onClick={() => generate(false)} disabled={props.disabled}>
            Reintentar
          </button>
        ) : null}
      </div>
    </section>
  );
}
