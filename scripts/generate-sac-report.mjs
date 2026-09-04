/**
 * Genera el reporte SAC mensual por marca, rellenando la plantilla `.pptx`.
 *
 * No contacta a Google: la plantilla se descarga una vez como `.pptx` y el relleno es un
 * reemplazo de texto sobre su XML. Así el generador no necesita credenciales ni permisos
 * adicionales, y produce el mismo archivo estando o no conectado.
 *
 * Uso:
 *   node scripts/generate-sac-report.mjs --plantilla ruta.pptx --mes 2026-08 [--marca colbun] [--salida ./reportes]
 *                                        [--editorial ./reportes/editorial-2026-08.json]
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../dist-api/config.js";
import { loadLocalEnvironment } from "../dist-api/load-env.js";
import { createRepository } from "../dist-api/repository-factory.js";
import { buildSacReport, reportPlaceholders } from "../dist-api/sac-report.js";
import { editorialPlaceholders } from "../dist-api/sac-editorial.js";
import { fillPptxTemplate, readTemplatePlaceholders } from "../dist-api/pptx-template.js";

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : porDefecto;
}

const plantillaRuta = arg("plantilla", null);
const mes = arg("mes", null);
const soloMarca = arg("marca", null);
const salida = arg("salida", "./reportes");
const volumen = process.argv.includes("--volumen-bruto") ? "bruto" : "gestionado";
const editorialRuta = arg("editorial", null);

if (!plantillaRuta || !mes || !/^\d{4}-\d{2}$/.test(mes)) {
  console.error("Uso: --plantilla <archivo.pptx> --mes YYYY-MM [--marca <brandId>] [--salida <dir>]");
  process.exit(1);
}

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const [anio, mesNum] = mes.split("-").map(Number);
const ultimoDia = new Date(Date.UTC(anio, mesNum, 0)).getUTCDate();
const desde = `${mes}-01`;
const hasta = `${mes}-${String(ultimoDia).padStart(2, "0")}`;
const etiqueta = `${MESES[mesNum - 1]} ${anio}`;

// Período anterior, para la variación.
const anteriorMes = mesNum === 1 ? `${anio - 1}-12` : `${anio}-${String(mesNum - 1).padStart(2, "0")}`;
const [aAnio, aMes] = anteriorMes.split("-").map(Number);
const anterior = {
  from: `${anteriorMes}-01`,
  to: `${anteriorMes}-${String(new Date(Date.UTC(aAnio, aMes, 0)).getUTCDate()).padStart(2, "0")}`,
};

loadLocalEnvironment();
const config = loadConfig();
const repository = createRepository(config);
await repository.initialize();
const store = await repository.snapshot();

const plantilla = await readFile(plantillaRuta);
const requeridos = await readTemplatePlaceholders(plantilla);
console.log(`plantilla: ${requeridos.length} marcadores\n  ${requeridos.join(", ")}\n`);

// Los cinco campos de cierre son texto firmado ante el cliente: se redactan aparte con
// `draft-sac-editorial.mjs` para poder corregirlos a mano, y entran acá ya aprobados.
let editorial = {};
if (editorialRuta) {
  try {
    editorial = JSON.parse(await readFile(editorialRuta, "utf8"));
    console.log(`cierre editorial: ${Object.keys(editorial).length} marcas desde ${editorialRuta}\n`);
  } catch (error) {
    console.error(`No fue posible leer ${editorialRuta}: ${error.message}`);
    process.exit(1);
  }
}

const marcas = store.brands.filter((b) =>
  b.active && b.account.active && (!soloMarca || b.id === soloMarca));
if (!marcas.length) {
  console.error("No hay marcas activas que coincidan.");
  process.exit(1);
}

await mkdir(salida, { recursive: true });
console.log(`generando ${marcas.length} reporte(s) de ${etiqueta}\n`);

const avisosGlobales = new Set();
for (const brand of marcas) {
  const cifras = buildSacReport(brand, store.interactions, {
    from: desde, to: hasta, previous: anterior, label: etiqueta, volumen,
  });
  if (!cifras.casosSac) {
    console.log(`  ${brand.name.padEnd(24)} sin casos en el período — omitida`);
    continue;
  }

  const cierre = editorial[brand.id];
  const valores = {
    ...reportPlaceholders(cifras),
    ...(cierre ? editorialPlaceholders(cierre) : {}),
  };
  const { buffer, sinValor, noUsados } = await fillPptxTemplate(plantilla, valores);
  const archivo = path.join(salida, `SAC ${brand.name} ${etiqueta}.pptx`);
  await writeFile(archivo, buffer);

  console.log(
    `  ${brand.name.padEnd(24)} casos=${String(cifras.casosSac).padStart(4)}`
    + ` (de ${String(cifras.volumenBruto).padStart(4)} brutos)`
    + ` derivados=${String(cifras.derivados).padStart(3)}`
    + ` cobertura=${String(cifras.coberturaPct).padStart(5)}%`,
  );
  if (sinValor.length) console.log(`      marcadores sin valor: ${sinValor.join(", ")}`);
  if (noUsados.length) console.log(`      valores no usados por la plantilla: ${noUsados.join(", ")}`);
  for (const aviso of cifras.advertencias) avisosGlobales.add(aviso);
}

if (avisosGlobales.size) {
  console.log("\nADVERTENCIAS — revisar antes de presentar:");
  for (const aviso of avisosGlobales) console.log(`  · ${aviso}`);
}
console.log(`\narchivos en ${path.resolve(salida)}`);

await repository.close?.();
