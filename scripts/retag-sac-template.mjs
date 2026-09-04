/**
 * Separa en la plantilla los dos totales que hoy comparten el marcador `{{sac_total}}`.
 *
 * La plantilla nombra ambos conceptos en su propio texto —la lámina 5 dice "VOLUMEN TOTAL"
 * y tres pasos más abajo "CASOS SAC"— pero los rellena con el mismo marcador, así que la
 * tabla de motivos de la lámina 4 no sumaba su propio encabezado. Esto reetiqueta cada
 * aparición según lo que la lámina dice que es:
 *
 *   lámina 2  volumen     el número grande y la distribución por canal
 *   lámina 4  volumen     la fila "Suma total" de la tabla de motivos, que analiza ese conjunto
 *   lámina 5  ambos       "VOLUMEN TOTAL" (donde además el marcador viene duplicado) y "CASOS SAC"
 *
 * Trabaja a nivel de párrafo y no de texto plano: PowerPoint parte una cadena en varios
 * `<a:r>` cuando la editaron a mano, así que `{{sac_total}}` puede estar repartido entre
 * varios `<a:t>` y un reemplazo directo sobre el XML no lo encontraría.
 *
 * Uso:  node scripts/retag-sac-template.mjs [entrada.pptx] [salida.pptx]
 */
import { readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";

const entrada = process.argv[2] ?? "plantilla-sac.pptx";
const salida = process.argv[3] ?? "plantilla-sac-v2.pptx";

/**
 * Cada lámina decide por el texto que rodea al marcador, no por su posición: en la lámina 5
 * los tres `{{sac_total}}` viven en párrafos distintos —"VOLUMEN TOTAL x", "x Mensajes y
 * comentarios", "x CASOS SAC"— y los dos primeros son el mismo número impreso dos veces.
 */
const REGLAS = {
  "slide2.xml": (texto) => texto.replace(/\{\{sac_total\}\}/g, "{{sac_volumen}}"),
  "slide4.xml": (texto) => texto.replace(/\{\{sac_total\}\}/g, "{{sac_volumen}}"),
  "slide5.xml": (texto) => {
    if (texto.includes("VOLUMEN TOTAL")) return texto.replace(/\{\{sac_total\}\}/g, "{{sac_volumen}}");
    if (texto.includes("CASOS SAC")) return texto.replace(/\{\{sac_total\}\}/g, "{{sac_casos}}");
    // El número ya lo imprime el párrafo de arriba; aquí solo sobra el marcador repetido.
    if (texto.includes("Mensajes y comentarios")) return texto.replace(/\{\{sac_total\}\}\s*/g, "");
    return texto;
  },
};

const textoDe = (parrafo) =>
  [...parrafo.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1] ?? "").join("");

const escapar = (valor) =>
  valor.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const desescapar = (valor) =>
  valor.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Deja el párrafo con un único `<a:t>` con el texto nuevo y vacía los demás. */
function reescribir(parrafo, texto) {
  let primero = true;
  return parrafo.replace(/<a:t>[\s\S]*?<\/a:t>/g, () => {
    if (primero) {
      primero = false;
      return `<a:t>${escapar(texto)}</a:t>`;
    }
    return "<a:t></a:t>";
  });
}

const zip = await JSZip.loadAsync(await readFile(entrada));
let cambios = 0;

for (const [archivo, reetiquetar] of Object.entries(REGLAS)) {
  const ruta = `ppt/slides/${archivo}`;
  const original = await zip.file(ruta).async("string");
  const actualizado = original.replace(/<a:p\b[\s\S]*?<\/a:p>/g, (parrafo) => {
    const texto = desescapar(textoDe(parrafo));
    if (!texto.includes("{{sac_total}}")) return parrafo;
    const nuevo = reetiquetar(texto);
    if (nuevo === texto) return parrafo;
    cambios += 1;
    console.log(`  ${archivo}  "${texto.trim().slice(0, 60)}"  →  "${nuevo.trim().slice(0, 60)}"`);
    return reescribir(parrafo, nuevo);
  });
  zip.file(ruta, actualizado);
}

await writeFile(salida, await zip.generateAsync({ type: "nodebuffer" }));
console.log(`\n${cambios} párrafos reetiquetados · ${salida}`);
