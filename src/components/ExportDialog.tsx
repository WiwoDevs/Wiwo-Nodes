/**
 * Exportación a Excel por período y marca. Los límites de mes se calculan en la zona horaria
 * del navegador y se envían como ISO a /api/export/xlsx, que ya filtra por from/to/brandId.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowsClockwise, DownloadSimple, FileXls, X } from "@phosphor-icons/react";
import type { BrandAccount } from "../types";

export type ExportPeriod = "last_month" | "this_month" | "last_30_days" | "custom" | "all";

export type ExportFilters = { from?: string; to?: string; brandId?: string };

const PERIOD_LABEL: Record<ExportPeriod, string> = {
  last_month: "Mes pasado",
  this_month: "Este mes",
  last_30_days: "Últimos 30 días",
  custom: "Rango personalizado",
  all: "Todo el historial",
};

function startOfLocalDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function endOfLocalDay(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

function toDateInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Rango [from, to] de un período, en la zona horaria del navegador. */
export function exportRange(period: ExportPeriod, customFrom: string, customTo: string, now = new Date()): { from?: Date; to?: Date } {
  if (period === "last_month") {
    return {
      from: new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0),
      to: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
    };
  }
  if (period === "this_month") return { from: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0), to: now };
  if (period === "last_30_days") return { from: new Date(now.getTime() - 30 * 24 * 60 * 60_000), to: now };
  if (period === "custom") {
    return {
      from: customFrom ? startOfLocalDay(customFrom) : undefined,
      to: customTo ? endOfLocalDay(customTo) : undefined,
    };
  }
  return {};
}

const formatDay = new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", year: "numeric" });

type ExportDialogProps = {
  accounts: BrandAccount[];
  onClose: () => void;
  onExport: (filters: ExportFilters) => Promise<void>;
};

export function ExportDialog({ accounts, onClose, onExport }: ExportDialogProps) {
  const today = toDateInput(new Date());
  const [period, setPeriod] = useState<ExportPeriod>("last_month");
  const [customFrom, setCustomFrom] = useState(toDateInput(new Date(Date.now() - 30 * 24 * 60 * 60_000)));
  const [customTo, setCustomTo] = useState(today);
  const [brandId, setBrandId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const brands = useMemo(() => {
    const seen = new Map<string, string>();
    for (const account of accounts) {
      const id = account.brandId ?? account.id;
      if (account.brandActive !== false && !seen.has(id)) seen.set(id, account.name);
    }
    return [...seen].sort((left, right) => left[1].localeCompare(right[1], "es"));
  }, [accounts]);

  const range = exportRange(period, customFrom, customTo);
  const invalidRange = period === "custom" && (!customFrom || !customTo || customFrom > customTo);
  const summary = period === "all"
    ? "Todo lo que Nodes guardó desde que se conectó a Metricool."
    : range.from && range.to
      ? `Del ${formatDay.format(range.from)} al ${formatDay.format(range.to)}.`
      : "Elige las fechas del rango.";

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !exporting) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [exporting, onClose]);

  async function handleExport() {
    if (exporting || invalidRange) return;
    setExporting(true);
    setError(null);
    try {
      await onExport({
        from: range.from?.toISOString(),
        to: range.to?.toISOString(),
        brandId: brandId || undefined,
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo generar el Excel.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="account-credentials-backdrop" role="presentation">
      <section className="account-credentials-panel export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
        <header>
          <span className="account-credentials-panel__icon">
            <FileXls size={20} weight="fill" aria-hidden="true" />
          </span>
          <div>
            <p className="view-header__eyebrow">Reporte</p>
            <h2 id="export-dialog-title">Exportar a Excel</h2>
            <p>Interacciones con detalle y resumen por marca, para el período que elijas.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar exportación" onClick={onClose} disabled={exporting}>
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </header>

        <fieldset className="export-dialog__periods">
          <legend>Período</legend>
          {(Object.keys(PERIOD_LABEL) as ExportPeriod[]).map((value) => (
            <label key={value} className={period === value ? "is-selected" : undefined}>
              <input type="radio" name="export-period" value={value} checked={period === value} onChange={() => setPeriod(value)} disabled={exporting} />
              {PERIOD_LABEL[value]}
            </label>
          ))}
        </fieldset>

        {period === "custom" ? (
          <div className="export-dialog__dates">
            <label className="form-field">
              <span>Desde</span>
              <input type="date" value={customFrom} max={customTo || today} onChange={(event) => setCustomFrom(event.target.value)} disabled={exporting} />
            </label>
            <label className="form-field">
              <span>Hasta</span>
              <input type="date" value={customTo} min={customFrom} max={today} onChange={(event) => setCustomTo(event.target.value)} disabled={exporting} />
            </label>
          </div>
        ) : null}

        <label className="form-field">
          <span>Marca</span>
          <select value={brandId} onChange={(event) => setBrandId(event.target.value)} disabled={exporting}>
            <option value="">Todas las marcas</option>
            {brands.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>

        <p className="export-dialog__summary">{invalidRange ? "La fecha de inicio debe ser anterior o igual a la de término." : summary}</p>
        <p className="export-dialog__note">
          Nodes guarda todo lo que lee de Metricool desde que se conectó; los períodos anteriores a esa fecha pueden estar incompletos porque Metricool solo entrega lo que aún tiene en su bandeja.
        </p>

        {error ? <p className="metricool-import__notice metricool-import__notice--error" role="alert">{error}</p> : null}

        <div className="metricool-import__actions">
          <button className="button button--secondary" type="button" onClick={onClose} disabled={exporting}>Cancelar</button>
          <button className="button button--primary" type="button" onClick={() => void handleExport()} disabled={exporting || invalidRange}>
            {exporting ? <ArrowsClockwise className="spin" size={16} aria-hidden="true" /> : <DownloadSimple size={16} weight="bold" aria-hidden="true" />}
            {exporting ? "Generando…" : "Descargar Excel"}
          </button>
        </div>
      </section>
    </div>
  );
}
