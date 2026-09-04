/**
 * Redacta con Claude los cinco campos editoriales del reporte SAC, marca por marca.
 *
 * Deja el resultado en un JSON aparte en vez de escribirlo directo en la presentación:
 * el texto va firmado ante el cliente, así que tiene que poder leerse, corregirse a mano y
 * volver a usarse sin gastar otra corrida. `generate-sac-report.mjs --editorial` lo consume.
 *
 * Es reanudable: por defecto conserva lo que ya está redactado en el archivo de salida, de
 * modo que un texto corregido a mano sobrevive a la siguiente corrida. `--rehacer` lo pisa.
 *
 * Uso:
 *   node scripts/draft-sac-editorial.mjs --mes 2026-08 [--marca <brandId>] [--rehacer]
 *                                        [--salida ./reportes/editorial-2026-08.json]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../dist-api/config.js";
import { loadLocalEnvironment } from "../dist-api/load-env.js";
import { createRepository } from "../dist-api/repository-factory.js";
import { buildSacReport } from "../dist-api/sac-report.js";
import { draftSacEditorial } from "../dist-api/sac-editorial.js";

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : porDefecto;
}

const mes = arg("mes", null);
const soloMarca = arg("marca", null);
const rehacer = process.argv.includes("--rehacer");
if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
  console.error("Uso: --mes YYYY-MM [--marca <brandId>] [--rehacer] [--salida <archivo.json>]");
  process.exit(1);
}
const salida = arg("salida", `./reportes/editorial-${mes}.json`);
const volumen = process.argv.includes("--volumen-bruto") ? "bruto" : "gestionado";

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const [anio, mesNum] = mes.split("-").map(Number);
const ultimoDia = new Date(Date.UTC(anio, mesNum, 0)).getUTCDate();
const desde = `${mes}-01`;
const hasta = `${mes}-${String(ultimoDia).padStart(2, "0")}`;
const etiqueta = `${MESES[mesNum - 1]} ${anio}`;
const anteriorMes = mesNum === 1 ? `${anio - 1}-12` : `${anio}-${String(mesNum - 1).padStart(2, "0")}`;
const [aAnio, aMes] = anteriorMes.split("-").map(Number);
const anterior = {
  from: `${anteriorMes}-01`,
  to: `${anteriorMes}-${String(new Date(Date.UTC(aAnio, aMes, 0)).getUTCDate()).padStart(2, "0")}`,
};

// Redes que la plantilla sabe graficar. El resto se cuenta en los totales pero no aparece
// desglosado, y el texto de cierre es el único lugar donde puede nombrarse.
const REDES_DE_LA_PLANTILLA = new Set(["instagram", "facebook", "tiktok"]);
const NOMBRE_SUPERFICIE = {
  "instagram/dm": "Instagram privado",
  "instagram/comment": "Instagram comentarios",
  "facebook/dm": "Facebook privado",
  "facebook/comment": "Facebook comentarios",
  "tiktok/comment": "TikTok comentarios",
  "linkedin/comment": "LinkedIn comentarios",
  "youtube/comment": "YouTube comentarios",
  "x/dm": "X privado",
  "google_business/review": "Google reseñas",
};

loadLocalEnvironment();
const config = loadConfig();
const repository = createRepository(config);
await repository.initialize();
const store = await repository.snapshot();

const marcas = store.brands
  .filter((b) => b.active && b.account.active && (!soloMarca || b.id === soloMarca))
  .sort((a, b) => a.name.localeCompare(b.name));

// El archivo previo se lee siempre, incluso con `--rehacer`: rehacer significa volver a
// redactar las marcas en alcance, no descartar el trabajo de las que quedaron fuera de él.
let previos = {};
try {
  previos = JSON.parse(await readFile(salida, "utf8"));
} catch {
  previos = {};
}

const dentro = (item) => {
  const fecha = item.createdAt.slice(0, 10);
  return fecha >= desde && fecha <= hasta;
};

/** Muestra corta y variada: los motivos que más pesan, priorizando lo negativo y lo sin responder. */
function muestrear(casos, tope = 18) {
  const puntaje = (item) =>
    (item.sentiment === "negative" ? 2 : 0)
    + (item.status === "replied" ? 0 : 1)
    + (item.sacTriage?.requiereDerivacion ? 1 : 0);
  const porMotivo = new Map();
  for (const item of casos) {
    const motivo = item.sacTriage?.categoria ?? "no_aplica";
    if (!porMotivo.has(motivo)) porMotivo.set(motivo, []);
    porMotivo.get(motivo).push(item);
  }
  // Ronda por motivo para que la muestra no la copen los dos motivos más voluminosos.
  const colas = [...porMotivo.entries()]
    .sort((l, r) => r[1].length - l[1].length)
    .map(([motivo, items]) => [motivo, items.sort((l, r) => puntaje(r) - puntaje(l))]);
  const muestra = [];
  for (let vuelta = 0; muestra.length < tope; vuelta += 1) {
    let agregó = false;
    for (const [motivo, items] of colas) {
      if (vuelta >= items.length || muestra.length >= tope) continue;
      const item = items[vuelta];
      muestra.push({
        motivo,
        tono: item.sentiment,
        superficie: NOMBRE_SUPERFICIE[`${item.channel}/${item.type}`] ?? `${item.channel}/${item.type}`,
        respondido: item.status === "replied",
        texto: (item.text ?? "").replace(/\s+/g, " ").trim().slice(0, 220),
      });
      agregó = true;
    }
    if (!agregó) break;
  }
  return muestra.filter((m) => m.texto);
}

