/**
 * Reportes: las cifras del informe SAC mensual por marca, con las advertencias de datos a
 * revisar antes de entregarlo y la descarga del Excel del mes. Solo lectura: no cambia casos ni escribe en Metricool.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  ArrowsClockwise,
  ChatCircleText,
  CheckCircle,
  FileArrowUp,
  FileXls,
  Info,
  PresentationChart,
  ShareNetwork,
  WarningCircle,
} from "@phosphor-icons/react";
import { downloadExport, loadSacMonthlyReport } from "../lib/api";
import type { InboxSyncStatus, SacMonthlyReport, SacReportBrand } from "../types";
import { ManualRecordsDialog, type ManualRecordsBrandOption } from "./ManualRecordsDialog";
import { BusyOrb } from "./ThinkingOrb";

type ReportsViewProps = {
  canExport: boolean;
  /** Permiso "Cargar registros manuales": subir el Excel BD SAC de TikTok y LinkedIn. */
  canImportRecords?: boolean;
  /** Marcas visibles a las que se les puede cargar el Excel. */
  importBrands?: ManualRecordsBrandOption[];
  inboxSync?: InboxSyncStatus;
  onToast: (toast: { tone: "success" | "warning"; title: string; detail: string }) => void;
};

const formatCount = new Intl.NumberFormat("es-CL").format;
const formatPct = (value: number) => `${value.toLocaleString("es-CL", { maximumFractionDigits: 1 })}%`;
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const CHANNEL_LABEL: Record<string, string> = {
  ig_privado: "Instagram · mensajes",
  ig_publico: "Instagram · comentarios",
  fb_privado: "Facebook · mensajes",
  fb_publico: "Facebook · comentarios",
  tt_privado: "TikTok · mensajes",
  tt_publico: "TikTok · comentarios",
  linkedin_privado: "LinkedIn · mensajes",
  linkedin_publico: "LinkedIn · comentarios",
};

/** Últimos 12 meses, del más reciente al más antiguo; por defecto el mes pasado (el que se reporta). */
function recentMonths(now = new Date()): Array<{ value: string; label: string }> {
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    return { value, label: `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}${index === 0 ? " (en curso)" : ""}` };
  });
}

/** "Caso o ruido": cuánto se decidió a mano, con IA o por reglas. */
function clasificacionTexto(counts: { manual: number; ia: number; reglas: number; spam?: number }): string {
  const total = counts.manual + counts.ia + counts.reglas;
  if (!total) return "";
  const parts = [
    counts.manual ? `${formatCount(counts.manual)} a mano` : null,
    counts.ia ? `${formatCount(counts.ia)} con IA` : null,
    counts.reglas ? `${formatCount(counts.reglas)} por reglas` : null,
  ].filter(Boolean);
  const spam = counts.spam
    ? ` De los decididos por reglas, ${formatCount(counts.spam)} no cuentan por spam o ruido (texto repetido, el mismo texto desde varias cuentas, solo etiquetas o spam promocional).`
    : "";
  return `Caso o ruido: ${parts.join(", ")}.${spam} Corrige a mano desde el detalle de cada caso o en lote desde la Bandeja.`;
}

type TipPosition = { top: number; left: number; above: boolean };

/**
 * Globo con el estilo de la web (no el del navegador): aparece al pasar el mouse o al enfocar
 * con el teclado, va en un portal con posición fija para que la tabla con desplazamiento no
 * lo recorte, y se cierra al salir o al desplazar la página.
 */
function useHoverTip<T extends HTMLElement>(width = 340) {
  const id = useId();
  const ref = useRef<T>(null);
  const [position, setPosition] = useState<TipPosition | null>(null);
  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const above = window.innerHeight - rect.bottom < 220 && rect.top > 220;
    setPosition({
      top: above ? rect.top - 8 : rect.bottom + 8,
      left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
      above,
    });
  };
  const hide = () => setPosition(null);
  useEffect(() => {
    if (!position) return;
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [position]);
  const triggerProps = {
    ref,
    "aria-describedby": position ? id : undefined,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
  };
  return { id, position, triggerProps };
}

