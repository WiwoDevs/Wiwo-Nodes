/**
 * Importa la bitácora manual de TikTok que el equipo lleva en Google Sheets.
 *
 * Metricool no expone mensajes privados de TikTok y sus comentarios llegan incompletos, así
 * que el equipo registra esa atención a mano en una planilla por marca. Sin esta carga, el
 * informe de Pichara —una cuenta que vive entera en TikTok— muestra una fracción de su mes.
 *
 * La planilla es la fuente de verdad para TikTok, pero no la única: parte de esos comentarios
 * también llegaron por la API. La deduplicación es por dos vías, porque los identificadores
 * no son comparables entre fuentes: `externalId` determinístico evita repetir una fila al
 * correr el script dos veces, y una comparación por marca, día y texto normalizado evita
 * contar dos veces lo que ya trajo Metricool.
 *
 * Lo que la planilla decide y lo que no: se respetan la fecha, el autor, el texto, el canal
 * y la tonalidad que anotó el equipo. La categoría no, porque su taxonomía —"Experiencia
 * general", "Opinión general"— no es la del informe; eso lo resuelve después el clasificador,
 * igual que con el resto de las marcas, para que los motivos sean comparables entre canales.
 *
 * El mismo formato lo usan las bitácoras de otras redes —Primeros Pueblos lleva la suya de
 * Instagram— así que el script acepta también una planilla suelta con su marca.
 *
 * Uso:
 *   node scripts/import-tiktok-sheets.mjs [--carpeta <folderId>] [--simular]
 *   node scripts/import-tiktok-sheets.mjs --planilla <sheetId> --marca <brandId> [--simular]
 */
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { JWT } from "google-auth-library";
import { loadConfig } from "../dist-api/config.js";
import { loadLocalEnvironment } from "../dist-api/load-env.js";
import { createRepository } from "../dist-api/repository-factory.js";

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : porDefecto;
}

const carpetaId = arg("carpeta", "1ynB-PKiJdF5VzbtsqPtcF0rxOt-l06xU");
const planillaId = arg("planilla", null);
const marcaExplicita = arg("marca", null);
const simular = process.argv.includes("--simular");

if (planillaId && !marcaExplicita) {
  console.error("Con --planilla hay que indicar --marca <brandId>: el nombre del archivo no basta para saber de quién es.");
  process.exit(1);
}

/**
 * Qué planilla alimenta a qué marca. El nombre del archivo no basta: "BD SAC [PICHARA]" y
 * "BD SAC TIKTOK [TRUE CALLER]" no siguen un patrón común, y equivocarse aquí mete los
 * comentarios de una marca en el informe de otra.
 */
const MARCA_POR_PLANILLA = [
  [/MULTI ?PLAZA/i, "multiplaza-bogota"],
  [/PICHARA/i, "picharaoficial"],
  [/COLB[ÚU]N/i, "colbun"],
  [/TRUE ?CALLER/i, "truecaller-espanol"],
];

const TONO = { positivo: "positive", neutro: "neutral", negativo: "negative" };
const PESTANA = "Histórico";

/** Columna "Plataforma / RRSS" de la planilla → canal de Nodes. */
const CANAL_POR_PLATAFORMA = {
  tiktok: "tiktok",
  instagram: "instagram",
  facebook: "facebook",
  linkedin: "linkedin",
  x: "x",
  twitter: "x",
  youtube: "youtube",
  "google reviews": "google_business",
};

loadLocalEnvironment();
const config = loadConfig();

const bruto = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
if (!bruto) {
  console.error("Falta FIREBASE_SERVICE_ACCOUNT_KEY para leer las planillas.");
  process.exit(1);
}
const sa = JSON.parse(bruto.startsWith("{") ? bruto : Buffer.from(bruto, "base64").toString("utf8"));
const auth = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets.readonly",
  ],
});
const { token } = await auth.getAccessToken();