await mkdir(path.dirname(path.resolve(salida)), { recursive: true });

const resultado = { ...previos };
let redactadas = 0;
let conservadas = 0;

for (const brand of marcas) {
  const cifras = buildSacReport(brand, store.interactions, {
    from: desde, to: hasta, previous: anterior, label: etiqueta, volumen,
  });
  if (!cifras.casosSac) {
    console.log(`  ${brand.name.padEnd(22)} sin casos en el período — omitida`);
    continue;
  }
  if (resultado[brand.id] && !rehacer) {
    conservadas += 1;
    console.log(`  ${brand.name.padEnd(22)} ya redactada — conservada`);
    continue;
  }

  const casos = store.interactions.filter((item) =>
    item.brandId === brand.id
    && item.direction === "inbound"
    && dentro(item)
    && (item.sacTriage?.esCasoSac ?? true));

  const porSuperficie = new Map();
  for (const item of casos) {
    const clave = `${item.channel}/${item.type}`;
    if (!porSuperficie.has(clave)) porSuperficie.set(clave, { casos: 0, respondidos: 0 });
    const s = porSuperficie.get(clave);
    s.casos += 1;
    if (item.status === "replied") s.respondidos += 1;
  }
  const superficies = [...porSuperficie.entries()]
    .map(([clave, s]) => ({
      superficie: NOMBRE_SUPERFICIE[clave] ?? clave,
      casos: s.casos,
      respondidos: s.respondidos,
      pct: s.casos ? Math.round((s.respondidos / s.casos) * 1000) / 10 : 0,
    }))
    .sort((l, r) => r.casos - l.casos);

  const fueraDePlantilla = [...porSuperficie.entries()]
    .filter(([clave]) => !REDES_DE_LA_PLANTILLA.has(clave.split("/")[0]))
    .map(([clave, s]) => ({ canal: NOMBRE_SUPERFICIE[clave] ?? clave, casos: s.casos }));

  const NOMBRE_RED = {
    instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok",
    linkedin: "LinkedIn", youtube: "YouTube", x: "X", google_business: "Google Business",
  };

  try {
    const editorial = await draftSacEditorial({
      figures: cifras,
      superficies,
      ejemplos: muestrear(casos),
      fueraDePlantilla,
      redesConectadas: brand.account.channels.map((c) => NOMBRE_RED[c] ?? c),
    });
    resultado[brand.id] = { marca: brand.name, periodo: etiqueta, ...editorial };
    redactadas += 1;
    console.log(`  ${brand.name.padEnd(22)} ✓ ${editorial.next1.titulo} · ${editorial.next2.titulo}`);
  } catch (error) {
    console.log(`  ${brand.name.padEnd(22)} error: ${error.message}`);
  }
}

await writeFile(salida, `${JSON.stringify(resultado, null, 1)}\n`, "utf8");
console.log(`\nredactadas ${redactadas} · conservadas ${conservadas}`);
console.log(`borradores en ${path.resolve(salida)} — requieren revisión humana antes de presentar.`);

await repository.close?.();
