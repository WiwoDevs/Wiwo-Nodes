import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import type { BrandWorkbookConfig, BrandWorkbookField, Interaction } from "./types.js";

export const MAX_WORKBOOK_BYTES = 8 * 1024 * 1024;
export const GOOGLE_SHEETS_HOST = "docs.google.com";

const FIELD_ALIASES: Record<BrandWorkbookField, string[]> = {
  createdAt: ["fecha comentario", "fecha", "date", "created at"],
  link: ["links", "link", "enlace", "url"],
  customerName: ["nombre usuario cliente", "nombre usuario", "cliente", "customer name"],
  text: ["reclamo mensaje", "mensaje", "comentario", "message", "texto"],
  channel: ["plataforma rrss", "plataforma", "red social", "rrss", "platform"],
  type: ["canal", "tipo", "type"],
  category: ["clasificacion categoria comentario", "categoria", "category"],
  sentiment: ["tonalidad", "sentimiento", "sentiment"],
  status: ["estado", "status"],
};

export function normalizeWorkbookHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function workbookCellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value && value.result !== undefined) return String(value.result ?? "");
    if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((item) => item.text).join("");
  }
  return String(value);
}

export function googleSpreadsheetId(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("La URL de Google Sheets no es válida.");
  }
  if (url.protocol !== "https:" || url.hostname !== GOOGLE_SHEETS_HOST) {
    throw new Error("Solo se aceptan enlaces HTTPS de docs.google.com/spreadsheets.");
  }
  const match = url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  if (!match?.[1]) throw new Error("No se pudo identificar el spreadsheetId del enlace.");
  return match[1];
}

function workbookMapping(headers: string[]): Partial<Record<BrandWorkbookField, number>> {
  const normalized = headers.map(normalizeWorkbookHeader);
  return Object.fromEntries(
    Object.entries(FIELD_ALIASES).flatMap(([field, aliases]) => {
      const accepted = aliases.map(normalizeWorkbookHeader);
      const index = normalized.findIndex((header) => accepted.includes(header));
      return index >= 0 ? [[field, index]] : [];
    }),
  ) as Partial<Record<BrandWorkbookField, number>>;
}

function requiredMappingMissing(mapping: Partial<Record<BrandWorkbookField, number>>): BrandWorkbookField[] {
  const required: BrandWorkbookField[] = ["createdAt", "customerName", "text", "channel", "type", "category", "sentiment", "status"];
  return required.filter((field) => mapping[field] === undefined);
}

export async function downloadGoogleWorkbook(spreadsheetId: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(
      `https://${GOOGLE_SHEETS_HOST}/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/export?format=xlsx`,
      { signal: controller.signal, redirect: "follow" },
    );
    if (!response.ok) throw new Error(`Google Sheets respondió ${response.status}. Verifica que el archivo sea accesible.`);
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_WORKBOOK_BYTES) throw new Error("El archivo supera el máximo permitido de 8 MB.");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_WORKBOOK_BYTES) throw new Error("El archivo está vacío o supera el máximo de 8 MB.");
    return bytes;
  } finally {
    clearTimeout(timeout);
  }
}

function analyzeLoadedWorkbook(
  workbook: ExcelJS.Workbook,
  input: { spreadsheetId: string; spreadsheetUrl: string; connectedAt: string; connectedBy: string },
): BrandWorkbookConfig {
  const visibleSheets = workbook.worksheets.filter((sheet) => sheet.state !== "veryHidden");
  const recordsSheet = workbook.getWorksheet("Histórico")
    ?? visibleSheets.find((sheet) => sheet.state === "visible" && sheet.rowCount > 1)
    ?? visibleSheets[0];
  if (!recordsSheet) throw new Error("El libro no contiene hojas utilizables.");

  const headerRow = 1;
  const row = recordsSheet.getRow(headerRow);
  let lastHeader = row.cellCount;
  while (lastHeader > 0 && !workbookCellText(row.getCell(lastHeader).value).trim()) lastHeader -= 1;
  const headers = Array.from({ length: lastHeader }, (_, index) => workbookCellText(row.getCell(index + 1).value));
  if (headers.length < 2 || headers.some((header) => !header.trim())) {
    throw new Error(`La hoja ${recordsSheet.name} no tiene un encabezado continuo y válido en la fila 1.`);
  }
  if (new Set(headers.map(normalizeWorkbookHeader)).size !== headers.length) {
    throw new Error(`La hoja ${recordsSheet.name} contiene encabezados duplicados.`);
  }

  const mapping = workbookMapping(headers);
  const missing = requiredMappingMissing(mapping);
  if (missing.length) {
    throw new Error(`El formato no puede mapear los campos obligatorios: ${missing.join(", ")}.`);
  }

  const textColumn = (mapping.text ?? 0) + 1;
  let dataRows = 0;
  for (let rowNumber = headerRow + 1; rowNumber <= recordsSheet.rowCount; rowNumber += 1) {
    if (workbookCellText(recordsSheet.getRow(rowNumber).getCell(textColumn).value).trim()) dataRows += 1;
  }
  const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
  const schemaHash = createHash("sha256")
    .update(JSON.stringify({ sheetNames, recordsSheet: recordsSheet.name, headerRow, headers }))
    .digest("hex");

  return {
    source: "google_sheets",
    spreadsheetId: input.spreadsheetId,
    spreadsheetUrl: input.spreadsheetUrl,
    title: workbook.title || `Google Sheet ${input.spreadsheetId.slice(0, 8)}`,
    recordsSheet: recordsSheet.name,
    criteriaSheet: workbook.getWorksheet("Criterios")?.name,
    dashboardSheet: workbook.getWorksheet("Dashboard SAC")?.name,
    headerRow,
    headers,
    mapping,
    dataRows,
    schemaHash,
    connectedAt: input.connectedAt,
    connectedBy: input.connectedBy,
  };
}