async function google(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.replace(/\s+/g, " ").slice(0, 200)}`);
  return JSON.parse(t);
}

/** `DD/MM/YYYY` a instante ISO. La planilla no registra hora; se fija mediodía UTC. */
function fechaISO(valor) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((valor ?? "").trim());
  if (!m) return undefined;
  const [, d, mes, a] = m;
  const fecha = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d), 12));
  return Number.isNaN(fecha.getTime()) ? undefined : fecha.toISOString();
}

const normalizar = (valor) => (valor ?? "").toLowerCase().replace(/\s+/g, " ").trim();

const repository = createRepository(config);
await repository.initialize();
const store = await repository.snapshot();
const marcas = new Map(store.brands.map((b) => [b.id, b]));

const letras = (valor) => (valor.match(/\p{L}/gu) ?? []).length;

/**
 * Un texto es distintivo cuando repetirlo por casualidad es improbable. "Tienen tintes manic
 * panic?" lo es; "🥰🥰🥰" y "💙💙" no, y de hecho se repiten a diario entre usuarios distintos.
 */
const DISTINTIVO = 8;
const DIAS_DE_TOLERANCIA = 3;

/**
 * Lo que ya está en el repositorio para TikTok, indexado por marca y texto: es la única forma
 * de reconocer una fila que Metricool ya había traído con otro identificador.
 *
 * La fecha no coincide siempre. La planilla registra cuándo el equipo atendió el comentario y
 * Metricool cuándo se publicó, y entre ambas hay hasta tres días de diferencia: el mismo
 * "¿Cómo se puede postular para ser embajador?" aparece un día en cada fuente. Por eso el
 * cotejo de los textos distintivos admite una ventana, y el de los repetibles no.
 */
const fechasPorTexto = new Map();
for (const item of store.interactions) {
  // Se indexa todo lo entrante de la marca, no solo un canal: la planilla puede traer redes
  // que Metricool ya cubre, y ahí es donde el cotejo por texto tiene que actuar.
  if (item.direction !== "inbound") continue;
  const clave = `${item.brandId}|${normalizar(item.text)}`;
  if (!fechasPorTexto.has(clave)) fechasPorTexto.set(clave, []);
  fechasPorTexto.get(clave).push(item.createdAt.slice(0, 10));
}

const dia = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

function yaEstaba(brandId, fecha, texto) {
  const registradas = fechasPorTexto.get(`${brandId}|${normalizar(texto)}`);
  if (!registradas) return false;
  if (registradas.includes(fecha)) return true;
  if (letras(texto) < DISTINTIVO) return false;
  return registradas.some((otra) => Math.abs(dia(otra) - dia(fecha)) <= DIAS_DE_TOLERANCIA);
}

function registrar(brandId, fecha, texto) {
  const clave = `${brandId}|${normalizar(texto)}`;
  if (!fechasPorTexto.has(clave)) fechasPorTexto.set(clave, []);
  fechasPorTexto.get(clave).push(fecha);
}

let archivos;
if (planillaId) {
  const meta = await google(`https://www.googleapis.com/drive/v3/files/${planillaId}?fields=id,name&supportsAllDrives=true`);
  archivos = [meta];
  console.log(`planilla suelta: "${meta.name}" → ${marcaExplicita}\n`);
} else {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", `'${carpetaId}' in parents and trashed=false`);
  url.searchParams.set("fields", "files(id,name,mimeType)");
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("corpora", "allDrives");
  archivos = (await google(url)).files
    .filter((f) => f.mimeType === "application/vnd.google-apps.spreadsheet");
  console.log(`${archivos.length} planillas en la carpeta\n`);
}

const nuevas = [];
let filasLeidas = 0;
let repetidas = 0;
let sinMarca = 0;
let invalidas = 0;

