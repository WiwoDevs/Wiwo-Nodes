/**
 * Reportes: las cifras del informe SAC mensual por marca, con las advertencias de datos a
 * revisar antes de entregarlo y la descarga del Excel del mes. Solo lectura: no cambia casos ni escribe en Metricool.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  ArrowsClockwise,
  ChatCircleText,
  CheckCircle,
  FileXls,
  PresentationChart,
  ShareNetwork,
  WarningCircle,
} from "@phosphor-icons/react";
import { downloadExport, loadSacMonthlyReport } from "../lib/api";
import type { InboxSyncStatus, SacMonthlyReport, SacReportBrand } from "../types";

type ReportsViewProps = {
  canExport: boolean;
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
};

/** Últimos 12 meses, del más reciente al más antiguo; por defecto el mes pasado (el que se reporta). */
function recentMonths(now = new Date()): Array<{ value: string; label: string }> {
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    const value = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    return { value, label: `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}${index === 0 ? " (en curso)" : ""}` };
  });
}

function Variation({ figures }: { figures: SacReportBrand["figures"] }) {
  const variation = figures.variacion;
  if (!variation) return <span className="reports-muted">Sin mes anterior</span>;
  if (!variation.comparable) return <span className="reports-muted" title="El mes anterior está incompleto o sin clasificar">No comparable</span>;
  const up = variation.deltaPct > 0;
  return (
    <span className={`trend trend--${variation.deltaPct === 0 ? "flat" : up ? "up" : "down"}`} title={`Mes anterior: ${formatCount(variation.anterior)} casos`}>
      {variation.deltaPct === 0 ? null : up ? <ArrowUpRight size={13} weight="bold" aria-hidden="true" /> : <ArrowDownRight size={13} weight="bold" aria-hidden="true" />}
      {variation.deltaPct > 0 ? "+" : ""}{formatPct(variation.deltaPct)}
    </span>
  );
}

export function ReportsView({ canExport, inboxSync, onToast }: ReportsViewProps) {
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
  const totals = useMemo(() => withCases.reduce((sum, brand) => ({
    casos: sum.casos + brand.figures.casosSac,
    recibidos: sum.recibidos + brand.figures.volumenBruto,
    gestionados: sum.gestionados + brand.figures.mensajesGestionados,
    respondidos: sum.respondidos + brand.figures.respondidos,
  }), { casos: 0, recibidos: 0, gestionados: 0, respondidos: 0 }), [withCases]);
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
            <span className="filter-field__label">Volumen</span>
            <select value={volumen} onChange={(event) => setVolumen(event.target.value as "gestionado" | "bruto")} title="Gestionado descuenta menciones en historias, reacciones y aplausos sueltos">
              <option value="gestionado">Gestionado</option>
              <option value="bruto">Bruto</option>
            </select>
          </label>
          <button className="button button--secondary" type="button" onClick={() => void load()} disabled={loading}>
            <ArrowsClockwise size={16} weight="bold" className={loading ? "spin" : undefined} aria-hidden="true" />
            Recalcular
          </button>
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
              <p className="kpi-card__value">{loading && !report ? "—" : formatCount(volumen === "bruto" ? totals.recibidos : totals.gestionados)}</p>
              <h2 className="kpi-card__label">{volumen === "bruto" ? "Mensajes recibidos" : "Mensajes gestionados"}</h2>
              <p className="kpi-card__detail">{formatCount(totals.recibidos)} recibidos en bruto</p>
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
                <p className="panel__description">Elige una marca para ver su detalle: motivos, tono, canales y avisos.</p>
              </div>
            </header>
            <div className="table-scroll">
              <table className="data-table reports-table">
                <thead>
                  <tr>
                    <th scope="col">Marca</th>
                    <th scope="col" className="numeric">Casos SAC</th>
                    <th scope="col" className="numeric">{volumen === "bruto" ? "Recibidos" : "Gestionados"}</th>
                    <th scope="col" className="numeric">Respondidos</th>
                    <th scope="col" className="numeric">Cobertura</th>
                    <th scope="col">vs. mes anterior</th>
                    <th scope="col">Avisos</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && !report ? <tr><td colSpan={7} className="reports-muted">Calculando el reporte…</td></tr> : null}
                  {report && !withCases.length ? <tr><td colSpan={7} className="reports-muted">Ninguna marca tuvo casos en {report.label}.</td></tr> : null}
                  {withCases.map((brand) => (
                    <tr key={brand.brandId} className="data-table__row">
                      <td>
                        <button className="reports-brand" type="button" onClick={() => setSelectedBrandId(brand.brandId)}>
                          <strong>{brand.brandName}</strong>
                          <small>{brand.accountHandle}</small>
                        </button>
                      </td>
                      <td className="numeric"><strong>{formatCount(brand.figures.casosSac)}</strong></td>
                      <td className="numeric">{formatCount(volumen === "bruto" ? brand.figures.volumenBruto : brand.figures.mensajesGestionados)}</td>
                      <td className="numeric">{formatCount(brand.figures.respondidos)}</td>
                      <td className="numeric">{formatPct(brand.figures.coberturaPct)}</td>
                      <td><Variation figures={brand.figures} /></td>
                      <td>
                        {brand.figures.advertencias.length
                          ? <span className="reports-badge is-warning"><WarningCircle size={13} weight="fill" aria-hidden="true" />{brand.figures.advertencias.length}</span>
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
          <p className="kpi-card__value">{formatCount(volumen === "bruto" ? figures.volumenBruto : figures.mensajesGestionados)}</p>
          <h3 className="kpi-card__label">{volumen === "bruto" ? "Mensajes recibidos" : "Mensajes gestionados"}</h3>
          <p className="kpi-card__detail">{formatCount(figures.volumenBruto)} en bruto{figures.ilegibles ? ` · ${formatCount(figures.ilegibles)} ilegibles` : ""}</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-card__value">{formatPct(figures.coberturaPct)}</p>
          <h3 className="kpi-card__label">Cobertura</h3>
          <p className="kpi-card__detail">{formatCount(figures.respondidos)} de {formatCount(figures.casosSac)} casos respondidos</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-card__value">{formatCount(figures.derivados)}</p>
          <h3 className="kpi-card__label">Derivados</h3>
          <p className="kpi-card__detail">{formatCount(figures.privados)} privados · {formatCount(figures.publicos)} públicos</p>
        </article>
      </div>

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
