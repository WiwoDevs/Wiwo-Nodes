import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChatCircleDots,
  LinkBreak,
  Plus,
  QrCode,
  Trash,
  WarningCircle,
  WhatsappLogo,
  X,
} from "@phosphor-icons/react";
import {
  createWhatsAppLine,
  linkWhatsAppLine,
  loadWhatsAppLines,
  removeWhatsAppLine,
  simulateWhatsAppMessage,
  unlinkWhatsAppLine,
} from "../lib/api";
import { confirmAction } from "../lib/confirm";
import type { WhatsAppAdminData, WhatsAppAdminLine, WhatsAppLineStatus } from "../types";
import { BusyOrb } from "./ThinkingOrb";

/** Mientras se vincula, el QR cambia cada ~20 s: se vuelve a leer seguido. */
const POLL_LINKING_MS = 3_000;
const POLL_IDLE_MS = 15_000;

const STATUS_LABEL: Record<WhatsAppLineStatus, string> = {
  pending_link: "Esperando vinculación",
  connecting: "Conectando…",
  connected: "Conectado",
  disconnected: "Reconectando…",
  logged_out: "Desvinculado desde el teléfono",
  unlinked: "Desvinculado",
  error: "Requiere atención",
};

function statusTone(status: WhatsAppLineStatus): "ok" | "wait" | "off" | "bad" {
  if (status === "connected") return "ok";
  if (status === "pending_link" || status === "connecting" || status === "disconnected") return "wait";
  if (status === "error" || status === "logged_out") return "bad";
  return "off";
}

function formatDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export interface WhatsAppLinesPanelProps {
  brands: Array<{ id: string; name: string }>;
  onClose: () => void;
  /** Avisa a la vista que cambió un número (para releer su estado). */
  onChanged?: () => void;
  onNotify: (tone: "success" | "warning", title: string, detail?: string) => void;
}

/**
 * Números de WhatsApp de las marcas. Solo admins principales: vincular un número le da a
 * wiwo.sac acceso a todos sus chats. Se vincula por QR o por código, desde el teléfono de la marca.
 */