for (const archivo of archivos.sort((a, b) => a.name.localeCompare(b.name))) {
  const encontrada = MARCA_POR_PLANILLA.find(([patron]) => patron.test(archivo.name));
  const brand = marcaExplicita ? marcas.get(marcaExplicita) : encontrada && marcas.get(encontrada[1]);
  if (!brand) {
    sinMarca += 1;
    console.log(`  ${archivo.name.padEnd(34)} sin marca asociada — omitida`);
    continue;
  }

  const rango = encodeURIComponent(`${PESTANA}!A2:I5000`);
  const valores = await google(`https://sheets.googleapis.com/v4/spreadsheets/${archivo.id}/values/${rango}`);
  const filas = (valores.values ?? []).filter((f) => (f[0] ?? "").trim());

  let creadas = 0;
  let repetidasAqui = 0;
  for (const fila of filas) {
    filasLeidas += 1;
    const [fecha, , usuario, texto, plataforma, canal, , tonalidad, estado] = fila;
    const createdAt = fechaISO(fecha);
    const contenido = (texto ?? "").replace(/\s+/g, " ").trim();
    if (!createdAt || !contenido) {
      invalidas += 1;
      continue;
    }
    const canalDeLaFila = CANAL_POR_PLATAFORMA[normalizar(plataforma)];
    if (!canalDeLaFila) {
      invalidas += 1;
      continue;
    }

    const dia = createdAt.slice(0, 10);
    if (yaEstaba(brand.id, dia, contenido)) {
      repetidas += 1;
      repetidasAqui += 1;
      continue;
    }
    registrar(brand.id, dia, contenido);

    const huella = createHash("sha1")
      .update(`${brand.id}|${fecha}|${usuario ?? ""}|${contenido}`)
      .digest("hex")
      .slice(0, 24);

    nuevas.push({
      id: randomUUID(),
      externalId: `planilla:${canalDeLaFila}:${brand.id}:${huella}`,
      brandId: brand.id,
      accountId: brand.account.id,
      channel: canalDeLaFila,
      type: /dm/i.test(canal ?? "") ? "dm" : "comment",
      direction: "inbound",
      customerName: (usuario ?? "").replace(/\s+/g, " ").trim() || "Usuario de TikTok",
      customerHandle: "",
      text: contenido,
      category: "otro",
      sentiment: TONO[normalizar(tonalidad)] ?? "neutral",
      confidence: 0.5,
      // El equipo cierra la fila cuando la atendió; es su propio registro de gestión.
      status: /resuelto/i.test(estado ?? "") ? "replied" : "pending",
      source: "planilla",
      version: 1,
      createdAt,
      updatedAt: new Date().toISOString(),
      internalNotes: [],
      audit: [{
        id: randomUUID(),
        at: new Date().toISOString(),
        action: "ingested",
        actor: "system",
        detail: `Cargado desde la planilla "${archivo.name}" de la carpeta SAC (TIKTOK).`,
      }],
    });
    creadas += 1;
  }

  console.log(
    `  ${archivo.name.padEnd(34)} → ${brand.name.padEnd(20)}`
    + ` ${String(filas.length).padStart(4)} filas · ${String(creadas).padStart(4)} nuevas · ${repetidasAqui} ya estaban`,
  );
}

console.log(`\nleídas ${filasLeidas} · nuevas ${nuevas.length} · ya conocidas ${repetidas} · descartadas ${invalidas}`);
if (sinMarca) console.log(`planillas sin marca asociada: ${sinMarca}`);

const porTipo = nuevas.reduce((acc, i) => ({ ...acc, [i.type]: (acc[i.type] ?? 0) + 1 }), {});
console.log("por tipo:", porTipo);

if (simular) {
  console.log("\n(simulación: no se escribió nada)");
} else if (nuevas.length) {
  const resultado = await repository.insertInteractions(nuevas);
  console.log(`\ninsertadas ${resultado.created.length} · duplicadas por externalId ${resultado.duplicates}`);
}

await repository.close?.();
