import { useState, type FormEvent } from "react";
import {
  DownloadSimple,
  FileText,
  FolderOpen,
  LinkSimple,
  MicrosoftExcelLogo,
  Plus,
  Sparkle,
  Trash,
  X,
} from "@phosphor-icons/react";
import type { BrandAccount, BrandResourceKind } from "../types";

interface BrandFilesPanelProps {
  account: BrandAccount;
  canEdit: boolean;
  isSaving: boolean;
  onClose: () => void;
  onSaveRecords: (account: BrandAccount, spreadsheetUrl: string) => void | Promise<void>;
  onDownloadRecords: (account: BrandAccount) => void | Promise<void>;
  onSaveQa: (account: BrandAccount, spreadsheetUrl: string) => void | Promise<void>;
  onDownloadQaTemplate: (account: BrandAccount) => void | Promise<void>;
  onAddResource: (account: BrandAccount, input: { name: string; url: string; kind: BrandResourceKind }) => void | Promise<void>;
  onDeleteResource: (account: BrandAccount, resourceId: string) => void | Promise<void>;
}

const formatInteger = new Intl.NumberFormat("es-CL");

const resourceLabels: Record<BrandResourceKind, string> = {
  records: "Registros SAC",
  qa: "QA aprobado",
  brand_guide: "Manual de marca",
  policy: "Política",
  asset: "Material",
  other: "Otro",
};

function validSheetUrl(value: string): boolean {
  return /^https:\/\/docs\.google\.com\/spreadsheets\/d\//i.test(value.trim());
}

