import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { fillPptxTemplate, readTemplatePlaceholders } from "../../server/pptx-template.js";

/** Construye un .pptx mínimo con los párrafos dados, tal como los escribe PowerPoint. */
async function plantilla(...parrafos: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file(
    "ppt/slides/slide1.xml",
    `<?xml version="1.0"?><p:sld><p:cSld><p:spTree>${parrafos.join("")}</p:spTree></p:cSld></p:sld>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

/** Un párrafo con el texto repartido en tantos runs como se le pasen. */
function parrafo(...runs: string[]): string {
  const cuerpo = runs.map((t) => `<a:r><a:rPr lang="es"/><a:t>${t}</a:t></a:r>`).join("");
  return `<a:p>${cuerpo}</a:p>`;
}

async function textoDeSalida(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]).join("|");
}

describe("readTemplatePlaceholders", () => {
  it("encuentra los marcadores de la plantilla", async () => {
    const buffer = await plantilla(parrafo("{{CLIENTE}}"), parrafo("Total: ", "{{sac_total}}"));
    expect(await readTemplatePlaceholders(buffer)).toEqual(["CLIENTE", "sac_total"]);
  });
});

describe("fillPptxTemplate", () => {
  it("reemplaza un marcador contenido en un solo run", async () => {
    const buffer = await plantilla(parrafo("{{CLIENTE}}"));
    const { buffer: salida } = await fillPptxTemplate(buffer, { CLIENTE: "COLBÚN" });
    expect(await textoDeSalida(salida)).toBe("COLBÚN");
  });

  it("reemplaza un marcador partido entre varios runs", async () => {
    // PowerPoint parte el texto al editar: "{{sac" + "_total" + "}}" es el caso real que
    // rompe cualquier reemplazo hecho sobre el XML crudo.
    const buffer = await plantilla(parrafo("{{sac", "_total", "}}"));
    const { buffer: salida } = await fillPptxTemplate(buffer, { sac_total: "540" });
    expect(await textoDeSalida(salida)).toBe("540||");
  });

  it("conserva el texto que rodea al marcador", async () => {
    const buffer = await plantilla(parrafo("Distribución por Canal (", "{{sac_total}}", ")"));
    const { buffer: salida } = await fillPptxTemplate(buffer, { sac_total: "540" });
    expect((await textoDeSalida(salida)).split("|")[0]).toBe("Distribución por Canal (540)");
  });

  it("reemplaza el mismo marcador en todas sus apariciones", async () => {
    const buffer = await plantilla(parrafo("{{sac_total}}"), parrafo("y de nuevo {{sac_total}}"));
    const { buffer: salida } = await fillPptxTemplate(buffer, { sac_total: "540" });
    const texto = await textoDeSalida(salida);
    expect(texto).toContain("540");
    expect(texto).not.toContain("{{");
  });

  it("reporta los marcadores que quedaron sin valor en vez de fallar en silencio", async () => {
    const buffer = await plantilla(parrafo("{{CLIENTE}}"), parrafo("{{sac_desconocido}}"));
    const { sinValor } = await fillPptxTemplate(buffer, { CLIENTE: "COLBÚN" });
    expect(sinValor).toEqual(["sac_desconocido"]);
  });

  it("reporta los valores que la plantilla no usa", async () => {
    const buffer = await plantilla(parrafo("{{CLIENTE}}"));
    const { noUsados } = await fillPptxTemplate(buffer, { CLIENTE: "X", sac_total: "5" });
    expect(noUsados).toEqual(["sac_total"]);
  });

  it("deja intacto el marcador sin valor, para que se vea en la revisión", async () => {
    const buffer = await plantilla(parrafo("{{sac_pendiente}}"));
    const { buffer: salida } = await fillPptxTemplate(buffer, {});
    expect(await textoDeSalida(salida)).toBe("{{sac_pendiente}}");
  });

  it("escapa los caracteres que romperían el XML", async () => {
    const buffer = await plantilla(parrafo("{{CLIENTE}}"));
    const { buffer: salida } = await fillPptxTemplate(buffer, { CLIENTE: "Ripley & <Co>" });
    const zip = await JSZip.loadAsync(salida);
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toContain("Ripley &amp; &lt;Co&gt;");
  });

  it("convierte los saltos de línea en saltos reales de PowerPoint", async () => {
    const buffer = await plantilla(parrafo("{{sac_motivos_labels}}"));
    const { buffer: salida } = await fillPptxTemplate(buffer, { sac_motivos_labels: "Reclamos\nStock" });
    const zip = await JSZip.loadAsync(salida);
    const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toContain("<a:br/>");
  });

  it("no toca los párrafos sin marcadores", async () => {
    const buffer = await plantilla(parrafo("Texto fijo del diseño"));
    const { buffer: salida } = await fillPptxTemplate(buffer, { CLIENTE: "X" });
    expect(await textoDeSalida(salida)).toBe("Texto fijo del diseño");
  });

  it("devuelve un archivo que sigue siendo un pptx válido", async () => {
    const buffer = await plantilla(parrafo("{{CLIENTE}}"));
    const { buffer: salida } = await fillPptxTemplate(buffer, { CLIENTE: "COLBÚN" });
    const zip = await JSZip.loadAsync(salida);
    expect(Object.keys(zip.files)).toContain("[Content_Types].xml");
    expect(Object.keys(zip.files)).toContain("ppt/slides/slide1.xml");
  });
});