export async function inspectBrandWorkbook(
  spreadsheetUrl: string,
  actor: { userId: string },
): Promise<BrandWorkbookConfig> {
  const spreadsheetId = googleSpreadsheetId(spreadsheetUrl);
  const bytes = await downloadGoogleWorkbook(spreadsheetId);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  return analyzeLoadedWorkbook(workbook, {
    spreadsheetId,
    spreadsheetUrl: `https://${GOOGLE_SHEETS_HOST}/spreadsheets/d/${spreadsheetId}/edit`,
    connectedAt: new Date().toISOString(),
    connectedBy: actor.userId,
  });
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Santiago" }).format(date);
}

function safeExcelText(value: string): string {
  return /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function safeHttpsUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "";
  const candidate = value.trim();
  try {
    return new URL(candidate).protocol === "https:" ? candidate : "";
  } catch {
    return "";
  }
}

function interactionLink(interaction: Interaction): string {
  const postPermalink = safeHttpsUrl(interaction.metricoolRef?.post?.url);
  if (postPermalink) return postPermalink;
  const context = interaction.metricoolRef?.contentContext;
  for (const candidate of [...(context?.mediaUrls ?? []), context?.permalink]) {
    const url = safeHttpsUrl(candidate);
    if (url) return url;
  }
  return "";
}

function mappedValue(field: BrandWorkbookField, interaction: Interaction): string {
  if (field === "createdAt") return formatDate(interaction.createdAt);
  if (field === "link") return interactionLink(interaction);
  if (field === "customerName") return interaction.customerName;
  if (field === "text") return interaction.text;
  if (field === "channel") return ({
    instagram: "Instagram",
    facebook: "Facebook",
    x: "X",
    tiktok: "TikTok",
    youtube: "YouTube",
    linkedin: "LinkedIn",
    google_business: "Google Business",
  })[interaction.channel];
  if (field === "type") return interaction.type === "dm"
    ? "DM"
    : interaction.type === "review" ? "Reseña" : "Comentario Feed";
  if (field === "category") return interaction.category || "Otros";
  if (field === "sentiment") return interaction.sentiment === "positive" ? "Positivo" : interaction.sentiment === "negative" ? "Negativo" : "Neutro";
  return interaction.status === "resolved" || interaction.status === "replied" ? "Resuelto" : "Pendiente";
}

export async function buildBrandWorkbookExport(
  config: BrandWorkbookConfig,
  interactions: Interaction[],
): Promise<{ bytes: Buffer; appended: number; totalRows: number }> {
  const bytes = await downloadGoogleWorkbook(config.spreadsheetId);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const current = analyzeLoadedWorkbook(workbook, {
    spreadsheetId: config.spreadsheetId,
    spreadsheetUrl: config.spreadsheetUrl,
    connectedAt: config.connectedAt,
    connectedBy: config.connectedBy,
  });
  if (current.schemaHash !== config.schemaHash || JSON.stringify(current.headers) !== JSON.stringify(config.headers)) {
    throw new Error("El Google Sheet cambió de estructura desde que fue conectado. Vuelve a validarlo antes de exportar.");
  }
  const sheet = workbook.getWorksheet(config.recordsSheet);
  if (!sheet) throw new Error("La hoja de registros configurada ya no existe.");

  const existing = new Set<string>();
  const dedupeFields: BrandWorkbookField[] = ["createdAt", "customerName", "text", "channel", "type"];
  const dedupeIndexes = dedupeFields.map((field) => config.mapping[field]);
  if (dedupeIndexes.some((index) => index === undefined)) throw new Error("El mapeo del libro está incompleto.");
  const textIndex = config.mapping.text as number;
  let lastDataRow = config.headerRow;
  for (let rowNumber = config.headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (workbookCellText(row.getCell(textIndex + 1).value).trim()) lastDataRow = rowNumber;
    const key = dedupeIndexes
      .map((index) => normalizeWorkbookHeader(workbookCellText(row.getCell((index as number) + 1).value)))
      .join("|");
    if (key.replace(/\|/g, "")) existing.add(key);
  }

  const fieldByColumn = new Map<number, BrandWorkbookField>();
  for (const [field, index] of Object.entries(config.mapping)) {
    if (index !== undefined) fieldByColumn.set(index, field as BrandWorkbookField);
  }
  let appended = 0;
  for (const interaction of interactions) {
    const key = dedupeFields.map((field) => normalizeWorkbookHeader(mappedValue(field, interaction))).join("|");
    if (existing.has(key)) continue;
    existing.add(key);
    lastDataRow += 1;
    const target = sheet.getRow(lastDataRow);
    const values = config.headers.map((_, index) => {
      const field = fieldByColumn.get(index);
      return field ? mappedValue(field, interaction) : "";
    });
    const styleSource = sheet.getRow(Math.max(config.headerRow + 1, lastDataRow - 1));
    for (let column = 1; column <= config.headers.length; column += 1) {
      const cell = target.getCell(column);
      if (!cell.style || Object.keys(cell.style).length === 0) {
        cell.style = structuredClone(styleSource.getCell(column).style);
        cell.dataValidation = structuredClone(styleSource.getCell(column).dataValidation);
        cell.numFmt = styleSource.getCell(column).numFmt;
      }
      cell.value = safeExcelText(values[column - 1] ?? "");
    }
    target.commit();
    appended += 1;
  }
  const output = Buffer.from(await workbook.xlsx.writeBuffer());
  return { bytes: output, appended, totalRows: config.dataRows + appended };
}