export function BrandFilesPanel({
  account,
  canEdit,
  isSaving,
  onClose,
  onSaveRecords,
  onDownloadRecords,
  onSaveQa,
  onDownloadQaTemplate,
  onAddResource,
  onDeleteResource,
}: BrandFilesPanelProps) {
  const [recordsUrl, setRecordsUrl] = useState(account.workbook?.spreadsheetUrl ?? "");
  const [qaUrl, setQaUrl] = useState(account.qaWorkbook?.spreadsheetUrl ?? "");
  const [resourceName, setResourceName] = useState("");
  const [resourceUrl, setResourceUrl] = useState("");
  const [resourceKind, setResourceKind] = useState<BrandResourceKind>("brand_guide");
  const [error, setError] = useState<string | null>(null);

  const submitRecords = async (event: FormEvent) => {
    event.preventDefault();
    if (!validSheetUrl(recordsUrl)) {
      setError("El Excel de registros necesita un enlace válido de Google Sheets.");
      return;
    }
    setError(null);
    try {
      await onSaveRecords(account, recordsUrl.trim());
    } catch {
      setError("No se pudo validar el Excel de registros. Revisa el acceso y su formato.");
    }
  };

  const submitQa = async (event: FormEvent) => {
    event.preventDefault();
    if (!validSheetUrl(qaUrl)) {
      setError("El Excel QA necesita un enlace válido de Google Sheets.");
      return;
    }
    setError(null);
    try {
      await onSaveQa(account, qaUrl.trim());
    } catch {
      setError("No se pudo validar el Excel QA. Usa la plantilla y marca las filas vigentes como Aprobada.");
    }
  };

  const submitResource = async (event: FormEvent) => {
    event.preventDefault();
    if (!resourceName.trim() || !resourceUrl.trim().startsWith("https://")) {
      setError("Agrega un nombre y un enlace HTTPS para el archivo.");
      return;
    }
    setError(null);
    try {
      await onAddResource(account, { name: resourceName.trim(), url: resourceUrl.trim(), kind: resourceKind });
      setResourceName("");
      setResourceUrl("");
    } catch {
      setError("No se pudo agregar el archivo. Revisa que el enlace no esté repetido.");
    }
  };

  return (
    <div className="account-credentials-backdrop" role="presentation">
      <section className="account-credentials-panel brand-files-panel" role="dialog" aria-modal="true" aria-labelledby="brand-files-title">
        <header>
          <span className="account-credentials-panel__icon"><FolderOpen size={20} weight="fill" aria-hidden="true" /></span>
          <div>
            <p className="view-header__eyebrow">Centro documental por marca</p>
            <h2 id="brand-files-title">Archivos de {account.name}</h2>
            <p>Registros, respuestas QA y documentos operativos ordenados en un solo lugar.</p>
          </div>
          <button className="icon-button" type="button" aria-label="Cerrar archivos de marca" onClick={onClose} disabled={isSaving}>
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </header>

        <div className="brand-files-panel__body">
          <div className="brand-files-grid">
            <form className="brand-file-card" onSubmit={submitRecords}>
              <header>
                <span><MicrosoftExcelLogo size={19} weight="fill" aria-hidden="true" /></span>
                <div><strong>Excel de registros SAC</strong><small>DMs, comentarios y seguimiento</small></div>
                <em>{account.workbook ? "Conectado" : "Pendiente"}</em>
              </header>
              {account.workbook ? (
                <dl>
                  <div><dt>Hoja</dt><dd>{account.workbook.recordsSheet}</dd></div>
                  <div><dt>Registros base</dt><dd>{formatInteger.format(account.workbook.dataRows)}</dd></div>
                  <div><dt>Columnas</dt><dd>{account.workbook.headers.length}</dd></div>
                  <div><dt>Dashboard</dt><dd>{account.workbook.dashboardSheet ?? "No detectado"}</dd></div>
                </dl>
              ) : <p>Conecta el libro maestro de interacciones. El sistema fija su contrato y no altera el original.</p>}
              <label>
                <span>Google Sheets</span>
                <input type="url" value={recordsUrl} onChange={(event) => setRecordsUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." disabled={isSaving || !canEdit} required />
              </label>
              <footer>
                <button className="button button--secondary" type="button" onClick={() => void onDownloadRecords(account)} disabled={isSaving || !account.workbook}>
                  <DownloadSimple size={15} weight="bold" /> Copia actualizada
                </button>
                <button className="button button--primary" type="submit" disabled={isSaving || !canEdit}>
                  {account.workbook ? "Revalidar" : "Conectar"}
                </button>
              </footer>
            </form>

            <form className="brand-file-card brand-file-card--qa" onSubmit={submitQa}>
              <header>
                <span><Sparkle size={19} weight="fill" aria-hidden="true" /></span>
                <div><strong>Excel QA aprobado</strong><small>Fuente de recomendaciones IA</small></div>
                <em>{account.qaWorkbook ? "Conectado" : "Pendiente"}</em>
              </header>
              {account.qaWorkbook ? (
                <dl>
                  <div><dt>Hoja</dt><dd>{account.qaWorkbook.sheetName}</dd></div>
                  <div><dt>Filas leídas</dt><dd>{formatInteger.format(account.qaWorkbook.dataRows)}</dd></div>
                  <div><dt>Aprobadas</dt><dd>{formatInteger.format(account.qaWorkbook.approvedRows)}</dd></div>
                  <div><dt>Uso</dt><dd>Protocolo SAC</dd></div>
                </dl>
              ) : <p>Solo las respuestas con estado Aprobada, Activo o Vigente se usarán para recomendar mensajes.</p>}
              <label>
                <span>Google Sheets</span>
                <input type="url" value={qaUrl} onChange={(event) => setQaUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." disabled={isSaving || !canEdit} required />
              </label>
              <footer>
                <button className="button button--secondary" type="button" onClick={() => void onDownloadQaTemplate(account)} disabled={isSaving}>
                  <DownloadSimple size={15} weight="bold" /> Plantilla QA
                </button>
                <button className="button button--primary" type="submit" disabled={isSaving || !canEdit}>
                  {account.qaWorkbook ? "Revalidar" : "Conectar"}
                </button>
              </footer>
            </form>
          </div>

          <section className="brand-resource-library" aria-labelledby="brand-resources-title">
            <header>
              <div><strong id="brand-resources-title">Biblioteca de la cuenta</strong><small>{account.resources.length} archivo(s) enlazados</small></div>
            </header>
            {account.resources.length ? (
              <ul>
                {account.resources.map((resource) => (
                  <li key={resource.id}>
                    <span className="brand-resource-library__icon"><FileText size={17} weight="duotone" /></span>
                    <div><a href={resource.url} target="_blank" rel="noreferrer">{resource.name}</a><small>{resourceLabels[resource.kind]}</small></div>
                    {resource.kind === "records" || resource.kind === "qa" ? <em>Administrado</em> : (
                      <button className="icon-button" type="button" aria-label={`Retirar ${resource.name}`} onClick={() => void onDeleteResource(account, resource.id)} disabled={isSaving || !canEdit}>
                        <Trash size={15} weight="bold" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="case-notes-card__empty">Todavía no hay documentos operativos enlazados.</p>}

            <form className="brand-resource-form" onSubmit={submitResource}>
              <label><span>Nombre</span><input value={resourceName} onChange={(event) => setResourceName(event.target.value)} placeholder="Manual de tono de voz" disabled={isSaving || !canEdit} required /></label>
              <label><span>Tipo</span><select value={resourceKind} onChange={(event) => setResourceKind(event.target.value as BrandResourceKind)} disabled={isSaving || !canEdit}>
                <option value="brand_guide">Manual de marca</option><option value="policy">Política</option><option value="asset">Material</option><option value="other">Otro</option>
              </select></label>
              <label className="brand-resource-form__url"><span>Enlace HTTPS</span><input type="url" value={resourceUrl} onChange={(event) => setResourceUrl(event.target.value)} placeholder="https://drive.google.com/..." disabled={isSaving || !canEdit} required /></label>
              <button className="button button--secondary" type="submit" disabled={isSaving || !canEdit}><Plus size={15} weight="bold" /> Agregar archivo</button>
            </form>
          </section>

          {error ? <p className="brand-admin-error" role="alert">{error}</p> : null}
          <p className="account-credentials-panel__note"><LinkSimple size={14} /> WIWO.Nodes guarda referencias organizadas; no modifica ni elimina los archivos originales.</p>
        </div>
      </section>
    </div>
  );
}
