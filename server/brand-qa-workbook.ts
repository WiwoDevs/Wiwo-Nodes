import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import {
  downloadGoogleWorkbook,
  GOOGLE_SHEETS_HOST,
  googleSpreadsheetId,
  normalizeWorkbookHeader,
  workbookCellText,
} from "./brand-workbook.js";
import type {
  BrandQaWorkbookConfig,
  BrandQaWorkbookField,
  Channel,
  InteractionType,
  SacApprovedAnswer,
} from "./types.js";

const QA_ALIASES: Record<BrandQaWorkbookField, string[]> = {
  id: ["id", "codigo", "código"],
  question: ["pregunta intencion", "pregunta/intencion", "pregunta", "consulta", "faq"],
  intent: ["intencion normalizada", "intencion", "intent"],
  answer: ["respuesta aprobada", "respuesta", "respuesta modelo", "answer"],
  category: ["categoria", "categoría", "tema"],
  channel: ["canal", "channel"],
  status: ["estado", "status"],
  verifiedAt: ["ultima revision", "última revisión", "fecha revision", "vigencia desde"],
  expiresAt: ["vigencia hasta", "fecha expiracion", "fecha expiración", "expires at"],
  sourceLabel: ["fuente", "source"],
  approvedBy: ["aprobado por", "responsable", "approved by"],
};

const APPROVED_STATUSES = new Set(["aprobada", "aprobado", "activo", "activa", "vigente", "approved"]);

function qaMapping(headers: string[]): Partial<Record<BrandQaWorkbookField, number>> {
  const normalized = headers.map(normalizeWorkbookHeader);
  return Object.fromEntries(
    Object.entries(QA_ALIASES).flatMap(([field, aliases]) => {
      const accepted = aliases.map(normalizeWorkbookHeader);
      const index = normalized.findIndex((header) => accepted.includes(header));
      return index >= 0 ? [[field, index]] : [];
    }),
  ) as Partial<Record<BrandQaWorkbookField, number>>;
}

function canonicalIntent(value: string): string {
  return normalizeWorkbookHeader(value).replaceAll(" ", "_") || "otro";
}

function inferIntent(question: string, category: string, explicit: string): string {
  if (explicit.trim()) return canonicalIntent(explicit);
  if (category.trim()) return canonicalIntent(category);
  const value = normalizeWorkbookHeader(question);
  if (/stock|disponib|reposicion|queda/.test(value)) return "stock";
  if (/precio|valor|cuanto/.test(value)) return "precio";
  if (/despach|envio|demora/.test(value)) return "despacho";
  if (/ubicaci|direccion|tienda|sucursal|donde/.test(value)) return "ubicacion";
  if (/horario|abren|cierran/.test(value)) return "horarios";
  if (/cambio|devolu/.test(value)) return "cambios_devoluciones";
  if (/pedido|seguimiento|tracking|orden/.test(value)) return "seguimiento_pedido";
  if (/contacto|telefono|correo|whatsapp/.test(value)) return "contacto";
  if (/gracias|agradec/.test(value)) return "agradecimiento";
  if (/hola|saludo/.test(value)) return "saludo";
  return canonicalIntent(question);
}

