/**
 * Carga manual del Excel BD SAC para TikTok y LinkedIn (Metricool no trae esas redes).
 * Primero revisa el archivo y muestra qué entra y qué se omite; recién al confirmar guarda.
 * Los casos cargados cuentan en Reportes y llegan a MetriQ; no aparecen en la bandeja.
 */
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowsClockwise, CheckCircle, DownloadSimple, FileArrowUp, WarningCircle, X } from "@phosphor-icons/react";
import {
  downloadManualRecordsTemplate,
  uploadManualRecords,
  type ManualRecordsChannel,
  type ManualRecordsSummary,
} from "../lib/api";

export interface ManualRecordsBrandOption {
  brandId: string;
  name: string;
  handle?: string;
}

type ManualRecordsDialogProps = {
  brands: ManualRecordsBrandOption[];
  onClose: () => void;
  /** Se llama después de guardar, con el resumen de la carga. */
  onLoaded: (summary: ManualRecordsSummary, brandName: string) => void;
};

const formatCount = new Intl.NumberFormat("es-CL").format;

function plural(count: number, singular: string, pluralText: string): string {
  return `${formatCount(count)} ${count === 1 ? singular : pluralText}`;
}

function dateLabel(value?: string): string {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function ManualRecordsDialog({ brands, onClose, onLoaded }: ManualRecordsDialogProps) {
  const [brandId, setBrandId] = useState(brands[0]?.brandId ?? "");
  const [red, setRed] = useState<"" | ManualRecordsChannel>("");
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<ManualRecordsSummary | null>(null);
  const [busy, setBusy] = useState<"review" | "save" | "template" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const brandSelect = useRef<HTMLSelectElement>(null);

  useEffect(() => { brandSelect.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Cualquier cambio invalida la revisión anterior: hay que volver a revisar antes de cargar.
  useEffect(() => { setSummary(null); setError(null); }, [brandId, red, file]);

  const brand = brands.find((item) => item.brandId === brandId);

  async function review() {
    if (!file || !brandId) return;
    setBusy("review");
    setError(null);
    try {
      setSummary(await uploadManualRecords(brandId, file, { dryRun: true, red: red || undefined }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo revisar el archivo.");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!file || !brandId || !summary?.nuevas) return;
    setBusy("save");
    setError(null);
    try {
      const saved = await uploadManualRecords(brandId, file, { dryRun: false, red: red || undefined });
      onLoaded(saved, brand?.name ?? brandId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el archivo.");
    } finally {
      setBusy(null);
    }
  }

  async function template() {
    setBusy("template");
    try {
      await downloadManualRecordsTemplate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo descargar la plantilla.");
    } finally {
      setBusy(null);
    }
  }

  const omitted = summary
    ? [
      summary.yaCargadas ? `${plural(summary.yaCargadas, "ya estaba cargado", "ya estaban cargados")} antes` : null,
      summary.yaEnNodes ? `${plural(summary.yaEnNodes, "ya llegó", "ya llegaron")} por Metricool` : null,
      summary.repetidasEnArchivo ? `${plural(summary.repetidasEnArchivo, "fila repetida", "filas repetidas")} en el archivo` : null,
      summary.otraRed ? `${plural(summary.otraRed, "fila", "filas")} de otras redes (ya llegan por Metricool)` : null,
      summary.invalidas ? `${plural(summary.invalidas, "fila con datos incompletos", "filas con datos incompletos")}` : null,
    ].filter(Boolean)
    : [];

  return (
    <div className="account-credentials-backdrop" role="presentation">
      <section className="account-credentials-panel manual-records" role="dialog" aria-modal="true" aria-labelledby="manual-records-title">
        <header>
          <span className="account-credentials-panel__icon">
            <FileArrowUp size={20} weight="fill" aria-hidden="true" />
          </span>
          <div>
            <p className="view-header__eyebrow">Carga manual</p>
            <h2 id="manual-records-title">Cargar casos de TikTok y LinkedIn</h2>
            <p>
              Sube el Excel BD SAC (un caso por fila). Los casos cuentan en Reportes y llegan a MetriQ; no aparecen en la bandeja
              porque ya se atendieron fuera de Nodes. Subir el mismo archivo otra vez no duplica nada.
            </p>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar carga manual" onClick={onClose} disabled={busy !== null}>
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </header>

        <label className="form-field">
          <span>Marca</span>
          <select ref={brandSelect} value={brandId} onChange={(event) => setBrandId(event.target.value)} disabled={busy !== null}>
            {brands.map((option) => (
              <option key={option.brandId} value={option.brandId}>
                {option.name}{option.handle ? ` · ${option.handle}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Red de las filas sin «Plataforma»</span>
          <select value={red} onChange={(event) => setRed(event.target.value as "" | ManualRecordsChannel)} disabled={busy !== null}>
            <option value="">Usar la columna Plataforma de cada fila</option>
            <option value="tiktok">TikTok</option>
            <option value="linkedin">LinkedIn</option>
          </select>
          <small>Las filas de Instagram, Facebook y otras redes se omiten: ya llegan por Metricool.</small>
        </label>

        <label className="form-field">
          <span>Archivo Excel (.xlsx)</span>
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null)}
            disabled={busy !== null}
          />
          <small>
            Desde Google Sheets: Archivo → Descargar → Microsoft Excel. Se lee la pestaña «Histórico» si existe.{" "}
            <button className="text-button" type="button" onClick={() => void template()} disabled={busy !== null}>
              <DownloadSimple size={13} weight="bold" aria-hidden="true" /> Descargar plantilla
            </button>
          </small>
        </label>

        {error ? (
          <p className="metricool-import__notice metricool-import__notice--error" role="alert">
            <WarningCircle size={18} weight="fill" aria-hidden="true" /> {error}
          </p>
        ) : null}

        {summary ? (
          <div className="manual-records__summary" role="status">
            <div className={`metricool-import__notice ${summary.nuevas ? "metricool-import__notice--ok" : ""}`}>
              <CheckCircle size={18} weight="fill" aria-hidden="true" />
              <span>
                {summary.nuevas
                  ? <>
                    <strong>{plural(summary.nuevas, "caso nuevo", "casos nuevos")}</strong> para {brand?.name ?? "la marca"}
                    {summary.desde ? ` (${dateLabel(summary.desde)}${summary.hasta && summary.hasta !== summary.desde ? ` al ${dateLabel(summary.hasta)}` : ""})` : ""}:{" "}
                    {[
                      summary.porRed.tiktok ? `TikTok ${formatCount(summary.porRed.tiktok)}` : null,
                      summary.porRed.linkedin ? `LinkedIn ${formatCount(summary.porRed.linkedin)}` : null,
                    ].filter(Boolean).join(" · ")}
                    {" · "}{plural(summary.porTipo.comment, "comentario", "comentarios")}, {plural(summary.porTipo.dm, "mensaje", "mensajes")}.
                  </>
                  : "No hay casos nuevos para cargar en este archivo."}
              </span>
            </div>
            <p className="manual-records__meta">
              Hoja «{summary.hoja}» · {plural(summary.leidas, "fila leída", "filas leídas")}
              {omitted.length ? ` · Se omiten: ${omitted.join("; ")}.` : "."}
            </p>
            {summary.problemas.length ? (
              <ul className="manual-records__problems">
                {summary.problemas.map((problem) => (
                  <li key={problem.fila}><strong>Fila {problem.fila}:</strong> {problem.motivo}</li>
                ))}
                {summary.invalidas > summary.problemas.length
                  ? <li>… y {formatCount(summary.invalidas - summary.problemas.length)} más.</li>
                  : null}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="metricool-import__actions">
          <button className="button button--secondary" type="button" onClick={onClose} disabled={busy !== null}>
            Cancelar
          </button>
          {summary?.nuevas ? (
            <button className="button button--primary" type="button" onClick={() => void save()} disabled={busy !== null}>
              {busy === "save" ? <ArrowsClockwise className="spin" size={16} aria-hidden="true" /> : <FileArrowUp size={16} weight="bold" aria-hidden="true" />}
              {busy === "save" ? "Cargando…" : `Cargar ${plural(summary.nuevas, "caso", "casos")}`}
            </button>
          ) : (
            <button className="button button--primary" type="button" onClick={() => void review()} disabled={!file || !brandId || busy !== null}>
              {busy === "review" ? <ArrowsClockwise className="spin" size={16} aria-hidden="true" /> : <CheckCircle size={16} weight="bold" aria-hidden="true" />}
              {busy === "review" ? "Revisando…" : "Revisar archivo"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
