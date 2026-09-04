/**
 * Exporta la bitácora SAC de una marca al formato de planilla que usa el equipo.
 *
 * Es el camino inverso de `import-tiktok-sheets.mjs`: donde TikTok obliga a cargar a mano lo
 * que el API no entrega, el resto de las redes ya está en Nodes y lo que falta es devolverlo
 * en el formato que el equipo sabe leer —"BD SAC [MARCA]", pestaña Histórico, nueve columnas—
 * para que las cuatro planillas de TikTok y estas convivan con la misma estructura.
 *
 * La traducción no es cosmética: la taxonomía del informe (`reclamo`, `stock`,
 * `seguimiento_pedido`) no es la de la planilla ("Reclamo/Producto", "Disponibilidad",
 * "Seguimiento compra"), y el mapeo sale de la pestaña Criterios de sus propios archivos.
 *
 * Uso:
 *   node scripts/export-sac-workbook.mjs --marca primeros-pueblos,multiplaza-bogota
 *                                        [--mes 2026-08 | --desde 2026-08 --hasta 2026-09]
 *                                        [--salida ./reportes]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { loadConfig } from "../dist-api/config.js";
import { loadLocalEnvironment } from "../dist-api/load-env.js";
import { createRepository } from "../dist-api/repository-factory.js";
import { esIlegible, esMensajeGestionado } from "../dist-api/sac-report.js";

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : porDefecto;
}

const marcasPedidas = (arg("marca", "") || "").split(",").map((m) => m.trim()).filter(Boolean);
const mes = arg("mes", null);
const desde = mes ?? arg("desde", null);
const hasta = mes ?? arg("hasta", null);
const salida = arg("salida", "./reportes");

if (!marcasPedidas.length) {
  console.error("Uso: --marca <brandId[,brandId]> [--mes YYYY-MM | --desde YYYY-MM --hasta YYYY-MM] [--salida <dir>]");
  process.exit(1);
}
for (const valor of [desde, hasta]) {
  if (valor && !/^\d{4}-\d{2}$/.test(valor)) {
    console.error(`Período inválido: "${valor}". Se espera YYYY-MM.`);
    process.exit(1);
  }
}

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** Sufijo del archivo: nombra el período cuando lo hay, para no pisar el histórico completo. */
function etiquetaPeriodo() {
  if (mes) {
    const [anio, m] = mes.split("-").map(Number);
    return `${MESES[m - 1]} ${anio}`;
  }
  if (desde || hasta) return `${desde ?? "inicio"} a ${hasta ?? "hoy"}`;
  return "todas las redes";
}

/** Las nueve columnas de la planilla del equipo, en su orden exacto. */
const ENCABEZADOS_BASE = [
  "Fecha comentario",
  "Links",
  "Nombre Usuario/Cliente",
  "Reclamo/Mensaje",
  "Plataforma / RRSS",
  "Canal",
  "Clasificación Categoría Comentario",
  "Tonalidad",
  "Estado",
];

/**
 * Tres columnas extra al final, que no existen en su plantilla pero sin las cuales la planilla
 * y el informe no se pueden cuadrar: la planilla trae todo lo recibido y el deck solo el
 * volumen gestionado, y sin decir fila por fila cuál es cuál la diferencia parece un error.
 */
const ENCABEZADOS_DIAGNOSTICO = ["¿Cuenta en el volumen?", "Por qué no cuenta", "¿Caso SAC?"];
const ENCABEZADOS = [...ENCABEZADOS_BASE, ...ENCABEZADOS_DIAGNOSTICO];

const ART = { story_mention: "Mención en una historia", story_reply: "Respuesta a una historia", reaction: "Reacción" };

/** Por qué una fila queda fuera del volumen. Mismo criterio que `esMensajeGestionado`. */
function motivoDescarte(item) {
  const kind = item.metricoolRef?.contentContext?.kind ?? "";
  if (ART[kind]) return ART[kind];
  if (esIlegible(item)) return "Sin contenido legible desde Metricool";
  const texto = (item.text ?? "").replace(/\s+/g, " ").trim();
  if (!/\p{L}/u.test(texto)) return "Solo emojis o símbolos";
  return "Menos de 4 palabras";
}

