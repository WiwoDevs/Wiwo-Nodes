/**
 * Importa marcas reales desde el catálogo de Metricool y, opcionalmente, retira las marcas
 * locales que no tienen referencia a Metricool (por ejemplo, las de ejemplo del seed).
 *
 * Nada de esto escribe en Metricool: listar es de solo lectura e importar crea marcas
 * locales con su blogId. Desactivar una marca no borra su historial.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, CheckCircle, CloudArrowDown, WarningCircle, X } from "@phosphor-icons/react";
import {
  listMetricoolBrands,
  type MetricoolCatalogBrand,
  type MetricoolImportResult,
} from "../lib/api";
import type { BrandAccount, MetricoolInstagramProvider } from "../types";

const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  google_business: "Google Business",
};

const SKIP_REASON: Record<string, string> = {
  ALREADY_LINKED: "ya estaba vinculada",
  NO_SUPPORTED_CHANNELS: "no tiene canales que la bandeja pueda leer",
};

type MetricoolImportDialogProps = {
  accounts: BrandAccount[];
  onClose: () => void;
  onImport: (blogIds: string[], instagramProvider: MetricoolInstagramProvider) => Promise<MetricoolImportResult>;
  onDeactivate: (accounts: BrandAccount[]) => Promise<void>;
};

export function MetricoolImportDialog({ accounts, onClose, onImport, onDeactivate }: MetricoolImportDialogProps) {
  const [catalog, setCatalog] = useState<MetricoolCatalogBrand[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [provider, setProvider] = useState<MetricoolInstagramProvider>("INSTAGRAMBUSINESS");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<MetricoolImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [toRetire, setToRetire] = useState<Set<string>>(new Set());
  const [retiring, setRetiring] = useState(false);

  async function loadCatalog() {
    setLoadError(null);
    setCatalog(null);
    try {
      const brands = await listMetricoolBrands();
      setCatalog(brands);
      // Sin preselección: el catálogo puede incluir marcas que no se atienden en SAC.
      setSelected(new Set());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "No fue posible leer el catálogo de Metricool.");
    }
  }

  useEffect(() => {
    void loadCatalog();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !importing && !retiring) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [importing, retiring, onClose]);

  // Marcas activas sin referencia a Metricool: nunca sincronizan (p. ej. las de ejemplo).
  const unlinked = useMemo(
    () => accounts.filter((account) => account.brandActive !== false && !account.metricoolReferenceStored && !account.metricoolLiveReady),
    [accounts],
  );

  const available = catalog?.filter((brand) => !brand.linkedTo) ?? [];
  const allSelected = available.length > 0 && available.every((brand) => selected.has(brand.blogId));

  function toggle(set: Set<string>, value: string): Set<string> {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  }

  async function handleImport() {
    if (!selected.size || importing) return;
    setImporting(true);
    setImportError(null);
    try {
      const imported = await onImport([...selected], provider);
      setResult(imported);
      await loadCatalog();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "No fue posible importar las marcas.");
    } finally {
      setImporting(false);
    }
  }

  async function handleRetire() {
    const targets = unlinked.filter((account) => toRetire.has(account.id));
    if (!targets.length || retiring) return;
    const confirmed = window.confirm(
      `¿Desactivar ${targets.length} marca(s) sin conexión a Metricool? No se borra su historial; dejan de aparecer en la operación y en la sincronización.`,
    );
    if (!confirmed) return;
    setRetiring(true);
    try {
      await onDeactivate(targets);
      setToRetire(new Set());
    } finally {
      setRetiring(false);
    }
  }

  return (
    <div className="account-credentials-backdrop" role="presentation">
      <section className="account-credentials-panel metricool-import" role="dialog" aria-modal="true" aria-labelledby="metricool-import-title">
        <header>
          <span className="account-credentials-panel__icon">
            <CloudArrowDown size={20} weight="fill" aria-hidden="true" />
          </span>
          <div>
            <p className="view-header__eyebrow">Conexión Metricool</p>
            <h2 id="metricool-import-title">Importar marcas desde Metricool</h2>
            <p>Trae las marcas que ve el token del servidor. Solo lectura: no se modifica nada en Metricool.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar importación" onClick={onClose} disabled={importing || retiring}>
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </header>

        {loadError ? (
          <div className="metricool-import__notice metricool-import__notice--error" role="alert">
            <WarningCircle size={18} weight="fill" aria-hidden="true" />
            <span>{loadError}</span>
            <button className="button button--secondary" type="button" onClick={() => void loadCatalog()}>
              <ArrowsClockwise size={15} aria-hidden="true" /> Reintentar
            </button>
          </div>
        ) : !catalog ? (
          <p className="metricool-import__loading" role="status">
            <ArrowsClockwise className="spin" size={16} aria-hidden="true" /> Leyendo el catálogo de Metricool…
          </p>
        ) : (
          <>
            <div className="metricool-import__toolbar">
              <span>
                {catalog.length} marca(s) en Metricool · {available.length} disponible(s) · {catalog.length - available.length} ya vinculada(s)
              </span>
              {available.length ? (
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setSelected(allSelected ? new Set() : new Set(available.map((brand) => brand.blogId)))}
                >
                  {allSelected ? "Quitar selección" : "Seleccionar todas"}
                </button>
              ) : null}
            </div>

            <ul className="metricool-import__list">
              {catalog.map((brand) => {
                const linked = Boolean(brand.linkedTo);
                return (
                  <li key={brand.blogId} className={linked ? "is-linked" : undefined}>
                    <label>
                      <input
                        type="checkbox"
                        checked={linked || selected.has(brand.blogId)}
                        disabled={linked || importing}
                        onChange={() => setSelected((current) => toggle(current, brand.blogId))}
                      />
                      <span className="metricool-import__brand">
                        <strong>{brand.label}</strong>
                        <small>
                          blogId {brand.blogId}
                          {brand.channels.length ? ` · ${brand.channels.map((channel) => CHANNEL_LABEL[channel] ?? channel).join(", ")}` : " · sin redes conectadas"}
                        </small>
                      </span>
                      {linked ? <span className="metricool-import__tag">Vinculada a {brand.linkedTo!.brandName}</span> : null}
                    </label>
                  </li>
                );
              })}
            </ul>

            <label className="form-field">
              <span>Conexión de Instagram en Metricool</span>
              <select value={provider} onChange={(event) => setProvider(event.target.value as MetricoolInstagramProvider)} disabled={importing}>
                <option value="INSTAGRAMBUSINESS">Conectada a través de Facebook (INSTAGRAMBUSINESS)</option>
                <option value="INSTAGRAM">Conectada con credenciales de Instagram (INSTAGRAM)</option>
              </select>
              <small>Si una bandeja queda vacía, la sincronización prueba también la otra opción.</small>
            </label>

            {importError ? (
              <p className="metricool-import__notice metricool-import__notice--error" role="alert">
                <WarningCircle size={18} weight="fill" aria-hidden="true" /> {importError}
              </p>
            ) : null}

            {result ? (
              <div className="metricool-import__notice metricool-import__notice--ok" role="status">
                <CheckCircle size={18} weight="fill" aria-hidden="true" />
                <span>
                  {result.created.length} marca(s) importada(s).
                  {result.skipped.length
                    ? ` Omitidas: ${result.skipped.map((item) => `${item.blogId} (${SKIP_REASON[item.reason] ?? item.reason})`).join(", ")}.`
                    : ""}
                  {" "}Los mensajes llegan con la próxima sincronización.
                </span>
              </div>
            ) : null}

            <div className="metricool-import__actions">
              <button className="button button--primary" type="button" onClick={() => void handleImport()} disabled={!selected.size || importing}>
                {importing ? <ArrowsClockwise className="spin" size={16} aria-hidden="true" /> : <CloudArrowDown size={16} weight="bold" aria-hidden="true" />}
                {importing ? "Importando…" : `Importar ${selected.size} marca(s)`}
              </button>
            </div>
          </>
        )}

        {unlinked.length ? (
          <section className="metricool-import__retire" aria-labelledby="metricool-retire-title">
            <h3 id="metricool-retire-title">Marcas sin conexión a Metricool</h3>
            <p>
              Estas marcas no tienen referencia a Metricool, así que nunca sincronizan (por ejemplo, las de ejemplo). Desactivarlas no borra su historial.
            </p>
            <ul className="metricool-import__list metricool-import__list--compact">
              {unlinked.map((account) => (
                <li key={account.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={toRetire.has(account.id)}
                      disabled={retiring}
                      onChange={() => setToRetire((current) => toggle(current, account.id))}
                    />
                    <span className="metricool-import__brand">
                      <strong>{account.name}</strong>
                      <small>{account.accountHandle || account.id}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="metricool-import__actions">
              <button
                className="text-button"
                type="button"
                onClick={() => setToRetire(toRetire.size === unlinked.length ? new Set() : new Set(unlinked.map((account) => account.id)))}
                disabled={retiring}
              >
                {toRetire.size === unlinked.length ? "Quitar selección" : "Seleccionar todas"}
              </button>
              <button className="button button--danger" type="button" onClick={() => void handleRetire()} disabled={!toRetire.size || retiring}>
                {retiring ? "Desactivando…" : `Desactivar ${toRetire.size} marca(s)`}
              </button>
            </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}