export function WhatsAppLinesPanel({ brands, onClose, onChanged, onNotify }: WhatsAppLinesPanelProps) {
  const [data, setData] = useState<WhatsAppAdminData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [brandId, setBrandId] = useState("");
  const [label, setLabel] = useState("");
  const [method, setMethod] = useState<"qr" | "code">("qr");
  const [phoneNumber, setPhoneNumber] = useState("");
  // Pedirle al teléfono su historial al vincular (se importa como historial, no como casos).
  const [importHistory, setImportHistory] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await loadWhatsAppLines());
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudieron cargar los números.");
    }
  }, []);

  const linking = data?.lines.some((line) => line.desiredState === "linked" && line.status !== "connected") ?? false;
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), linking ? POLL_LINKING_MS : POLL_IDLE_MS);
    return () => window.clearInterval(timer);
  }, [linking, refresh]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const brandOptions = useMemo(
    () => [...brands].sort((left, right) => left.name.localeCompare(right.name, "es")),
    [brands],
  );
  const mode = data?.worker.mode;
  const workerNote = mode === "demo"
    ? "Modo demostración: el QR es de muestra, no vincula ningún teléfono, y los mensajes se simulan."
    : mode === "disabled"
      ? "WhatsApp no está habilitado en este servidor (SAC_FLOW_WHATSAPP_ENABLED y SAC_FLOW_WHATSAPP_WORKER_KEY)."
      : data && !data.worker.online
        ? "El worker de WhatsApp no responde. Los números no reciben ni envían hasta que vuelva (npm run dev:whatsapp o el servicio whatsapp)."
        : null;

  async function run(id: string, action: () => Promise<WhatsAppAdminData>, success?: [string, string?]) {
    setBusyId(id);
    try {
      setData(await action());
      onChanged?.();
      if (success) onNotify("success", success[0], success[1]);
    } catch (error) {
      onNotify("warning", "No se pudo completar la acción", error instanceof Error ? error.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!brandId || !label.trim()) return;
    setCreating(true);
    try {
      setData(await createWhatsAppLine({
        brandId,
        label: label.trim(),
        method,
        ...(method === "code" ? { phoneNumber } : {}),
        importHistory,
      }));
      setShowForm(false);
      setLabel("");
      setPhoneNumber("");
      onChanged?.();
    } catch (error) {
      onNotify("warning", "No se pudo agregar el número", error instanceof Error ? error.message : undefined);
    } finally {
      setCreating(false);
    }
  }

  async function handleUnlink(line: WhatsAppAdminLine) {
    const accepted = await confirmAction({
      title: `¿Desvincular «${line.label}»?`,
      message: "wiwo.sac cierra la sesión en WhatsApp y borra sus credenciales. Dejarán de entrar mensajes de este número y las respuestas en cola no saldrán.\n\nLas conversaciones ya recibidas se conservan.",
      confirmLabel: "Desvincular",
      tone: "danger",
    });
    if (!accepted) return;
    await run(line.id, () => unlinkWhatsAppLine(line.id), ["Número desvinculado", line.label]);
  }

  async function handleRemove(line: WhatsAppAdminLine) {
    const accepted = await confirmAction({
      title: `¿Quitar «${line.label}» de la lista?`,
      message: "El número ya está desvinculado. Sus conversaciones quedan en la bandeja.",
      confirmLabel: "Quitar",
      tone: "danger",
    });
    if (!accepted) return;
    await run(line.id, () => removeWhatsAppLine(line.id));
  }

  async function handleRelink(line: WhatsAppAdminLine, nextMethod: "qr" | "code") {
    // Con código se usa el número que el teléfono informó la última vez que estuvo conectado.
    const phone = nextMethod === "code" ? line.phoneNumber : undefined;
    await run(line.id, () => linkWhatsAppLine(line.id, nextMethod, phone, importHistory));
  }

  async function handleSimulate(line: WhatsAppAdminLine) {
    setBusyId(line.id);
    try {
      await simulateWhatsAppMessage(line.id);
      onChanged?.();
      onNotify("success", "Mensaje de prueba recibido", `${line.brandName} · revisa Gestión WhatsApp.`);
    } catch (error) {
      onNotify("warning", "No se pudo simular el mensaje", error instanceof Error ? error.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="account-credentials-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="account-credentials-panel whatsapp-lines" role="dialog" aria-modal="true" aria-labelledby="whatsapp-lines-title">
        <header>
          <span className="account-credentials-panel__icon">
            <WhatsappLogo size={20} weight="fill" aria-hidden="true" />
          </span>
          <div>
            <p className="view-header__eyebrow">Solo admins principales</p>
            <h2 id="whatsapp-lines-title">Números de WhatsApp</h2>
            <p>Cada número se vincula una vez desde el teléfono de la marca, como WhatsApp Web.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar números de WhatsApp" onClick={onClose}>
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </header>

        <p className="whatsapp-lines__risk">
          <WarningCircle size={16} weight="fill" aria-hidden="true" />
          <span>
            Conexión no oficial (WhatsApp Web): WhatsApp puede bloquear el número. Usa uno con historial, responde
            solo a quien escribió primero y evita textos idénticos a muchos chats.
          </span>
        </p>

        {workerNote ? <p className="metricool-import__notice whatsapp-lines__notice">{workerNote}</p> : null}
        {loadError ? <p className="metricool-import__notice metricool-import__notice--error" role="alert">{loadError}</p> : null}

        {!data && !loadError ? (
          <p className="metricool-import__loading"><BusyOrb /> Cargando números…</p>
        ) : null}

        {data ? (
          <ul className="whatsapp-lines__list">
            {data.lines.length === 0 ? (
              <li className="whatsapp-lines__empty">Aún no hay números. Agrega el primero y vincúlalo desde el teléfono de la marca.</li>
            ) : data.lines.map((line) => {
              const tone = statusTone(line.status);
              const busy = busyId === line.id;
              const waitingLink = line.desiredState === "linked" && line.status !== "connected";
              return (
                <li key={line.id} className="whatsapp-line">
                  <div className="whatsapp-line__head">
                    <div className="whatsapp-line__name">
                      <strong>{line.label}</strong>
                      <small>
                        {line.brandName}
                        {line.phoneNumber ? ` · ${line.phoneNumber}` : ""}
                        {line.displayName ? ` · ${line.displayName}` : ""}
                      </small>
                    </div>
                    <span className={`whatsapp-line__status whatsapp-line__status--${tone}`}>{STATUS_LABEL[line.status]}</span>
                  </div>

                  {line.lastError && line.status !== "connected" ? (
                    <p className="whatsapp-line__error">{line.lastError}</p>
                  ) : null}

                  {waitingLink && line.qrDataUrl ? (
                    <div className="whatsapp-line__link">
                      <img src={line.qrDataUrl} alt={`Código QR para vincular ${line.label}`} width={200} height={200} />
                      <ol>
                        <li>Abre WhatsApp en el teléfono de la marca.</li>
                        <li>Ve a <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b>.</li>
                        <li>Escanea este código. Se renueva solo cada pocos segundos.</li>
                      </ol>
                    </div>
                  ) : null}
                  {waitingLink && line.pairingCode ? (
                    <div className="whatsapp-line__link">
                      <span className="whatsapp-line__code" aria-label="Código de vinculación">{line.pairingCode}</span>
                      <ol>
                        <li>En el teléfono de la marca: WhatsApp → <b>Dispositivos vinculados</b>.</li>
                        <li><b>Vincular un dispositivo</b> → <b>Vincular con número de teléfono</b>.</li>
                        <li>Ingresa este código. Puedes dictarlo por llamada a quien tiene el teléfono.</li>
                      </ol>
                    </div>
                  ) : null}
                  {waitingLink && !line.qrDataUrl && !line.pairingCode && line.status !== "error" ? (
                    <p className="metricool-import__loading"><BusyOrb /> Esperando el {line.linkMethod === "code" ? "código" : "QR"} de WhatsApp…</p>
                  ) : null}

                  <div className="whatsapp-line__meta">
                    {line.status === "connected" && formatDate(line.linkedAt) ? <span>Vinculado {formatDate(line.linkedAt)}</span> : null}
                    {line.importHistory ? <span>Con historial del teléfono</span> : null}
                  </div>

                  <div className="whatsapp-line__actions">
                    {mode === "demo" && line.status === "connected" ? (
                      <button className="button button--secondary" type="button" disabled={busy} onClick={() => void handleSimulate(line)}>
                        <ChatCircleDots size={15} weight="bold" aria-hidden="true" /> Simular mensaje
                      </button>
                    ) : null}
                    {line.status !== "connected" && !(waitingLink && (line.status === "pending_link" || line.status === "connecting")) ? (
                      <button className="button button--secondary" type="button" disabled={busy || mode === "disabled"} onClick={() => void handleRelink(line, "qr")}>
                        <QrCode size={15} weight="bold" aria-hidden="true" /> {line.desiredState === "unlinked" ? "Vincular con QR" : "Volver a vincular"}
                      </button>
                    ) : null}
                    {line.status !== "connected" && line.phoneNumber && !(waitingLink && (line.status === "pending_link" || line.status === "connecting")) ? (
                      <button className="button button--secondary" type="button" disabled={busy || mode === "disabled"} onClick={() => void handleRelink(line, "code")}>
                        Vincular con código
                      </button>
                    ) : null}
                    {line.desiredState === "linked" ? (
                      <button className="button button--danger" type="button" disabled={busy} onClick={() => void handleUnlink(line)}>
                        {busy ? <BusyOrb size="xs" /> : <LinkBreak size={15} weight="bold" aria-hidden="true" />} Desvincular
                      </button>
                    ) : (
                      <button className="button button--secondary" type="button" disabled={busy} onClick={() => void handleRemove(line)}>
                        <Trash size={15} weight="bold" aria-hidden="true" /> Quitar
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        <label className="whatsapp-lines__history">
          <input type="checkbox" checked={importHistory} onChange={(event) => setImportHistory(event.target.checked)} />
          <span>
            <strong>Traer el historial del teléfono al vincular</strong>
            <small>
              WhatsApp lo entrega solo al vincular (suelen ser meses, no años) y el teléfono debe tener internet. Llega como
              historial de cada chat: no cuenta en Reportes, Clientes ni METRIQ, salvo el último mensaje sin responder de los
              últimos 7 días, que queda como caso. Para un número ya vinculado: desvincúlalo y vuelve a vincularlo con esto marcado,
              o usa «Cargar anteriores» en cada chat.
            </small>
          </span>
        </label>

        {showForm ? (
          <form className="whatsapp-lines__form" onSubmit={(event) => void handleCreate(event)}>
            <label className="form-field">
              <span>Marca</span>
              <select value={brandId} onChange={(event) => setBrandId(event.target.value)} required disabled={creating}>
                <option value="">Elige la marca</option>
                {brandOptions.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
              </select>
            </label>
            <label className="form-field">
              <span>Nombre del número</span>
              <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} placeholder="Ej.: Atención al cliente" required disabled={creating} />
            </label>
            <fieldset className="export-dialog__periods">
              <legend>Cómo vincular</legend>
              <label className={method === "qr" ? "is-selected" : undefined}>
                <input type="radio" name="whatsapp-method" checked={method === "qr"} onChange={() => setMethod("qr")} disabled={creating} />
                Escanear QR
              </label>
              <label className={method === "code" ? "is-selected" : undefined}>
                <input type="radio" name="whatsapp-method" checked={method === "code"} onChange={() => setMethod("code")} disabled={creating} />
                Código de 8 caracteres
              </label>
            </fieldset>
            {method === "code" ? (
              <label className="form-field">
                <span>Número de WhatsApp de la marca</span>
                <input
                  value={phoneNumber}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="Con código de país, ej.: +56 9 1234 5678"
                  required
                  disabled={creating}
                />
              </label>
            ) : null}
            <div className="metricool-import__actions">
              <button className="button button--secondary" type="button" onClick={() => setShowForm(false)} disabled={creating}>Cancelar</button>
              <button className="button button--primary" type="submit" disabled={creating || !brandId || !label.trim()}>
                {creating ? <BusyOrb /> : <Plus size={16} weight="bold" aria-hidden="true" />}
                {creating ? "Agregando…" : "Agregar y vincular"}
              </button>
            </div>
          </form>
        ) : (
          <div className="metricool-import__actions">
            <button className="button button--primary" type="button" onClick={() => setShowForm(true)} disabled={mode === "disabled"}>
              <Plus size={16} weight="bold" aria-hidden="true" /> Agregar número
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