const PLATAFORMA = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "Youtube",
  google_business: "Google Reviews",
};

/** Taxonomía del informe → la de la pestaña Criterios de sus planillas. */
const CATEGORIA = {
  reclamo: "Reclamo/Producto",
  consulta_producto: "Producto",
  precio: "Valor producto",
  stock: "Disponibilidad",
  despacho: "Despacho",
  seguimiento_pedido: "Seguimiento compra",
  postventa: "Devolución/Cambio",
  pago_facturacion: "Compra web",
  horarios_ubicacion: "Consulta/Tienda",
  contacto: "Atención al cliente",
  agradecimiento: "Opinión general",
  critica: "Opinión general",
  consulta_general: "Información",
  no_aplica: "Otros",
};

const ESTADO = {
  replied: "Resuelto",
  resolved: "Resuelto",
  escalated: "En gestión",
  drafted: "En proceso",
  pending: "Pendiente",
  new: "Pendiente",
};

/**
 * "Derivado" en la planilla significa que el caso salió hacia un área interna, y eso lo
 * decide el triaje, no el estado: `escalated` es una etiqueta del motor de reglas que también
 * cae sobre comentarios que nadie derivó a ninguna parte.
 */
function estado(item) {
  if (item.status === "replied" || item.status === "resolved") return "Resuelto";
  if (item.sacTriage?.requiereDerivacion) return "Derivado";
  return ESTADO[item.status] ?? "Pendiente";
}

const TONO = { positive: "Positivo", negative: "Negativo", neutral: "Neutro" };

