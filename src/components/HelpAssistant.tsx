/**
 * Asistente de wiwo.sac: el orbe de ayuda, adaptado del asistente de WiwoMetriQ.
 *
 * El orbe vive en la barra superior y no flotando abajo a la derecha como en MetriQ: en
 * wiwo.sac esa esquina es la del botón Enviar en Gestión DMs/comentarios y en el detalle del
 * caso, y el orbe lo taparía. El orbe también es el estado: late en reposo, genera mientras
 * llega la respuesta y celebra un instante cuando llega.
 *
 * SOLO ORIENTA (lo refuerza el prompt en server/help-assistant.ts): no ejecuta acciones, no
 * navega y no ve casos ni mensajes. Responde según el rol y los permisos de la sesión.
 */
import { PaperPlaneRight, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { askHelpAssistant, loadAiAvailability, type HelpMessage } from "../lib/api";
import { ThinkingOrb, type OrbState } from "./ThinkingOrb";

const SUGGESTIONS = [
  "¿Qué puedo hacer con mi rol?",
  "¿Cómo respondo un DM o un comentario?",
  "¿Qué pasa si un caso está fuera de plazo?",
  "¿Cómo descarto el spam?",
];

/** Negritas con **texto**; el resto como texto plano (sin HTML del modelo). */
function AnswerText({ content }: { content: string }) {
  return (
    <>
      {content.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
        part.startsWith("**") && part.endsWith("**")
          ? <strong key={index}>{part.slice(2, -2)}</strong>
          : <span key={index}>{part}</span>)}
    </>
  );
}

export function HelpAssistant({ view, viewTitle }: { view: string; viewTitle: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<HelpMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"ia" | "guia" | null>(null);
  // En reposo late (`thinking`): `idle` es gris por diseño y como botón se lee apagado.
  const [orb, setOrb] = useState<OrbState>("thinking");
  const input = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    if (mode === null) void loadAiAvailability().then((availability) => setMode(availability.helpAssistant ?? "guia"));
  }, [mode, open]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, pending, open]);
  useEffect(() => () => request.current?.abort(), []);

  // Un clic fuera del panel y del orbe lo cierra, como los demás menús de la barra.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  async function ask(text: string) {
    const content = text.trim();
    if (!content || request.current) return;
    const abort = new AbortController();
    request.current = abort;
    setPending(content);
    setError("");
    setQuestion("");
    setOrb("generating");
    try {
      const history = messages.slice(-6).map((message) => ({ ...message, content: message.content.slice(0, 1_500) }));
      const timeout = window.setTimeout(() => abort.abort(), 50_000);
      const result = await askHelpAssistant([...history, { role: "user", content }], view, abort.signal)
        .finally(() => window.clearTimeout(timeout));
      setMessages((value) => [...value, { role: "user", content }, { role: "assistant", content: result.answer }]);
      if (result.source === "guia") setMode("guia");
      setOrb("success");
      window.setTimeout(() => setOrb("thinking"), 1_400);
    } catch (failure) {
      setError(failure instanceof Error && failure.name !== "AbortError"
        ? failure.message
        : "La respuesta tardó demasiado. Puedes volver a enviar tu pregunta.");
      setQuestion(content);
      setOrb("error");
      window.setTimeout(() => setOrb("thinking"), 2_200);
    } finally {
      request.current = null;
      setPending("");
      input.current?.focus();
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  // Sin IA solo responden las preguntas sugeridas (tienen respuesta escrita en la guía).
  const suggestions = mode === "ia" ? [`¿Para qué sirve ${viewTitle}?`, ...SUGGESTIONS] : SUGGESTIONS;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="help-orb-button"
        aria-expanded={open}
        aria-controls="wiwo-sac-assistant"
        aria-label={open ? "Cerrar el asistente de wiwo.sac" : "Abrir el asistente de wiwo.sac"}
        title="Asistente de wiwo.sac"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <ThinkingOrb size="md" state={orb} label="" />
      </button>

      {/* En un portal: la barra superior usa backdrop-filter, que atrapa a los hijos fijos en
          su propio contexto y dejaba el panel invisible debajo del contenido. */}
      {open ? createPortal(
        <aside
          ref={panel}
          id="wiwo-sac-assistant"
          className="help-assistant"
          aria-label="Asistente de wiwo.sac"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          <header className="help-assistant__header">
            <div>
              <h2>
                <ThinkingOrb size="sm" state={pending ? "generating" : "thinking"} label="" />
                Asistente de wiwo.sac
              </h2>
              <p>Te orienta sobre cómo usar wiwo.sac y lo que permite tu rol. No realiza cambios.</p>
            </div>
            <button type="button" className="icon-button" onClick={close} aria-label="Cerrar asistente">
              <X size={18} />
            </button>
          </header>

          <div ref={log} className="help-assistant__log" role="log" aria-label="Conversación" aria-live="polite" aria-relevant="additions">
            {!messages.length ? (
              <div className="help-assistant__intro">
                <p>¿Qué necesitas saber de wiwo.sac? Puedo explicarte dónde está una función y si tu rol permite usarla.</p>
                {mode === "guia" ? (
                  <p className="help-assistant__note">La IA está apagada en este servidor: respondo las preguntas sugeridas con la guía de uso.</p>
                ) : null}
                <div className="help-assistant__suggestions">
                  {suggestions.map((text) => (
                    <button type="button" key={text} disabled={Boolean(pending)} onClick={() => void ask(text)}>
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((message, index) => (
              <div key={index} className={`help-assistant__message help-assistant__message--${message.role}`}>
                <small>{message.role === "user" ? "Tú" : "wiwo.sac"}</small>
                <p><AnswerText content={message.content} /></p>
              </div>
            ))}
            {pending ? (
              <>
                <div className="help-assistant__message help-assistant__message--user"><small>Tú</small><p>{pending}</p></div>
                <p className="help-assistant__status" role="status">
                  <ThinkingOrb size="xs" state="thinking" label="" />
                  Preparando respuesta…
                </p>
              </>
            ) : null}
            {error ? <p className="help-assistant__error" role="alert">{error}</p> : null}
          </div>

          <form className="help-assistant__form" onSubmit={submit}>
            <label htmlFor="wiwo-sac-assistant-input" className="sr-only">Tu pregunta</label>
            <textarea
              id="wiwo-sac-assistant-input"
              ref={input}
              rows={1}
              value={question}
              maxLength={2_000}
              placeholder="Escribe tu pregunta…"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask(question);
                }
              }}
            />
            <button type="submit" disabled={!question.trim() || Boolean(pending)} aria-label="Enviar pregunta">
              <PaperPlaneRight size={17} weight="fill" />
            </button>
          </form>
        </aside>,
        document.body,
      ) : null}
    </>
  );
}
