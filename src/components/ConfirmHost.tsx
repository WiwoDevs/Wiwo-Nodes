/** Diálogo de confirmación de la app: reemplaza las alertas del navegador. */
import { useEffect, useRef, useState } from "react";
import { Question, WarningCircle } from "@phosphor-icons/react";
import { subscribeConfirm, type ConfirmRequest } from "../lib/confirm";

export function ConfirmHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => subscribeConfirm(setRequest), []);

  useEffect(() => {
    if (!request) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // En acciones de riesgo el foco inicial queda en Cancelar: Enter no confirma por accidente.
    (request.tone === "danger" ? cancelRef : confirmRef).current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      // Ninguna otra parte de la app recibe teclas mientras se decide (Enter y Espacio
      // siguen activando el botón enfocado: es la acción por defecto del navegador).
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        request?.resolve(false);
      } else if (event.key === "Tab") {
        // Mantener el foco dentro del diálogo.
        const first = cancelRef.current;
        const last = confirmRef.current;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }
    // Captura: los atajos de la bandeja (J/K/R/E) no deben actuar con el diálogo abierto.
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [request]);

  if (!request) return null;
  const danger = request.tone === "danger";
  const paragraphs = (request.message ?? "").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);

  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onPointerDown={(event) => { if (event.target === event.currentTarget) request.resolve(false); }}
    >
      <section
        className={`confirm-dialog${danger ? " confirm-dialog--danger" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`confirm-title-${request.id}`}
        aria-describedby={paragraphs.length ? `confirm-message-${request.id}` : undefined}
      >
        <span className="confirm-dialog__icon" aria-hidden="true">
          {danger ? <WarningCircle size={22} weight="fill" /> : <Question size={22} weight="fill" />}
        </span>
        <div className="confirm-dialog__copy">
          <h2 id={`confirm-title-${request.id}`}>{request.title}</h2>
          {paragraphs.length ? (
            <div id={`confirm-message-${request.id}`}>
              {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            </div>
          ) : null}
        </div>
        <footer className="confirm-dialog__actions">
          <button ref={cancelRef} className="button button--secondary" type="button" onClick={() => request.resolve(false)}>
            {request.cancelLabel ?? "Cancelar"}
          </button>
          <button
            ref={confirmRef}
            className={`button ${danger ? "button--danger" : "button--primary"}`}
            type="button"
            onClick={() => request.resolve(true)}
          >
            {request.confirmLabel ?? "Confirmar"}
          </button>
        </footer>
      </section>
    </div>
  );
}
