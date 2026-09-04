/**
 * Publica el reporte SAC mensual como Google Slides nativos, uno por marca.
 *
 * Copia la plantilla y reemplaza los marcadores con la API de Slides. Frente a rellenar un
 * `.pptx`, esto tiene dos ventajas: el archivo resultante es un Slides de verdad (no una
 * conversión que puede mover tipografías), y `replaceAllText` encuentra los marcadores aunque
 * el editor haya partido el texto en varios runs, que es el caso habitual.
 *
 * Autentica con el mismo service account de Firebase que ya usa la aplicación. Ese service
 * account puede crear archivos pero no borrarlos, así que el script nunca destruye nada: si
 * algo sale mal, deja el archivo creado y lo reporta para que una persona decida.
 *
 * El destino puede ser una carpeta única (`--carpeta`) o una por marca (`--carpetas`, un JSON
 * `{ brandId: folderId }`), que es como está organizado el Drive del equipo: cada cliente
 * tiene su carpeta y el informe del mes va adentro.
 *
 * Uso:
 *   node scripts/publish-sac-slides.mjs --plantilla <slidesId> --mes 2026-08
 *                                       (--carpeta <folderId> | --carpetas <mapa.json>)
 *                                       [--editorial <archivo.json>] [--marca colbun] [--simular]
 */
import { readFile } from "node:fs/promises";
import { JWT } from "google-auth-library";
import { loadConfig } from "../dist-api/config.js";
import { loadLocalEnvironment } from "../dist-api/load-env.js";
import { createRepository } from "../dist-api/repository-factory.js";
import { buildSacReport, reportPlaceholders } from "../dist-api/sac-report.js";
import { editorialPlaceholders } from "../dist-api/sac-editorial.js";

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : porDefecto;
}

const plantillaId = arg("plantilla", null);
const carpetaId = arg("carpeta", null);
const carpetasRuta = arg("carpetas", null);
const editorialRuta = arg("editorial", null);
const mes = arg("mes", null);
const soloMarca = arg("marca", null);
const simular = process.argv.includes("--simular");
const volumen = process.argv.includes("--volumen-bruto") ? "bruto" : "gestionado";

if (!plantillaId || (!carpetaId && !carpetasRuta) || !mes || !/^\d{4}-\d{2}$/.test(mes)) {
  console.error(
    "Uso: --plantilla <slidesId> --mes YYYY-MM (--carpeta <folderId> | --carpetas <mapa.json>)"
    + " [--editorial <archivo.json>] [--marca <brandId>] [--simular]",
  );
  process.exit(1);
}

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const [anio, mesNum] = mes.split("-").map(Number);
const ultimo = new Date(Date.UTC(anio, mesNum, 0)).getUTCDate();
const desde = `${mes}-01`;
const hasta = `${mes}-${String(ultimo).padStart(2, "0")}`;
const etiqueta = `${MESES[mesNum - 1]} ${anio}`;
const anteriorMes = mesNum === 1 ? `${anio - 1}-12` : `${anio}-${String(mesNum - 1).padStart(2, "0")}`;
const [aAnio, aMes] = anteriorMes.split("-").map(Number);
const anterior = {
  from: `${anteriorMes}-01`,
  to: `${anteriorMes}-${String(new Date(Date.UTC(aAnio, aMes, 0)).getUTCDate()).padStart(2, "0")}`,
};

loadLocalEnvironment();
const bruto = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
if (!bruto) {
  console.error("Falta FIREBASE_SERVICE_ACCOUNT_KEY.");
  process.exit(1);
}
const sa = JSON.parse(bruto.startsWith("{") ? bruto : Buffer.from(bruto, "base64").toString("utf8"));
const auth = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/presentations",
  ],
});
const { token } = await auth.getAccessToken();
const cabeceras = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

async function google(url, init) {
  const res = await fetch(url, { ...init, headers: { ...cabeceras, ...(init?.headers ?? {}) } });
  const texto = await res.text();
  if (!res.ok) {
    // El cuerpo de error de Google trae el motivo exacto; se propaga acotado.
    throw new Error(`${res.status} ${texto.replace(/\s+/g, " ").slice(0, 200)}`);
  }
  return texto ? JSON.parse(texto) : {};
}

const carpetasPorMarca = carpetasRuta ? JSON.parse(await readFile(carpetasRuta, "utf8")) : {};
const editorial = editorialRuta ? JSON.parse(await readFile(editorialRuta, "utf8")) : {};

const EMU_POR_CM = 914400 / 2.54;

