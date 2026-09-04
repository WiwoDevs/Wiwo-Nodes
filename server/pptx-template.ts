/**
 * Relleno de una plantilla `.pptx` reemplazando marcadores `{{nombre}}`.
 *
 * Un `.pptx` es un zip de XML, así que no hace falta la API de Google ni credenciales para
 * producir el archivo final: se reemplaza el texto y se vuelve a comprimir.
 *
 * La dificultad real es que PowerPoint y Google Slides parten el texto en varios `<a:r>`
 * (runs) cuando cambia el formato, la corrección ortográfica o simplemente al editar. Un
 * marcador como `{{sac_total}}` puede quedar repartido en tres runs, y un reemplazo ingenuo
 * sobre el XML crudo no lo encontraría. Por eso se trabaja a nivel de párrafo: se junta el
 * texto de todos sus runs, se reemplaza sobre el texto completo y se devuelve al primer run.
 */
import JSZip from "jszip";

/** Marcadores presentes en la plantilla, para saber qué pide antes de intentar llenarla. */
export async function readTemplatePlaceholders(template: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(template);
  const encontrados = new Set<string>();
  for (const nombre of Object.keys(zip.files)) {
    if (!/^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(nombre)) continue;
    const xml = await zip.files[nombre]!.async("string");
    for (const parrafo of parrafosDe(xml)) {
      for (const match of textoDe(parrafo).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
        encontrados.add(match[1]!);
      }
    }
  }
  return [...encontrados].sort();
}

function parrafosDe(xml: string): string[] {
  return xml.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? [];
}

function textoDe(parrafo: string): string {
  return [...parrafo.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1] ?? "").join("");
}

function escapar(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function desescapar(valor: string): string {
  return valor
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * Reemplaza en un párrafo. El texto resultante queda en el primer run y los demás se vacían:
 * así se conserva el formato del primero, que es el que el diseñador aplicó al marcador.
 *
 * Los saltos de línea se traducen a `<a:br/>`, porque un `\n` dentro de `<a:t>` no produce
 * un salto visible en PowerPoint.
 */
function reemplazarParrafo(parrafo: string, valores: Record<string, string>): string {
  const original = textoDe(parrafo);
  if (!original.includes("{{")) return parrafo;

  const reemplazado = desescapar(original).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (completo, clave: string) =>
    Object.prototype.hasOwnProperty.call(valores, clave) ? valores[clave]! : completo);
  if (reemplazado === desescapar(original)) return parrafo;

  const partes = reemplazado.split("\n");
  const nuevoTexto = partes.map(escapar).join("</a:t><a:br/><a:t>");

  let primero = true;
  return parrafo.replace(/<a:t>[\s\S]*?<\/a:t>/g, () => {
    if (primero) {
      primero = false;
      return `<a:t>${nuevoTexto}</a:t>`;
    }
    return "<a:t></a:t>";
  });
}

export interface FillResult {
  /** El archivo resultante. */
  buffer: Buffer;
  /** Marcadores de la plantilla que nadie llenó: quedan visibles en el archivo. */
  sinValor: string[];
  /** Valores entregados que la plantilla no usa: suelen indicar un nombre mal escrito. */
  noUsados: string[];
}

/** Rellena la plantilla y reporta qué quedó sin resolver, en vez de fallar en silencio. */
export async function fillPptxTemplate(
  template: Buffer,
  valores: Record<string, string>,
): Promise<FillResult> {
  const zip = await JSZip.loadAsync(template);
  const usados = new Set<string>();
  const sinValor = new Set<string>();

  for (const nombre of Object.keys(zip.files)) {
    if (!/^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(nombre)) continue;
    const xml = await zip.files[nombre]!.async("string");

    let salida = xml;
    for (const parrafo of parrafosDe(xml)) {
      const texto = desescapar(textoDe(parrafo));
      if (!texto.includes("{{")) continue;
      for (const match of texto.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
        const clave = match[1]!;
        if (Object.prototype.hasOwnProperty.call(valores, clave)) usados.add(clave);
        else sinValor.add(clave);
      }
      const nuevo = reemplazarParrafo(parrafo, valores);
      if (nuevo !== parrafo) salida = salida.replace(parrafo, nuevo);
    }

    if (salida !== xml) zip.file(nombre, salida);
  }

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return {
    buffer,
    sinValor: [...sinValor].sort(),
    noUsados: Object.keys(valores).filter((clave) => !usados.has(clave)).sort(),
  };
}