function fecha(iso) {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

function fila(item) {
  const categoria = item.sacTriage?.categoria ?? item.category ?? "no_aplica";
  const gestionado = esMensajeGestionado(item);
  return [
    fecha(item.createdAt),
    item.metricoolRef?.contentContext?.permalink ?? "",
    (item.customerName ?? "").replace(/\s+/g, " ").trim(),
    (item.text ?? "").replace(/\s+/g, " ").trim(),
    PLATAFORMA[item.channel] ?? item.channel,
    item.type === "dm" ? "DM" : item.type === "review" ? "Reseña" : "Comentario Feed",
    CATEGORIA[categoria] ?? "Otros",
    TONO[item.sentiment] ?? "Neutro",
    estado(item),
    gestionado ? "Sí" : "No",
    gestionado ? "" : motivoDescarte(item),
    item.sacTriage ? (item.sacTriage.esCasoSac ? "Sí" : "No") : "sin clasificar",
  ];
}

loadLocalEnvironment();
const repository = createRepository(loadConfig());
await repository.initialize();
const store = await repository.snapshot();
await mkdir(salida, { recursive: true });

for (const brandId of marcasPedidas) {
  const brand = store.brands.find((b) => b.id === brandId);
  if (!brand) {
    console.log(`  ${brandId.padEnd(24)} no existe esa marca — omitida`);
    continue;
  }

  const entrantes = store.interactions
    .filter((i) => i.brandId === brand.id && i.direction === "inbound")
    .filter((i) => !desde || i.createdAt.slice(0, 7) >= desde)
    .filter((i) => !hasta || i.createdAt.slice(0, 7) <= hasta)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (!entrantes.length) {
    console.log(`  ${brand.name.padEnd(20)} sin mensajes en el período — omitida`);
    continue;
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Wiwo Nodes";
  workbook.created = new Date();

  const hoja = workbook.addWorksheet("Histórico", { views: [{ state: "frozen", ySplit: 1 }] });
  hoja.addRow(ENCABEZADOS);
  hoja.getRow(1).font = { bold: true };
  hoja.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
  for (const item of entrantes) hoja.addRow(fila(item));
  hoja.columns = [
    { width: 17 }, { width: 30 }, { width: 24 }, { width: 70 },
    { width: 17 }, { width: 18 }, { width: 30 }, { width: 12 }, { width: 13 },
    { width: 21 }, { width: 32 }, { width: 14 },
  ];
  hoja.getColumn(4).alignment = { wrapText: true, vertical: "top" };
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ENCABEZADOS.length } };

  // El resumen existe para que la planilla y el deck se puedan cuadrar sin recontar a mano:
  // son las mismas tres cifras que la lámina 5, mes a mes.
  const resumen = workbook.addWorksheet("Resumen");
  resumen.addRow(["Mes", "Recibidos", "Gestionados", "Casos SAC", "Respondidos", "Ilegibles"]);
  resumen.getRow(1).font = { bold: true };
  const meses = [...new Set(entrantes.map((i) => i.createdAt.slice(0, 7)))].sort();
  for (const mes of meses) {
    const delMes = entrantes.filter((i) => i.createdAt.startsWith(mes));
    const gestionados = delMes.filter(esMensajeGestionado);
    const casos = delMes.filter((i) => i.sacTriage?.esCasoSac);
    // Solo los meses que pasaron por el clasificador tienen casos. Poner 0 en el resto haría
    // leer "no hubo atención" donde en realidad dice "nadie lo ha clasificado todavía".
    const clasificado = delMes.some((i) => i.sacTriage);
    resumen.addRow([
      mes,
      delMes.length,
      gestionados.length,
      clasificado ? casos.length : "sin clasificar",
      clasificado ? casos.filter((i) => i.status === "replied").length : "sin clasificar",
      delMes.filter(esIlegible).length,
    ]);
  }
  resumen.columns = [{ width: 12 }, { width: 12 }, { width: 13 }, { width: 15 }, { width: 15 }, { width: 12 }];

  // El desglose de por qué se descarta cada fila: es lo que cierra la diferencia entre las
  // filas de esta planilla y el número que encabeza la presentación.
  const clasificables = entrantes.filter((i) => i.sacTriage);
  if (clasificables.length) {
    const descartados = entrantes.filter((i) => !esMensajeGestionado(i));
    const porMotivo = {};
    for (const i of descartados) porMotivo[motivoDescarte(i)] = (porMotivo[motivoDescarte(i)] ?? 0) + 1;

    resumen.addRow([]);
    const titulo = resumen.addRow(["De las filas de esta planilla al número de la presentación"]);
    titulo.font = { bold: true };
    resumen.addRow(["Filas en la pestaña Histórico", entrantes.length]);
    for (const [motivo, n] of Object.entries(porMotivo).sort((a, b) => b[1] - a[1])) {
      resumen.addRow([`  menos ${motivo.toLocaleLowerCase("es-CL")}`, -n]);
    }
    const totalGestionados = entrantes.filter(esMensajeGestionado).length;
    const volumen = resumen.addRow(["VOLUMEN TOTAL de la presentación", totalGestionados]);
    volumen.font = { bold: true };
    resumen.addRow(["  menos los que no requieren atención", -(totalGestionados - entrantes.filter((i) => i.sacTriage?.esCasoSac).length)]);
    const casos = resumen.addRow(["CASOS SAC de la presentación", entrantes.filter((i) => i.sacTriage?.esCasoSac).length]);
    casos.font = { bold: true };
  }

  resumen.addRow([]);
  const nota = resumen.addRow(["Gestionados = mensajes con contenido real: descuenta menciones en historias, reacciones y aplausos sueltos."]);
  nota.font = { italic: true, size: 9 };
  const nota2 = resumen.addRow(["Casos SAC = los que requieren atención, según el clasificador. Solo los meses marcados pasaron por él."]);
  nota2.font = { italic: true, size: 9 };
  const nota3 = resumen.addRow(["En la pestaña Histórico, filtrar \"¿Cuenta en el volumen?\" = Sí reproduce exactamente el número de la presentación."]);
  nota3.font = { italic: true, size: 9 };

  const archivo = path.join(salida, `BD SAC [${brand.name.toUpperCase()}] - ${etiquetaPeriodo()}.xlsx`);
  await writeFile(archivo, Buffer.from(await workbook.xlsx.writeBuffer()));

  const porRed = {};
  for (const i of entrantes) {
    const k = `${PLATAFORMA[i.channel]} ${i.type === "dm" ? "DM" : "com."}`;
    porRed[k] = (porRed[k] ?? 0) + 1;
  }
  console.log(`  ${brand.name.padEnd(20)} ${String(entrantes.length).padStart(5)} filas · ${meses.length} meses · ${Object.entries(porRed).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
  console.log(`  ${" ".repeat(20)} → ${archivo}`);
}

await repository.close?.();