/**
 * Pinta las barras de la lámina 2, que en la plantilla son cajas con borde y sin relleno.
 *
 * Google Slides no sabe llenar una forma en parte, así que sobre cada riel se dibuja una
 * segunda forma del ancho que corresponde al porcentaje. Las barras se ubican por geometría
 * y no por identificador: cada riel se emparea con la etiqueta que tiene justo debajo, de
 * modo que el relleno sigue siendo correcto aunque la plantilla se reordene.
 */
async function rellenarBarras(presentationId, cifras) {
  const presentacion = await google(`https://slides.googleapis.com/v1/presentations/${presentationId}`);
  const lamina = presentacion.slides[1];
  if (!lamina) return 0;

  const caja = (el) => ({
    x: el.transform?.translateX ?? 0,
    y: el.transform?.translateY ?? 0,
    ancho: (el.size?.width?.magnitude ?? 0) * (el.transform?.scaleX ?? 1),
    alto: (el.size?.height?.magnitude ?? 0) * (el.transform?.scaleY ?? 1),
  });
  const textoDe = (el) => (el.shape?.text?.textElements ?? []).map((t) => t.textRun?.content ?? "").join("");

  const elementos = lamina.pageElements ?? [];
  // Un riel: forma redondeada, sin texto y del ancho de una barra. El recuadro azul del pie
  // también es redondeado, pero mide el triple de alto.
  const rieles = elementos.filter((el) =>
    el.shape?.shapeType === "ROUND_RECTANGLE"
    && !textoDe(el).trim()
    && caja(el).alto < 1.2 * EMU_POR_CM);

  const etiquetas = elementos
    .filter((el) => /Chats Privados|Comentarios/.test(textoDe(el)) && /\(\d+\)/.test(textoDe(el)))
    .map((el) => ({ texto: textoDe(el), ...caja(el) }));

  const total = cifras.mensajesGestionados || 1;
  const requests = [];
  for (const [indice, riel] of rieles.entries()) {
    const g = caja(riel);
    // La etiqueta de la barra es la que empieza en la misma columna y cae inmediatamente debajo.
    const etiqueta = etiquetas
      .filter((e) => Math.abs(e.x - g.x) < 0.4 * EMU_POR_CM && e.y > g.y && e.y - g.y < 2 * EMU_POR_CM)
      .sort((a, b) => a.y - b.y)[0];
    if (!etiqueta) continue;

    const cantidad = Number((/\((\d+)\)/.exec(etiqueta.texto) ?? [])[1] ?? 0);
    const proporcion = Math.min(1, cantidad / total);
    if (proporcion <= 0) continue;

    const privado = /Privados/.test(etiqueta.texto);
    const objectId = `barra_${indice}_${Date.now().toString(36).slice(-5)}`;
    requests.push({
      createShape: {
        objectId,
        shapeType: "ROUND_RECTANGLE",
        elementProperties: {
          pageObjectId: lamina.objectId,
          size: {
            width: { magnitude: Math.max(g.alto, g.ancho * proporcion), unit: "EMU" },
            height: { magnitude: g.alto, unit: "EMU" },
          },
          transform: { scaleX: 1, scaleY: 1, translateX: g.x, translateY: g.y, unit: "EMU" },
        },
      },
    });
    requests.push({
      updateShapeProperties: {
        objectId,
        fields: "shapeBackgroundFill.solidFill.color,outline",
        shapeProperties: {
          shapeBackgroundFill: {
            solidFill: {
              color: {
                rgbColor: privado
                  ? { red: 0.898, green: 0.098, blue: 0.541 }
                  : { red: 0.145, green: 0.196, blue: 0.612 },
              },
            },
          },
          outline: { propertyState: "NOT_RENDERED" },
        },
      },
    });
  }

  if (!requests.length) return 0;
  await google(`https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`,
    { method: "POST", body: JSON.stringify({ requests }) });
  return requests.length / 2;
}

/**
 * Verifica un destino antes de escribir en él. Dos motivos: fallar acá evita 14 archivos mal
 * ubicados, y un service account no tiene cuota propia, así que una carpeta de "Mi unidad"
 * —la que no trae `driveId`— devuelve un 403 de cuota recién al crear el archivo.
 */
async function verificarCarpeta(id) {
  const carpeta = await google(
    `https://www.googleapis.com/drive/v3/files/${id}`
    + "?fields=id,name,mimeType,driveId,capabilities(canAddChildren)&supportsAllDrives=true",
  );
  if (carpeta.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error(`"${carpeta.name}" no es una carpeta.`);
  }
  if (!carpeta.driveId) {
    throw new Error(
      `"${carpeta.name}" está en Mi unidad. Un service account no tiene cuota ahí: `
      + "el destino debe estar en una unidad compartida.",
    );
  }
  if (!carpeta.capabilities?.canAddChildren) {
    throw new Error(`sin permiso para crear dentro de "${carpeta.name}".`);
  }
  return carpeta;
}

