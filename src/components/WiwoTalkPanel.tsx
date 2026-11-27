import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowsClockwise,
  ChatCircleDots,
  Copy,
  Key,
  Pause,
  Play,
  Plugs,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import {
  createWiwoTalkConnection,
  loadWiwoTalkConnections,
  pauseWiwoTalkConnection,
  removeWiwoTalkConnection,
  replaceWiwoTalkToken,
  rotateWiwoTalkWebhookSecret,
  simulateWiwoTalkMessage,
  syncWiwoTalkConnection,
} from "../lib/api";
import { confirmAction } from "../lib/confirm";
import type { WiwoTalkConnectionStatus, WiwoTalkConnectionView } from "../types";
import { BusyOrb } from "./ThinkingOrb";

const STATUS_LABEL: Record<WiwoTalkConnectionStatus, string> = {
  active: "Conectada",
  error: "Requiere atención",
  paused: "En pausa",
};

const STATUS_TONE: Record<WiwoTalkConnectionStatus, "ok" | "bad" | "off"> = {
  active: "ok",
  error: "bad",
  paused: "off",
};

/** Motivos legibles de los códigos de error que guarda la API (nunca datos de clientes). */
const ERROR_LABEL: Record<string, string> = {
  WIWO_TALK_TOKEN_INVALID: "WiWO Talk rechazó el token: cámbialo por uno vigente.",
  WIWO_TALK_SCOPE_MISSING: "Al token le falta un permiso (scope). Agrégalo en la integración privada; el token no cambia.",
  WIWO_TALK_NOT_FOUND: "WiWO Talk no encontró la subcuenta: revisa el Location ID.",
  WIWO_TALK_RATE_LIMITED: "WiWO Talk pidió esperar por exceso de solicitudes. Se reintenta solo.",
  WIWO_TALK_DAILY_LIMIT: "Se acabó el cupo diario de la API de WiWO Talk. Se reintenta mañana.",
  WIWO_TALK_UNREACHABLE: "No se pudo conectar con WiWO Talk. Se reintenta en la próxima conciliación.",
};

function formatDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? undefined
    : date.toLocaleString("es-CL", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function webhookUrl(connection: WiwoTalkConnectionView): string {
  return `${window.location.origin}${connection.webhookPath}?key=${encodeURIComponent(connection.webhookSecret)}`;
}

export interface WiwoTalkPanelProps {
  /** Clientes que se pueden conectar (los marcados «En SAC» en Clientes). */
  brands: Array<{ id: string; name: string }>;
  /** Todos los clientes, para nombrar conexiones de clientes que ya no están En SAC. */
  brandLabels?: Array<{ id: string; name: string }>;
  /** La lista se limitó a los clientes En SAC. */
  onlySac?: boolean;
  onClose: () => void;
  /** Avisa a la vista que cambió una conexión (para releer el estado y la bandeja). */
  onChanged?: () => void;
  onNotify: (tone: "success" | "warning", title: string, detail?: string) => void;
}

/**
 * Conexiones con subcuentas de WiWO Talk (HighLevel) para atender su WhatsApp desde wiwo.sac.
 * Solo admins: el token da acceso a todos los chats y contactos de la subcuenta. Se
 * guarda cifrado en la base y nunca vuelve al navegador.
 */
export function WiwoTalkPanel({ brands, brandLabels, onlySac = false, onClose, onChanged, onNotify }: WiwoTalkPanelProps) {
  const [connections, setConnections] = useState<WiwoTalkConnectionView[] | null>(null);
  const [demo, setDemo] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [brandId, setBrandId] = useState("");
  const [label, setLabel] = useState("");
  const [locationId, setLocationId] = useState("");
  const [token, setToken] = useState("");
  // Conexión cuyo webhook se muestra (la URL lleva el secreto: se ve solo al pedirla).
  const [shownWebhook, setShownWebhook] = useState<string | null>(null);
  const [tokenFor, setTokenFor] = useState<string | null>(null);
  const [newToken, setNewToken] = useState("");

  const refresh = useCallback(async () => {
    try {
      const data = await loadWiwoTalkConnections();
      setConnections(data.connections);
      setDemo(data.demo);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No se pudieron cargar las conexiones.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

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
  const brandName = (id: string) => (brandLabels ?? brands).find((brand) => brand.id === id)?.name ?? brands.find((brand) => brand.id === id)?.name ?? id;

  async function run(id: string, action: () => Promise<WiwoTalkConnectionView[]>, success?: [string, string?]) {
    setBusyId(id);
    try {
      setConnections(await action());
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
    if (!brandId || !label.trim() || !locationId.trim() || !token.trim()) return;
    setCreating(true);
    try {
      const next = await createWiwoTalkConnection({ brandId, label: label.trim(), locationId: locationId.trim(), token: token.trim() });
      setConnections(next);
      const created = next.find((connection) => connection.locationId === locationId.trim());
      setShowForm(false);
      setLabel("");
      setLocationId("");
      setToken("");
      if (created) setShownWebhook(created.id);
      onChanged?.();
      onNotify("success", "Subcuenta conectada", demo
        ? "Modo demostración: usa «Simular mensaje» para probarla."
        : "Trayendo los chats recientes como historial. Falta configurar el webhook en el workflow.");
    } catch (error) {
      onNotify("warning", "No se pudo conectar la subcuenta", error instanceof Error ? error.message : undefined);
    } finally {
      setCreating(false);
    }
  }

  async function handleReplaceToken(connection: WiwoTalkConnectionView) {
    if (!newToken.trim()) return;
    await run(connection.id, () => replaceWiwoTalkToken(connection.id, newToken.trim()), ["Token reemplazado", connection.label]);
    setTokenFor(null);
    setNewToken("");
  }

  async function handleRotateSecret(connection: WiwoTalkConnectionView) {
    const accepted = await confirmAction({
      title: `¿Cambiar la clave del webhook de «${connection.label}»?`,
      message: "La URL actual deja de funcionar de inmediato. Hasta que pegues la nueva en el workflow de WiWO Talk, los mensajes llegan solo con la conciliación periódica.",
      confirmLabel: "Cambiar clave",
      tone: "danger",
    });
    if (!accepted) return;
    await run(connection.id, () => rotateWiwoTalkWebhookSecret(connection.id), ["Nueva URL de webhook lista", "Pégala en el workflow de la subcuenta."]);
    setShownWebhook(connection.id);
  }

  async function handleRemove(connection: WiwoTalkConnectionView) {
    const accepted = await confirmAction({
      title: `¿Quitar la conexión «${connection.label}»?`,
      message: "wiwo.sac borra el token y deja de leer y responder esta subcuenta. Las conversaciones ya traídas se conservan.\n\nEn WiWO Talk, desactiva también el workflow que llama al webhook.",
      confirmLabel: "Quitar",
      tone: "danger",
    });
    if (!accepted) return;
    await run(connection.id, () => removeWiwoTalkConnection(connection.id), ["Conexión quitada", connection.label]);
  }

  async function handleSimulate(connection: WiwoTalkConnectionView) {
    setBusyId(connection.id);
    try {
      await simulateWiwoTalkMessage(connection.id);
      onChanged?.();
      onNotify("success", "Mensaje de prueba recibido", `${brandName(connection.brandId)} · revisa Gestión WhatsApp.`);
    } catch (error) {
      onNotify("warning", "No se pudo simular el mensaje", error instanceof Error ? error.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function copyWebhook(connection: WiwoTalkConnectionView) {
    try {
      await navigator.clipboard.writeText(webhookUrl(connection));
      onNotify("success", "URL del webhook copiada");
    } catch {
      onNotify("warning", "No se pudo copiar", "Selecciona la URL y cópiala a mano.");
    }
  }

  return (
    <div className="account-credentials-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="account-credentials-panel whatsapp-lines wiwo-talk" role="dialog" aria-modal="true" aria-labelledby="wiwo-talk-title">
        <header>
          <span className="account-credentials-panel__icon">
            <Plugs size={20} weight="fill" aria-hidden="true" />
          </span>
          <div>
            <p className="view-header__eyebrow">Solo admins</p>
            <h2 id="wiwo-talk-title">Conexiones WiWO Talk</h2>
            <p>Conecta el WhatsApp de cada cliente En SAC con su subcuenta de WiWO Talk (Boost) para atenderlo desde wiwo.sac.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar conexiones WiWO Talk" onClick={onClose}>
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </header>

        {demo ? (
          <p className="metricool-import__notice whatsapp-lines__notice">
            Modo demostración: el token no se verifica contra WiWO Talk y los mensajes se simulan.
          </p>
        ) : null}
        {loadError ? <p className="metricool-import__notice metricool-import__notice--error" role="alert">{loadError}</p> : null}
        {!connections && !loadError ? <p className="metricool-import__loading"><BusyOrb /> Cargando conexiones…</p> : null}

        {connections ? (
          <ul className="whatsapp-lines__list">
            {connections.length === 0 ? (
              <li className="whatsapp-lines__empty">
                Aún no hay clientes conectados. Para cada cliente En SAC necesitas el token de integración privada (pit-…) y el Location ID de su subcuenta en WiWO Talk.
              </li>
            ) : connections.map((connection) => {
              const busy = busyId === connection.id;
              const tone = STATUS_TONE[connection.status];
              return (
                <li key={connection.id} className="whatsapp-line">
                  <div className="whatsapp-line__head">
                    <div className="whatsapp-line__name">
                      <strong>{connection.label}</strong>
                      <small>
                        {brandName(connection.brandId)}
                        {connection.locationName ? ` · ${connection.locationName}` : ""}
                        {` · token …${connection.tokenHint}`}
                      </small>
                    </div>
                    <span className={`whatsapp-line__status whatsapp-line__status--${tone}`}>{STATUS_LABEL[connection.status]}</span>
                  </div>

                  {connection.lastError ? (
                    <p className="whatsapp-line__error">
                      {ERROR_LABEL[connection.lastError] ?? `Último error: ${connection.lastError}.`}
                      {formatDate(connection.lastErrorAt) ? ` (${formatDate(connection.lastErrorAt)})` : ""}
                    </p>
                  ) : null}

                  <div className="whatsapp-line__meta">
                    <span>Location ID {connection.locationId}</span>
                    {formatDate(connection.lastSyncAt) ? <span>Leído {formatDate(connection.lastSyncAt)}</span> : <span>Aún sin leer</span>}
                    {formatDate(connection.lastWebhookAt)
                      ? <span>Último aviso del webhook {formatDate(connection.lastWebhookAt)}</span>
                      : <span>El webhook aún no avisa nada</span>}
                  </div>

                  {shownWebhook === connection.id ? (
                    <div className="wiwo-talk__webhook">
                      <p>
                        En la subcuenta, crea un workflow con disparador <b>Customer Replied</b> (canal WhatsApp), excluye a los
                        contactos que atiende el bot y agrega la acción <b>Webhook</b> (POST) a esta URL. Basta con que envíe el
                        id del contacto: wiwo.sac lee el mensaje por la API.
                      </p>
                      <div className="wiwo-talk__url">
                        <input readOnly value={webhookUrl(connection)} aria-label="URL del webhook" onFocus={(event) => event.currentTarget.select()} />
                        <button className="button button--secondary" type="button" onClick={() => void copyWebhook(connection)}>
                          <Copy size={15} weight="bold" aria-hidden="true" /> Copiar
                        </button>
                      </div>
                      <small>La URL lleva una clave propia: compártela solo por un canal seguro.</small>
                    </div>
                  ) : null}

                  {tokenFor === connection.id ? (
                    <form className="wiwo-talk__token" onSubmit={(event) => {
                      event.preventDefault();
                      void handleReplaceToken(connection);
                    }}>
                      <label className="form-field">
                        <span>Nuevo token de integración privada</span>
                        <input
                          type="password"
                          value={newToken}
                          onChange={(event) => setNewToken(event.target.value)}
                          autoComplete="off"
                          spellCheck={false}
                          placeholder="pit-…"
                          required
                          disabled={busy}
                        />
                      </label>
                      <div className="metricool-import__actions">
                        <button className="button button--secondary" type="button" onClick={() => { setTokenFor(null); setNewToken(""); }} disabled={busy}>Cancelar</button>
                        <button className="button button--primary" type="submit" disabled={busy || !newToken.trim()}>
                          {busy ? <BusyOrb /> : null} Guardar token
                        </button>
                      </div>
                    </form>
                  ) : null}

                  <div className="whatsapp-line__actions">
                    {demo ? (
                      <button className="button button--secondary" type="button" disabled={busy} onClick={() => void handleSimulate(connection)}>
                        <ChatCircleDots size={15} weight="bold" aria-hidden="true" /> Simular mensaje
                      </button>
                    ) : (
                      <button
                        className="button button--secondary"
                        type="button"
                        disabled={busy || connection.status === "paused"}
                        onClick={() => void run(connection.id, () => syncWiwoTalkConnection(connection.id), ["Subcuenta leída", connection.label])}
                      >
                        {busy ? <BusyOrb size="xs" /> : <ArrowsClockwise size={15} weight="bold" aria-hidden="true" />} Sincronizar ahora
                      </button>
                    )}
                    <button
                      className="button button--secondary"
                      type="button"
                      onClick={() => setShownWebhook((current) => (current === connection.id ? null : connection.id))}
                    >
                      {shownWebhook === connection.id ? "Ocultar webhook" : "Ver webhook"}
                    </button>
                    <button className="button button--secondary" type="button" disabled={busy} onClick={() => { setTokenFor(connection.id); setNewToken(""); }}>
                      <Key size={15} weight="bold" aria-hidden="true" /> Cambiar token
                    </button>
                    <button className="button button--secondary" type="button" disabled={busy} onClick={() => void handleRotateSecret(connection)}>
                      Nueva clave de webhook
                    </button>
                    <button
                      className="button button--secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => void run(connection.id, () => pauseWiwoTalkConnection(connection.id, connection.status !== "paused"))}
                    >
                      {connection.status === "paused"
                        ? <><Play size={15} weight="bold" aria-hidden="true" /> Reanudar</>
                        : <><Pause size={15} weight="bold" aria-hidden="true" /> Pausar</>}
                    </button>
                    <button className="button button--danger" type="button" disabled={busy} onClick={() => void handleRemove(connection)}>
                      <Trash size={15} weight="bold" aria-hidden="true" /> Quitar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        {showForm ? (
          <form className="whatsapp-lines__form" onSubmit={(event) => void handleCreate(event)} autoComplete="off">
            <label className="form-field">
              <span>{onlySac ? "Cliente En SAC" : "Cliente"}</span>
              <select value={brandId} onChange={(event) => setBrandId(event.target.value)} required disabled={creating}>
                <option value="">{brandOptions.length ? "Elige el cliente" : "No hay clientes En SAC"}</option>
                {brandOptions.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
              </select>
              {onlySac ? <small>Solo aparecen los clientes marcados «En SAC» en Clientes.</small> : null}
            </label>
            <label className="form-field">
              <span>Nombre de la conexión</span>
              <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} placeholder="Ej.: WhatsApp del cliente" required disabled={creating} />
            </label>
            <label className="form-field">
              <span>Location ID de la subcuenta</span>
              <input
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
                maxLength={64}
                spellCheck={false}
                placeholder="Settings → Business Profile, o en la URL …/location/{id}/…"
                required
                disabled={creating}
              />
            </label>
            <label className="form-field">
              <span>Token de integración privada</span>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="pit-…"
                required
                disabled={creating}
              />
              <small>Se guarda cifrado y no se vuelve a mostrar. Se comprueba contra WiWO Talk antes de guardarlo.</small>
            </label>
            <div className="metricool-import__actions">
              <button className="button button--secondary" type="button" onClick={() => setShowForm(false)} disabled={creating}>Cancelar</button>
              <button className="button button--primary" type="submit" disabled={creating || !brandId || !label.trim() || !locationId.trim() || !token.trim()}>
                {creating ? <BusyOrb /> : <Plus size={16} weight="bold" aria-hidden="true" />}
                {creating ? "Comprobando…" : "Conectar subcuenta"}
              </button>
            </div>
          </form>
        ) : (
          <div className="metricool-import__actions">
            <button className="button button--primary" type="button" onClick={() => setShowForm(true)}>
              <Plus size={16} weight="bold" aria-hidden="true" /> Conectar subcuenta
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