function HoverTipBubble({ id, position, tone = "warning", children }: {
  id: string;
  position: TipPosition | null;
  tone?: "warning" | "info";
  children: ReactNode;
}) {
  if (!position) return null;
  return createPortal(
    <div
      id={id}
      role="tooltip"
      className={`reports-warnings-tip${position.above ? " is-above" : ""}${tone === "info" ? " is-info" : ""}`}
      style={{ top: position.top, left: position.left }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** Texto con explicación al pasar el mouse (enfocable con el teclado). */
function HoverTip({ className, title, tone = "warning", tip, children }: {
  className: string;
  title: string;
  tone?: "warning" | "info";
  tip: ReactNode;
  children: ReactNode;
}) {
  const { id, position, triggerProps } = useHoverTip<HTMLSpanElement>(300);
  return (
    <>
      <span className={`${className} reports-tip-trigger`} tabIndex={0} {...triggerProps}>{children}</span>
      <HoverTipBubble id={id} position={position} tone={tone}>
        <strong>{title}</strong>
        <p>{tip}</p>
      </HoverTipBubble>
    </>
  );
}

/** Insignia de avisos: al pasar el mouse muestra qué avisos son; al hacer clic abre la marca. */
function WarningsBadge({ warnings, onOpen }: { warnings: string[]; onOpen: () => void }) {
  const { id, position, triggerProps } = useHoverTip<HTMLButtonElement>();
  return (
    <>
      <button
        type="button"
        className="reports-badge is-warning reports-badge--button"
        aria-label={`${warnings.length} avisos: ver detalle de la marca`}
        onClick={onOpen}
        {...triggerProps}
      >
        <WarningCircle size={13} weight="fill" aria-hidden="true" />{warnings.length}
      </button>
      <HoverTipBubble id={id} position={position}>
        <strong>{warnings.length === 1 ? "1 aviso" : `${warnings.length} avisos`}</strong>
        <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        <small>Clic para ver el detalle de la marca.</small>
      </HoverTipBubble>
    </>
  );
}

function Variation({ figures }: { figures: SacReportBrand["figures"] }) {
  const variation = figures.variacion;
  if (!variation) return <span className="reports-muted">Sin mes anterior</span>;
  if (!variation.comparable) {
    return (
      <HoverTip
        className="reports-muted"
        title="No comparable"
        tip="El mes anterior está incompleto (Metricool no guarda DMs tan antiguos) o se clasificó distinto que este mes, así que la variación no sería real."
      >
        No comparable
      </HoverTip>
    );
  }
  const up = variation.deltaPct > 0;
  return (
    <span className="reports-variation">
      <HoverTip
        className={`trend trend--${variation.deltaPct === 0 ? "flat" : up ? "up" : "down"}`}
        title="Contra el mes anterior"
        tone="info"
        tip={`El mes anterior tuvo ${formatCount(variation.anterior)} casos SAC y este mes ${formatCount(figures.casosSac)}.`}
      >
        {variation.deltaPct === 0 ? null : up ? <ArrowUpRight size={13} weight="bold" aria-hidden="true" /> : <ArrowDownRight size={13} weight="bold" aria-hidden="true" />}
        {variation.deltaPct > 0 ? "+" : ""}{formatPct(variation.deltaPct)}
      </HoverTip>
      {variation.revisar ? (
        <HoverTip
          className="reports-chip is-warning"
          title="Variación por revisar"
          tip={`De ${formatCount(variation.anterior)} a ${formatCount(figures.casosSac)} casos: suele ser un mes anterior con pocos datos. Revísalo antes de presentarlo.`}
        >
          Revisar
        </HoverTip>
      ) : null}
    </span>
  );
}

type SortKey = "marca" | "casos" | "recibidos" | "respondidos" | "cobertura" | "variacion" | "avisos";

const SORT_VALUE: Record<Exclude<SortKey, "marca">, (brand: SacReportBrand) => number> = {
  casos: (brand) => brand.figures.casosSac,
  recibidos: (brand) => brand.figures.volumenBruto,
  respondidos: (brand) => brand.figures.respondidos,
  cobertura: (brand) => brand.figures.coberturaPct,
  // Sin variación comparable va al final en cualquier dirección.
  variacion: (brand) => (brand.figures.variacion?.comparable ? brand.figures.variacion.deltaPct : Number.NaN),
  avisos: (brand) => brand.figures.advertencias.length,
};

/** Cobertura bajo 30 % en rojo y bajo 60 % en ámbar. */
function coverageTone(pct: number): string {
  return pct < 30 ? " is-low" : pct < 60 ? " is-mid" : "";
}

export function ReportsView({ canExport, canImportRecords = false, importBrands = [], inboxSync, onToast }: ReportsViewProps) {
  const [importOpen, setImportOpen] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "casos", desc: true });
  const months = useMemo(() => recentMonths(), []);
  const [month, setMonth] = useState(months[1]?.value ?? months[0]!.value);
  const [volumen, setVolumen] = useState<"gestionado" | "bruto">("gestionado");
  const [report, setReport] = useState<SacMonthlyReport | null>(null);
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await loadSacMonthlyReport(month, volumen));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo calcular el reporte.");
    } finally {
      setLoading(false);
    }
  }, [month, volumen]);

  useEffect(() => { void load(); }, [load]);

  const withCases = useMemo(() => report?.brands.filter((brand) => brand.figures.casosSac > 0) ?? [], [report]);
  const sortedBrands = useMemo(() => {
    const direction = sort.desc ? -1 : 1;
    return [...withCases].sort((left, right) => {
      if (sort.key === "marca") return direction * left.brandName.localeCompare(right.brandName, "es");
      const a = SORT_VALUE[sort.key](left);
      const b = SORT_VALUE[sort.key](right);
      if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) === Number.isNaN(b) ? 0 : Number.isNaN(a) ? 1 : -1;
      return direction * (a - b) || left.brandName.localeCompare(right.brandName, "es");
    });
  }, [sort, withCases]);
  const sortHeader = (key: SortKey, text: string, numeric = false) => {
    const active = sort.key === key;
    return (
      <th scope="col" className={numeric ? "numeric" : undefined} aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}>
        <button
          type="button"
          className={`reports-sort${active ? " is-active" : ""}`}
          onClick={() => setSort((current) => current.key === key ? { key, desc: !current.desc } : { key, desc: key !== "marca" })}
        >
          {text}
          <span aria-hidden="true">{active ? (sort.desc ? "↓" : "↑") : "↕"}</span>
        </button>
      </th>
    );
  };
  const totals = useMemo(() => withCases.reduce((sum, brand) => ({
    casos: sum.casos + brand.figures.casosSac,
    recibidos: sum.recibidos + brand.figures.volumenBruto,
    gestionados: sum.gestionados + brand.figures.mensajesGestionados,
    respondidos: sum.respondidos + brand.figures.respondidos,
    manual: sum.manual + (brand.figures.clasificacion?.manual ?? 0),
    reglas: sum.reglas + (brand.figures.clasificacion?.reglas ?? 0),
    ia: sum.ia + (brand.figures.clasificacion?.ia ?? 0),
    spam: sum.spam + (brand.figures.clasificacion?.spam ?? 0),
  }), { casos: 0, recibidos: 0, gestionados: 0, respondidos: 0, manual: 0, reglas: 0, ia: 0, spam: 0 }), [withCases]);
  const selected = report?.brands.find((brand) => brand.brandId === selectedBrandId) ?? null;

  // Avisos que afectan a todo el mes: cuentas duplicadas y una sincronización detenida.
  const syncStale = inboxSync?.lastRunAt ? Date.now() - Date.parse(inboxSync.lastRunAt) > 24 * 60 * 60_000 : false;
  const globalWarnings = [
    ...(report?.warnings ?? []),
    ...(syncStale ? ["La última sincronización con Metricool tiene más de 24 horas: puede faltar actividad reciente."] : []),
    ...(inboxSync?.lastRunStatus === "failed" ? ["La última sincronización con Metricool falló: revisa Ejecuciones antes de presentar."] : []),
  ];
  const brandsWithWarnings = withCases.filter((brand) => brand.figures.advertencias.length).length;

  async function exportMonth(brandId?: string) {
    if (!report) return;
    setExporting(true);
    try {
      // Mismos límites del reporte: días completos en UTC.
      await downloadExport({ from: `${report.from}T00:00:00.000Z`, to: `${report.to}T23:59:59.999Z`, brandId });
      onToast({ tone: "success", title: "Excel descargado", detail: `${brandId ? selected?.brandName ?? "Marca" : "Todas las marcas"} · ${report.label}` });
    } catch (cause) {
      onToast({ tone: "warning", title: "No se pudo generar el Excel", detail: cause instanceof Error ? cause.message : "Intenta nuevamente." });
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="app-view reports-view" aria-labelledby="reports-title">
      <header className="view-header">
        <div className="view-header__copy">
          <p className="view-header__eyebrow">Reporte mensual</p>
          <h1 id="reports-title" className="view-header__title">Reportes</h1>
          <p className="view-header__description">
            Las cifras del informe SAC de cada marca: casos, respuestas, motivos y tono del mes, con lo que hay que revisar antes de presentar.
          </p>
        </div>
        <div className="view-header__actions reports-controls">
          <label className="filter-field">
            <span className="filter-field__label">Mes</span>
            <select value={month} onChange={(event) => { setMonth(event.target.value); }}>
              {months.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="filter-field">
            <span className="filter-field__label">
              Volumen{" "}
              <HoverTip
                className="reports-help"
                title="Volumen de motivos, tono y canales"
                tone="info"
                tip="Gestionado descuenta menciones en historias, reacciones, emojis sueltos y textos muy cortos. Bruto usa todo lo recibido."
              >
                <Info size={12} weight="bold" aria-label="Qué es el volumen" />
              </HoverTip>
            </span>
            <select value={volumen} onChange={(event) => setVolumen(event.target.value as "gestionado" | "bruto")}>
              <option value="gestionado">Gestionado</option>
              <option value="bruto">Bruto</option>
            </select>
          </label>
          <button className="button button--secondary" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? <BusyOrb /> : <ArrowsClockwise size={16} weight="bold" aria-hidden="true" />}
            Recalcular
          </button>
          {canImportRecords && importBrands.length ? (
            <button
              className="button button--secondary"
              type="button"
              onClick={() => setImportOpen(true)}
              title="Subir el Excel BD SAC con los casos de TikTok y LinkedIn que Metricool no trae"
            >
              <FileArrowUp size={16} weight="bold" aria-hidden="true" />
              Cargar TikTok/LinkedIn
            </button>
          ) : null}
          {canExport ? (
            <button className="button button--primary" type="button" onClick={() => void exportMonth(selected?.brandId)} disabled={!report || exporting}>
              <FileXls size={17} weight="bold" aria-hidden="true" />
              {exporting ? "Generando…" : selected ? "Excel de la marca" : "Excel del mes"}
            </button>
          ) : null}
        </div>
      </header>

      {error ? <p className="reports-error" role="alert"><WarningCircle size={16} weight="fill" aria-hidden="true" />{error}</p> : null}

      {globalWarnings.length ? (
        <div className="reports-warnings" role="status">
          <WarningCircle size={18} weight="fill" aria-hidden="true" />
          <div>
            <strong>Revisa antes de presentar</strong>
            <ul>{globalWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </div>
        </div>
      ) : null}

      {!selected && report && totals.reglas ? (
        <p className="reports-info" role="note">
          <Info size={16} weight="fill" aria-hidden="true" />
          <span>{clasificacionTexto(totals)}</span>
        </p>
      ) : null}

      {selected ? (
        <BrandDetail brand={selected} label={report?.label ?? ""} volumen={volumen} onBack={() => setSelectedBrandId(null)} />
      ) : (
        <>
          <div className="kpi-grid reports-kpis" aria-label={`Totales de ${report?.label ?? "el mes"}`}>
            <article className="kpi-card">
              <div className="kpi-card__topline"><span className="kpi-card__icon"><ChatCircleText size={21} weight="duotone" aria-hidden="true" /></span></div>
              <p className="kpi-card__value">{loading && !report ? "—" : formatCount(totals.casos)}</p>
              <h2 className="kpi-card__label">Casos SAC</h2>
              <p className="kpi-card__detail">{withCases.length} marcas con casos en {report?.label ?? "el mes"}</p>
            </article>
            <article className="kpi-card">
              <div className="kpi-card__topline"><span className="kpi-card__icon"><ShareNetwork size={21} weight="duotone" aria-hidden="true" /></span></div>
              <p className="kpi-card__value">{loading && !report ? "—" : formatCount(totals.recibidos)}</p>
              <h2 className="kpi-card__label">Mensajes recibidos</h2>
              <p className="kpi-card__detail">{formatCount(Math.max(0, totals.recibidos - totals.casos))} descontados como ruido</p>
            </article>
            <article className="kpi-card">
              <div className="kpi-card__topline"><span className="kpi-card__icon"><CheckCircle size={21} weight="duotone" aria-hidden="true" /></span></div>
              <p className="kpi-card__value">{loading && !report ? "—" : formatCount(totals.respondidos)}</p>
              <h2 className="kpi-card__label">Casos respondidos</h2>
              <p className="kpi-card__detail">{totals.casos ? `${formatPct(Math.round(totals.respondidos / totals.casos * 1000) / 10)} de cobertura` : "Sin casos en el mes"}</p>
            </article>
            <article className="kpi-card">
              <div className="kpi-card__topline"><span className="kpi-card__icon"><PresentationChart size={21} weight="duotone" aria-hidden="true" /></span></div>
              <p className="kpi-card__value">{loading && !report ? "—" : brandsWithWarnings}</p>
              <h2 className="kpi-card__label">Marcas con avisos</h2>
              <p className="kpi-card__detail">{brandsWithWarnings ? "Ábrelas para ver qué revisar" : "Datos sin observaciones"}</p>
            </article>
          </div>

          <article className="panel reports-table-panel">
            <header className="panel__header">
              <div>
                <h2 className="panel__title">Marcas · {report?.label ?? "…"}</h2>
                <p className="panel__description">Elige una marca para ver su detalle. Ordena con un clic en cada columna; la cobertura bajo 30 % se marca en rojo y bajo 60 % en ámbar.</p>
              </div>
            </header>
            <div className="table-scroll">
              <table className="data-table reports-table">
                <thead>
                  <tr>
                    {sortHeader("marca", "Marca")}
                    {sortHeader("casos", "Casos SAC", true)}
                    {sortHeader("recibidos", "Recibidos", true)}
                    {sortHeader("respondidos", "Respondidos", true)}
                    {sortHeader("cobertura", "Cobertura", true)}
                    {sortHeader("variacion", "vs. mes anterior")}
                    {sortHeader("avisos", "Avisos")}
                  </tr>
                </thead>
                <tbody>
                  {loading && !report ? <tr><td colSpan={7} className="reports-muted">Calculando el reporte…</td></tr> : null}
                  {report && !withCases.length ? <tr><td colSpan={7} className="reports-muted">Ninguna marca tuvo casos en {report.label}.</td></tr> : null}
                  {sortedBrands.map((brand) => (
                    <tr key={brand.brandId} className="data-table__row">
                      <td>
                        <button className="reports-brand" type="button" onClick={() => setSelectedBrandId(brand.brandId)}>
                          <strong>{brand.brandName}</strong>
                          <small>{brand.accountHandle}</small>
                        </button>
                      </td>
                      <td className="numeric"><strong>{formatCount(brand.figures.casosSac)}</strong></td>
                      <td className="numeric">
                        {formatCount(brand.figures.volumenBruto)}
                        <small className="reports-noise">{formatCount(Math.max(0, brand.figures.volumenBruto - brand.figures.casosSac))} ruido</small>
                      </td>
                      <td className="numeric">{formatCount(brand.figures.respondidos)}</td>
                      <td className="numeric"><span className={`reports-coverage${coverageTone(brand.figures.coberturaPct)}`}>{formatPct(brand.figures.coberturaPct)}</span></td>
                      <td><Variation figures={brand.figures} /></td>
                      <td>
                        {brand.figures.advertencias.length
                          ? <WarningsBadge warnings={brand.figures.advertencias} onOpen={() => setSelectedBrandId(brand.brandId)} />
                          : <span className="reports-badge"><CheckCircle size={13} weight="fill" aria-hidden="true" />OK</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report ? (
              <footer className="panel__footer reports-footnote">
                {report.brands.length - withCases.length ? `${report.brands.length - withCases.length} marcas activas sin casos en el mes no se listan. ` : ""}
                Cifras calculadas por día en UTC.
              </footer>
            ) : null}
          </article>
        </>
      )}

      {importOpen ? (
        <ManualRecordsDialog
          brands={importBrands}
          onClose={() => setImportOpen(false)}
          onLoaded={(summary, brandName) => {
            setImportOpen(false);
            onToast({
              tone: "success",
              title: `${summary.creadas.toLocaleString("es-CL")} caso(s) de ${brandName} cargados`,
              detail: "Ya cuentan en Reportes y llegan a MetriQ. No aparecen en la bandeja.",
            });
            void load();
          }}
        />
      ) : null}
    </section>
  );
}

function BrandDetail({ brand, label, volumen, onBack }: { brand: SacReportBrand; label: string; volumen: "gestionado" | "bruto"; onBack: () => void }) {
  const figures = brand.figures;
  const toneTotal = figures.tono.positivo + figures.tono.neutro + figures.tono.negativo;
  const channels = Object.entries(figures.canales).filter(([, value]) => value > 0).sort((left, right) => right[1] - left[1]);
  const channelTotal = channels.reduce((sum, [, value]) => sum + value, 0);
  return (
    <div className="reports-detail">
      <div className="reports-detail__head">
        <button className="text-button" type="button" onClick={onBack}><ArrowLeft size={15} weight="bold" aria-hidden="true" /> Todas las marcas</button>
        <h2>{brand.brandName} <small>{brand.accountHandle} · {label}</small></h2>
      </div>

      {figures.advertencias.length ? (
        <div className="reports-warnings">
          <WarningCircle size={18} weight="fill" aria-hidden="true" />
          <div>
            <strong>Avisos de esta marca</strong>
            <ul>{figures.advertencias.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </div>
        </div>
      ) : null}

      <div className="kpi-grid reports-kpis">
        <article className="kpi-card">
          <p className="kpi-card__value">{formatCount(figures.casosSac)}</p>
          <h3 className="kpi-card__label">Casos SAC</h3>
          <p className="kpi-card__detail"><Variation figures={figures} /></p>
        </article>
        <article className="kpi-card">
          <p className="kpi-card__value">{formatCount(figures.volumenBruto)}</p>
          <h3 className="kpi-card__label">Mensajes recibidos</h3>
          <p className="kpi-card__detail">{formatCount(Math.max(0, figures.volumenBruto - figures.casosSac))} descontados como ruido{figures.ilegibles ? ` · ${formatCount(figures.ilegibles)} ilegibles` : ""}</p>
        </article>
        <article className="kpi-card">
          <p className={`kpi-card__value reports-coverage${coverageTone(figures.coberturaPct)}`}>{formatPct(figures.coberturaPct)}</p>
          <h3 className="kpi-card__label">Cobertura</h3>
          <p className="kpi-card__detail">{formatCount(figures.respondidos)} de {formatCount(figures.casosSac)} casos respondidos</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-card__value">{formatCount(figures.derivados)}</p>
          <h3 className="kpi-card__label">Derivados</h3>
          <p className="kpi-card__detail">{formatCount(figures.privados)} privados · {formatCount(figures.publicos)} públicos</p>
        </article>
      </div>
      {figures.clasificacion ? <p className="reports-footnote">{clasificacionTexto(figures.clasificacion)}</p> : null}

      <div className="reports-detail__grid">
        <article className="panel">
          <header className="panel__header"><div><h3 className="panel__title">Motivos</h3><p className="panel__description">De qué escribieron los clientes.</p></div></header>
          <ul className="reports-bars">
            {figures.motivos.length ? figures.motivos.map((item) => (
              <li key={item.motivo}>
                <span>{item.motivo}</span>
                <span className="reports-bars__track"><i style={{ width: `${Math.max(2, item.pct)}%` }} /></span>
                <strong>{formatCount(item.casos)} <small>{formatPct(item.pct)}</small></strong>
              </li>
            )) : <li className="reports-muted">Sin casos clasificados.</li>}
          </ul>
        </article>
        <article className="panel">
          <header className="panel__header"><div><h3 className="panel__title">Tono</h3><p className="panel__description">Sentimiento de los casos.</p></div></header>
          <ul className="reports-bars reports-bars--tone">
            {([["positivo", "Positivo"], ["neutro", "Neutro"], ["negativo", "Negativo"]] as const).map(([key, text]) => (
              <li key={key} className={`is-${key}`}>
                <span>{text}</span>
                <span className="reports-bars__track"><i style={{ width: `${toneTotal ? Math.max(2, figures.tono[key] / toneTotal * 100) : 0}%` }} /></span>
                <strong>{formatCount(figures.tono[key])}</strong>
              </li>
            ))}
          </ul>
          <header className="panel__header reports-subheader"><div><h3 className="panel__title">Canales</h3></div></header>
          <ul className="reports-bars">
            {channels.length ? channels.map(([key, value]) => (
              <li key={key}>
                <span>{CHANNEL_LABEL[key] ?? key}</span>
                <span className="reports-bars__track"><i style={{ width: `${channelTotal ? Math.max(2, value / channelTotal * 100) : 0}%` }} /></span>
                <strong>{formatCount(value)}</strong>
              </li>
            )) : <li className="reports-muted">Sin mensajes en el mes.</li>}
          </ul>
        </article>
      </div>
    </div>
  );
}