console.log(`service account: ${sa.client_email}`);
console.log(`período: ${etiqueta}`);
if (carpetaId) {
  try {
    const carpeta = await verificarCarpeta(carpetaId);
    console.log(`carpeta destino: ${carpeta.name} (${carpeta.id})`);
  } catch (error) {
    console.error(`Destino inválido: ${error.message}`);
    process.exit(1);
  }
} else {
  console.log(`destinos: ${Object.keys(carpetasPorMarca).length} carpetas por marca`);
}
if (editorialRuta) console.log(`cierre editorial: ${Object.keys(editorial).length} marcas`);
console.log("");

const config = loadConfig();
const repository = createRepository(config);
await repository.initialize();
const store = await repository.snapshot();

const marcas = store.brands.filter((b) =>
  b.active && b.account.active && (!soloMarca || b.id === soloMarca));

const creados = [];
const avisos = new Set();

for (const brand of marcas) {
  const cifras = buildSacReport(brand, store.interactions, {
    from: desde, to: hasta, previous: anterior, label: etiqueta, volumen,
  });
  if (!cifras.casosSac) {
    console.log(`  ${brand.name.padEnd(24)} sin casos — omitida`);
    continue;
  }
  for (const aviso of cifras.advertencias) avisos.add(aviso);

  const cierre = editorial[brand.id];
  const valores = { ...reportPlaceholders(cifras), ...(cierre ? editorialPlaceholders(cierre) : {}) };
  const nombre = `SAC ${brand.name} ${etiqueta}`;
  const destino = carpetaId ?? carpetasPorMarca[brand.id];

  if (!destino) {
    console.log(`  ${brand.name.padEnd(24)} sin carpeta asignada — omitida`);
    continue;
  }

  if (simular) {
    let estado = "destino sin verificar";
    try {
      estado = `→ ${(await verificarCarpeta(destino)).name}`;
    } catch (error) {
      estado = `⚠ ${error.message}`;
    }
    console.log(
      `  ${brand.name.padEnd(24)} casos=${String(cifras.casosSac).padStart(4)}`
      + ` cierre=${cierre ? "sí" : "NO"}  "${nombre}"  ${estado}`,
    );
    continue;
  }

  let copia;
  try {
    copia = await google(
      `https://www.googleapis.com/drive/v3/files/${plantillaId}/copy?supportsAllDrives=true&fields=id,webViewLink`,
      { method: "POST", body: JSON.stringify({ name: nombre, parents: [destino] }) },
    );
  } catch (error) {
    console.log(`  ${brand.name.padEnd(24)} no se pudo copiar: ${error.message}`);
    continue;
  }

  const requests = Object.entries(valores).map(([clave, valor]) => ({
    replaceAllText: {
      containsText: { text: `{{${clave}}}`, matchCase: true },
      replaceText: valor,
    },
  }));

  try {
    const resultado = await google(
      `https://slides.googleapis.com/v1/presentations/${copia.id}:batchUpdate`,
      { method: "POST", body: JSON.stringify({ requests }) },
    );
    const cambios = (resultado.replies ?? [])
      .reduce((total, r) => total + (r.replaceAllText?.occurrencesChanged ?? 0), 0);
    // Las barras se pintan después del texto: su ancho sale del número ya escrito en la
    // etiqueta, así el gráfico no puede quedar diciendo algo distinto de la cifra.
    const barras = await rellenarBarras(copia.id, cifras);
    console.log(
      `  ${brand.name.padEnd(24)} casos=${String(cifras.casosSac).padStart(4)}`
      + ` reemplazos=${String(cambios).padStart(3)} barras=${String(barras).padStart(2)}  ${copia.webViewLink}`,
    );
    creados.push({ marca: brand.name, url: copia.webViewLink });
  } catch (error) {
    // La copia ya existe y no se puede borrar con este service account: se reporta para
    // que una persona la revise en vez de dejar el fallo silencioso.
    console.log(`  ${brand.name.padEnd(24)} copia creada pero el reemplazo falló: ${error.message}`);
    console.log(`      revisar y borrar a mano: ${copia.webViewLink}`);
  }
}

if (avisos.size) {
  console.log("\nADVERTENCIAS — revisar antes de presentar:");
  for (const aviso of avisos) console.log(`  · ${aviso}`);
}
console.log(`\npresentaciones creadas: ${creados.length}`);

await repository.close?.();