function isoDate(value: ExcelJS.CellValue, fallback?: string): string | undefined {
  const raw = workbookCellText(value).trim();
  if (!raw) return fallback;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function textAt(row: ExcelJS.Row, mapping: Partial<Record<BrandQaWorkbookField, number>>, field: BrandQaWorkbookField): string {
  const index = mapping[field];
  return index === undefined ? "" : workbookCellText(row.getCell(index + 1).value).trim();
}

function qaScope(value: string): { channels?: Channel[]; interactionTypes?: InteractionType[] } {
  const normalized = normalizeWorkbookHeader(value).replaceAll(" ", "_");
  const channel = ({
    instagram: "instagram",
    facebook: "facebook",
    x: "x",
    twitter: "x",
    tiktok: "tiktok",
    youtube: "youtube",
    linkedin: "linkedin",
    google_business: "google_business",
    google_business_profile: "google_business",
  } as Record<string, Channel>)[normalized];
  if (channel) return { channels: [channel] };
  if (normalized === "dm" || normalized === "mensaje_directo") return { interactionTypes: ["dm"] };
  if (normalized === "comentario") return { interactionTypes: ["comment"] };
  if (normalized === "resena") return { interactionTypes: ["review"] };
  return {};
}

export async function inspectBrandQaWorkbook(
  spreadsheetUrl: string,
  actor: { userId: string },
): Promise<{ config: BrandQaWorkbookConfig; approvedAnswers: SacApprovedAnswer[] }> {
  const spreadsheetId = googleSpreadsheetId(spreadsheetUrl);
  const bytes = await downloadGoogleWorkbook(spreadsheetId);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet("QA")
    ?? workbook.getWorksheet("Respuestas QA")
    ?? workbook.worksheets.find((item) => item.state === "visible" && item.rowCount >= 1);
  if (!sheet) throw new Error("El libro QA no contiene una hoja visible.");

  const headerRow = 1;
  const row = sheet.getRow(headerRow);
  let lastHeader = row.cellCount;
  while (lastHeader > 0 && !workbookCellText(row.getCell(lastHeader).value).trim()) lastHeader -= 1;
  const headers = Array.from({ length: lastHeader }, (_, index) => workbookCellText(row.getCell(index + 1).value).trim());
  if (headers.length < 3 || headers.some((header) => !header)) {
    throw new Error(`La hoja ${sheet.name} necesita encabezados continuos en la fila 1.`);
  }
  if (new Set(headers.map(normalizeWorkbookHeader)).size !== headers.length) {
    throw new Error(`La hoja ${sheet.name} contiene encabezados duplicados.`);
  }

  const mapping = qaMapping(headers);
  const missing = (["question", "answer", "status"] as BrandQaWorkbookField[])
    .filter((field) => mapping[field] === undefined);
  if (missing.length) {
    throw new Error(`El Excel QA debe incluir Pregunta/Intención, Respuesta aprobada y Estado. Faltan: ${missing.join(", ")}.`);
  }

  const connectedAt = new Date().toISOString();
  const approvedAnswers: SacApprovedAnswer[] = [];
  let dataRows = 0;
  for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const current = sheet.getRow(rowNumber);
    const question = textAt(current, mapping, "question");
    const answer = textAt(current, mapping, "answer");
    if (!question && !answer) continue;
    dataRows += 1;
    const status = normalizeWorkbookHeader(textAt(current, mapping, "status"));
    if (!question || !answer || !APPROVED_STATUSES.has(status)) continue;
    const explicitId = textAt(current, mapping, "id");
    const intent = inferIntent(
      question,
      textAt(current, mapping, "category"),
      textAt(current, mapping, "intent"),
    );
    const id = explicitId || `qa-${createHash("sha256").update(`${question}|${answer}`).digest("hex").slice(0, 16)}`;
    const verifiedAt = mapping.verifiedAt !== undefined
      ? isoDate(current.getCell(mapping.verifiedAt + 1).value, connectedAt) || connectedAt
      : connectedAt;
    const expiresAt = mapping.expiresAt !== undefined
      ? isoDate(current.getCell(mapping.expiresAt + 1).value)
      : undefined;
    approvedAnswers.push({
      id,
      intent,
      answer,
      sourceLabel: textAt(current, mapping, "sourceLabel") || `${sheet.name} · fila ${rowNumber}`,
      verifiedAt,
      ...qaScope(textAt(current, mapping, "channel")),
      ...(expiresAt ? { expiresAt } : {}),
    });
  }
  if (!approvedAnswers.length) {
    throw new Error("El Excel QA no contiene respuestas con Estado Aprobada/Activo/Vigente.");
  }

  const schemaHash = createHash("sha256")
    .update(JSON.stringify({ sheetNames: workbook.worksheets.map((item) => item.name), sheetName: sheet.name, headers }))
    .digest("hex");
  return {
    config: {
      source: "google_sheets",
      spreadsheetId,
      spreadsheetUrl: `https://${GOOGLE_SHEETS_HOST}/spreadsheets/d/${spreadsheetId}/edit`,
      title: workbook.title || `Google Sheet ${spreadsheetId.slice(0, 8)}`,
      sheetName: sheet.name,
      headerRow,
      headers,
      mapping,
      dataRows,
      approvedRows: approvedAnswers.length,
      schemaHash,
      connectedAt,
      connectedBy: actor.userId,
    },
    approvedAnswers,
  };
}

export async function buildBrandQaTemplate(brandName: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "WIWO.Nodes";
  workbook.title = `QA aprobado · ${brandName}`;
  const qa = workbook.addWorksheet("QA", { views: [{ state: "frozen", ySplit: 1 }] });
  const headers = [
    "ID",
    "Pregunta/Intención",
    "Intención normalizada",
    "Respuesta aprobada",
    "Categoría",
    "Canal",
    "Estado",
    "Vigencia desde",
    "Vigencia hasta",
    "Fuente",
    "Aprobado por",
  ];
  qa.addRow(headers);
  qa.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  qa.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF423CF5" } };
  qa.getRow(1).alignment = { vertical: "middle", wrapText: true };
  qa.columns = [14, 34, 24, 58, 22, 18, 16, 18, 18, 28, 24].map((width) => ({ width }));
  qa.autoFilter = { from: "A1", to: "K1" };
  for (let row = 2; row <= 1_000; row += 1) {
    qa.getCell(`F${row}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Todos,Instagram,Facebook,X,TikTok,YouTube,LinkedIn,Google Business,DM,Comentario,Reseña"'],
    };
    qa.getCell(`G${row}`).dataValidation = { type: "list", allowBlank: false, formulae: ['"Aprobada,Pendiente,Archivada"'] };
  }
  const guide = workbook.addWorksheet("Instrucciones");
  guide.addRows([
    ["Regla", "Descripción"],
    ["Pregunta/Intención", "Pregunta frecuente o intención que activa esta respuesta."],
    ["Respuesta aprobada", "Texto autorizado por la marca; admite {firstName} y {brand}."],
    ["Canal", "Puede limitarse por plataforma o tipo de interacción; Todos aplica a cualquier cuenta conectada."],
    ["Estado", "Solo Aprobada, Activo o Vigente alimentan recomendaciones IA."],
    ["Vigencia", "Opcional. Las respuestas vencidas no se recomendarán."],
  ]);
  guide.getRow(1).font = { bold: true };
  guide.columns = [{ width: 24 }, { width: 86 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
