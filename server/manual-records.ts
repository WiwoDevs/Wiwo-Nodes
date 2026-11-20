/**
 * Carga manual del Excel BD SAC para las redes que Metricool no trae (TikTok y LinkedIn).
 *
 * El equipo registra esa atención a mano en la planilla de siempre (una fila por caso: fecha,
 * usuario, mensaje, plataforma, canal, categoría, tonalidad, estado). Aquí cada fila pasa a ser
 * una interacción `source: "planilla"`, igual que las que importa `scripts/import-tiktok-sheets`,
 * para que cuente en Reportes y llegue a METRIQ por las mismas rutas que lo de Metricool. No
 * entra a la bandeja: son casos ya atendidos fuera de wiwo.sac y no se responden desde aquí.
 *
 * El Excel no es la persistencia: se lee una vez y lo que vale queda en el repositorio. Volver
 * a subir el mismo archivo no duplica nada, por dos vías:
 *  - una huella determinística por marca, fecha, usuario y texto (`externalId`), y
 *  - el cotejo por texto contra lo que ya está en wiwo.sac para esa red (p. ej. comentarios de
 *    TikTok que sí trajo Metricool), admitiendo unos días de diferencia en textos distintivos.
 */
import { createHash, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { normalizeWorkbookHeader, workbookCellText, workbookMapping } from "./brand-workbook.js";
import { intentFromText } from "./sac-automation.js";
import { categoriaDesdeEtiqueta } from "./sac-report.js";
import type { Brand, Interaction, InteractionStatus, InteractionType, Sentiment } from "./types.js";

export const MANUAL_RECORD_CHANNELS = ["tiktok", "linkedin"] as const;
export type ManualRecordChannel = (typeof MANUAL_RECORD_CHANNELS)[number];

export const MAX_MANUAL_RECORDS_BYTES = 8 * 1024 * 1024;
const MAX_FILAS = 20_000;
const MAX_PROBLEMAS = 20;
/** Letras desde las que un texto repetido por casualidad es improbable ("🥰🥰" no lo es). */
const DISTINTIVO = 8;
/** La planilla anota cuándo se atendió y Metricool cuándo se publicó: hasta 3 días de diferencia. */
const DIAS_DE_TOLERANCIA = 3;

const RED_LEGIBLE: Record<ManualRecordChannel, string> = { tiktok: "TikTok", linkedin: "LinkedIn" };

/** Columnas de la plantilla, con los nombres de la planilla BD SAC. */
export const MANUAL_RECORDS_HEADERS = [
  "Fecha comentario",
  "Nombre usuario cliente",
  "Reclamo / Mensaje",
  "Plataforma / RRSS",
  "Canal",
  "Clasificación / Categoría comentario",
  "Tonalidad",
  "Estado",
];

interface FilaLeida {
  fila: number;
  fecha: ExcelJS.CellValue;
  usuario: string;
  texto: string;
  plataforma: string;
  canal: string;
  categoria: string;
  tonalidad: string;
  estado: string;
}

export interface ManualRecordsProblem {
  fila: number;
  motivo: string;
}

export interface ManualRecordsResult {
  hoja: string;
  leidas: number;
  nuevas: Interaction[];
  /** Filas que ya se habían cargado antes (misma huella). */
  yaCargadas: number;
  /** El mismo mensaje ya estaba en wiwo.sac para esa red (p. ej. lo trajo Metricool). */
  yaEnNodes: number;
  repetidasEnArchivo: number;
  /** Filas de redes que Metricool sí trae (Instagram, Facebook…): se omiten para no duplicar. */
  otraRed: number;
  invalidas: number;
  problemas: ManualRecordsProblem[];
  porRed: Record<ManualRecordChannel, number>;
  porTipo: Record<"dm" | "comment", number>;
  desde?: string;
  hasta?: string;
}

function normalizar(valor: string): string {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function texto(valor: ExcelJS.CellValue): string {
  return workbookCellText(valor).replace(/\s+/g, " ").trim();
}

function dosDigitos(valor: number): string {
  return String(valor).padStart(2, "0");
}

function diaValido(anio: number, mes: number, dia: number): string | undefined {
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return undefined;
  return `${anio}-${dosDigitos(mes)}-${dosDigitos(dia)}`;
}

/**
 * Día (YYYY-MM-DD) de la celda "Fecha": fecha de Excel, número de serie o texto
 * `DD/MM/AAAA`, `DD-MM-AA` o `AAAA-MM-DD`. Se lee en UTC, como el resto del reporte.
 */
export function diaDeCelda(valor: ExcelJS.CellValue): string | undefined {
  if (valor === null || valor === undefined) return undefined;
  if (valor instanceof Date) {
    return Number.isFinite(valor.getTime())
      ? diaValido(valor.getUTCFullYear(), valor.getUTCMonth() + 1, valor.getUTCDate())
      : undefined;
  }
  if (typeof valor === "number") {
    if (valor < 20_000 || valor > 80_000) return undefined;
    const fecha = new Date(Date.UTC(1899, 11, 30) + Math.floor(valor) * 86_400_000);
    return diaValido(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, fecha.getUTCDate());
  }
  if (typeof valor === "object" && "result" in valor) return diaDeCelda(valor.result as ExcelJS.CellValue);
  const crudo = workbookCellText(valor).trim();
  const latino = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s.*)?$/.exec(crudo);
  if (latino) {
    const anio = Number(latino[3]!.length === 2 ? `20${latino[3]}` : latino[3]);
    return diaValido(anio, Number(latino[2]), Number(latino[1]));
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(crudo);
  return iso ? diaValido(Number(iso[1]), Number(iso[2]), Number(iso[3])) : undefined;
}

function redDe(plataforma: string): ManualRecordChannel | "otra" | undefined {
  const valor = normalizar(plataforma).replace(/[^a-z]/g, "");
  if (!valor) return undefined;
  if (valor.includes("tiktok")) return "tiktok";
  if (valor.includes("linkedin")) return "linkedin";
  if (/^(instagram|ig|facebook|fb|meta|twitter|x|youtube|yt|google|googlereviews|googlebusiness|whatsapp)$/.test(valor)) return "otra";
  return undefined;
}

function tipoDe(canal: string): InteractionType {
  return /\b(dm|privad|mensaje|inbox|directo|interno)/.test(normalizar(canal)) ? "dm" : "comment";
}

function tonoDe(tonalidad: string): Sentiment {
  const valor = normalizar(tonalidad);
  if (valor.startsWith("posit")) return "positive";
  if (valor.startsWith("negat")) return "negative";
  return "neutral";
}

/** Estado de la planilla → estado de wiwo.sac, para que METRIQ reciba el mismo "Estado". */
function estadoDe(estado: string): InteractionStatus {
  const valor = normalizar(estado);
  if (/resuel|respond|cerrad|gestionad|atendid|contestad|finaliz/.test(valor)) return "replied";
  if (/deriv|escal/.test(valor)) return "escalated";
  if (/proceso|curso|revision/.test(valor)) return "drafted";
  return "pending";
}

/**
 * Hoja y fila de encabezado: la pestaña "Histórico" si existe; si no, la primera hoja visible
 * cuyas primeras filas tengan al menos fecha y mensaje.
 */
function ubicarEncabezado(workbook: ExcelJS.Workbook): {
  hoja: ExcelJS.Worksheet;
  fila: number;
  columnas: ReturnType<typeof workbookMapping>;
} {
  const visibles = workbook.worksheets.filter((sheet) => sheet.state !== "veryHidden" && sheet.state !== "hidden");
  const ordenadas = [
    ...visibles.filter((sheet) => normalizeWorkbookHeader(sheet.name) === "historico"),
    ...visibles.filter((sheet) => normalizeWorkbookHeader(sheet.name) !== "historico"),
  ];
  for (const hoja of ordenadas) {
    for (let fila = 1; fila <= Math.min(10, hoja.rowCount); fila += 1) {
      const row = hoja.getRow(fila);
      const encabezados = Array.from({ length: row.cellCount }, (_, index) => texto(row.getCell(index + 1).value));
      const columnas = workbookMapping(encabezados);
      if (columnas.createdAt !== undefined && columnas.text !== undefined) return { hoja, fila, columnas };
    }
  }
  throw new Error(
    "No encontramos las columnas de la planilla BD SAC. Se necesitan al menos \"Fecha comentario\" y \"Reclamo / Mensaje\" en la primera fila.",
  );
}

/** Lee las filas del Excel (.xlsx). Lanza un error legible si el archivo no sirve. */
export async function readManualRecordsWorkbook(bytes: Buffer): Promise<{ hoja: string; filas: FilaLeida[] }> {
  if (!bytes.length) throw new Error("El archivo está vacío.");
  if (bytes.length > MAX_MANUAL_RECORDS_BYTES) throw new Error("El archivo supera el máximo de 8 MB.");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch {
    throw new Error("No se pudo leer el archivo. Sube un Excel .xlsx (en Google Sheets: Archivo → Descargar → Microsoft Excel).");
  }
  const { hoja, fila: filaEncabezado, columnas } = ubicarEncabezado(workbook);
  const celda = (row: ExcelJS.Row, campo: keyof typeof columnas) => {
    const indice = columnas[campo];
    return indice === undefined ? null : row.getCell(indice + 1).value;
  };
  const filas: FilaLeida[] = [];
  for (let numero = filaEncabezado + 1; numero <= hoja.rowCount; numero += 1) {
    const row = hoja.getRow(numero);
    const leida: FilaLeida = {
      fila: numero,
      fecha: celda(row, "createdAt"),
      usuario: texto(celda(row, "customerName")),
      texto: texto(celda(row, "text")),
      plataforma: texto(celda(row, "channel")),
      canal: texto(celda(row, "type")),
      categoria: texto(celda(row, "category")),
      tonalidad: texto(celda(row, "sentiment")),
      estado: texto(celda(row, "status")),
    };
    if (!leida.texto && !leida.usuario && !texto(leida.fecha)) continue;
    filas.push(leida);
    if (filas.length > MAX_FILAS) throw new Error(`El archivo supera el máximo de ${MAX_FILAS.toLocaleString("es-CL")} filas por carga.`);
  }
  return { hoja: hoja.name, filas };
}

const letras = (valor: string) => (valor.match(/\p{L}/gu) ?? []).length;
const numeroDeDia = (dia: string) => Math.floor(Date.parse(`${dia}T00:00:00Z`) / 86_400_000);

export interface BuildManualRecordsInput {
  brand: Brand;
  hoja: string;
  filas: FilaLeida[];
  /** Interacciones que ya existen (de la marca o de todas: se filtra aquí). */
  existentes: Interaction[];
  /** Red para las filas sin "Plataforma". */
  redPorDefecto?: ManualRecordChannel;
  archivo: string;
  actor: { userId: string; displayName: string };
  ahora?: Date;
}

/** Convierte las filas en interacciones nuevas y cuenta lo que se omitió y por qué. */
export function buildManualRecords(input: BuildManualRecordsInput): ManualRecordsResult {
  const { brand } = input;
  const ahora = (input.ahora ?? new Date()).toISOString();
  const manana = new Date(Date.parse(ahora) + 86_400_000).toISOString().slice(0, 10);
  const lote = randomUUID();
  const externos = new Set<string>();
  const nuevosIds = new Set<string>();
  const fechasPorTexto = new Map<string, string[]>();
  for (const item of input.existentes) {
    if (item.brandId !== brand.id) continue;
    externos.add(item.externalId);
    if (item.direction !== "inbound") continue;
    const clave = `${item.channel}|${normalizar(item.text)}`;
    const fechas = fechasPorTexto.get(clave) ?? [];
    fechas.push(item.createdAt.slice(0, 10));
    fechasPorTexto.set(clave, fechas);
  }
  const yaEstaba = (red: string, dia: string, contenido: string) => {
    const fechas = fechasPorTexto.get(`${red}|${normalizar(contenido)}`);
    if (!fechas) return false;
    if (fechas.includes(dia)) return true;
    if (letras(contenido) < DISTINTIVO) return false;
    return fechas.some((otra) => Math.abs(numeroDeDia(otra) - numeroDeDia(dia)) <= DIAS_DE_TOLERANCIA);
  };

  const resultado: ManualRecordsResult = {
    hoja: input.hoja,
    leidas: input.filas.length,
    nuevas: [],
    yaCargadas: 0,
    yaEnNodes: 0,
    repetidasEnArchivo: 0,
    otraRed: 0,
    invalidas: 0,
    problemas: [],
    porRed: { tiktok: 0, linkedin: 0 },
    porTipo: { dm: 0, comment: 0 },
  };
  const invalida = (fila: number, motivo: string) => {
    resultado.invalidas += 1;
    if (resultado.problemas.length < MAX_PROBLEMAS) resultado.problemas.push({ fila, motivo });
  };

  for (const fila of input.filas) {
    const dia = diaDeCelda(fila.fecha);
    if (!dia) {
      invalida(fila.fila, "Fecha vacía o con formato no reconocido (usa DD/MM/AAAA).");
      continue;
    }
    if (dia < "2015-01-01" || dia > manana) {
      invalida(fila.fila, `Fecha fuera de rango (${dia}).`);
      continue;
    }
    const contenido = fila.texto.slice(0, 5_000);
    if (!contenido) {
      invalida(fila.fila, "Sin mensaje.");
      continue;
    }
    const detectada = redDe(fila.plataforma);
    if (detectada === "otra") {
      resultado.otraRed += 1;
      continue;
    }
    const red = detectada ?? (fila.plataforma ? undefined : input.redPorDefecto);
    if (!red) {
      invalida(fila.fila, fila.plataforma
        ? `Plataforma "${fila.plataforma.slice(0, 40)}" no reconocida (TikTok o LinkedIn).`
        : "Sin plataforma: indica TikTok o LinkedIn en la fila o elige la red al cargar.");
      continue;
    }

    const [anio, mes, diaDelMes] = dia.split("-");
    const huella = createHash("sha1")
      .update(`${brand.id}|${diaDelMes}/${mes}/${anio}|${fila.usuario}|${contenido}`)
      .digest("hex")
      .slice(0, 24);
    const externalId = `planilla:${red}:${brand.id}:${huella}`;
    if (nuevosIds.has(externalId)) {
      resultado.repetidasEnArchivo += 1;
      continue;
    }
    if (externos.has(externalId)) {
      resultado.yaCargadas += 1;
      continue;
    }
    if (yaEstaba(red, dia, contenido)) {
      resultado.yaEnNodes += 1;
      continue;
    }
    // Dentro del mismo archivo solo se descarta la fila idéntica (misma huella): dos personas
    // que escriben "¿Precio?" el mismo día son dos casos.
    nuevosIds.add(externalId);

    const estado = estadoDe(fila.estado);
    const tipo = tipoDe(fila.canal);
    const categoria = categoriaDesdeEtiqueta(fila.categoria) ?? intentFromText(contenido) ?? "otro";
    const createdAt = `${dia}T12:00:00.000Z`;
    resultado.nuevas.push({
      id: randomUUID(),
      externalId,
      brandId: brand.id,
      accountId: brand.account.id,
      channel: red,
      type: tipo,
      direction: "inbound",
      customerName: fila.usuario.slice(0, 200) || `Usuario de ${RED_LEGIBLE[red]}`,
      customerHandle: "",
      text: contenido,
      category: categoria,
      sentiment: tonoDe(fila.tonalidad),
      confidence: 1,
      status: estado,
      source: "planilla",
      version: 1,
      createdAt,
      updatedAt: ahora,
      internalNotes: [],
      // El equipo lo anotó en la BD SAC: es un caso por decisión de una persona.
      sacTriage: {
        categoria,
        esCasoSac: true,
        requiereDerivacion: estado === "escalated",
        confianza: 1,
        clasificadoEn: ahora,
        modelo: "manual",
        marcadoPor: input.actor.displayName,
      },
      audit: [{
        id: randomUUID(),
        at: ahora,
        action: "ingested",
        actor: "agent",
        detail: `Cargado a mano desde "${input.archivo}" (hoja ${input.hoja}, fila ${fila.fila}) por ${input.actor.displayName}.`,
        metadata: { lote, fila: fila.fila, actorId: input.actor.userId },
      }],
    });
    resultado.porRed[red] += 1;
    resultado.porTipo[tipo === "dm" ? "dm" : "comment"] += 1;
    if (!resultado.desde || dia < resultado.desde) resultado.desde = dia;
    if (!resultado.hasta || dia > resultado.hasta) resultado.hasta = dia;
  }
  return resultado;
}

/** Plantilla vacía con las columnas de la BD SAC y una hoja de instrucciones. */
export async function buildManualRecordsTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "wiwo.sac";
  const hoja = workbook.addWorksheet("Histórico");
  hoja.addRow(MANUAL_RECORDS_HEADERS);
  hoja.getRow(1).font = { bold: true };
  hoja.columns.forEach((column, index) => { column.width = index === 2 ? 60 : 22; });
  hoja.getColumn(1).numFmt = "dd/mm/yyyy";
  const ayuda = workbook.addWorksheet("Cómo llenar");
  [
    ["Columna", "Qué poner"],
    ["Fecha comentario", "DD/MM/AAAA. Un caso por fila."],
    ["Nombre usuario cliente", "Nombre o usuario de la persona."],
    ["Reclamo / Mensaje", "Texto del mensaje o comentario (obligatorio)."],
    ["Plataforma / RRSS", "TikTok o LinkedIn. Otras redes ya llegan por Metricool y se omiten."],
    ["Canal", "DM (privado) o Comentario (público)."],
    ["Clasificación / Categoría comentario", "Reclamos, Precios, Despachos, Stock, Postventa, Pagos, Horarios, Contacto, Consultas… Si se deja vacío, wiwo.sac la decide por reglas."],
    ["Tonalidad", "Positiva, Neutra o Negativa."],
    ["Estado", "Resuelto, Pendiente, En proceso o Derivado."],
  ].forEach((row) => ayuda.addRow(row));
  ayuda.getRow(1).font = { bold: true };
  ayuda.getColumn(1).width = 36;
  ayuda.getColumn(2).width = 90;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
