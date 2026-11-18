import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildManualRecords,
  buildManualRecordsTemplate,
  diaDeCelda,
  MANUAL_RECORDS_HEADERS,
  readManualRecordsWorkbook,
} from "../../server/manual-records.js";
import { createDemoStore } from "../../server/seed.js";
import type { Interaction } from "../../server/types.js";

const now = new Date("2026-11-18T15:00:00.000Z");
const actor = { userId: "user-1", displayName: "Supervisora" };

async function workbookWith(rows: ExcelJS.CellValue[][], sheetName = "Histórico"): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Dashboard SAC").addRow(["Resumen"]);
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(MANUAL_RECORDS_HEADERS);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("carga manual del Excel BD SAC", () => {
  it("lee fechas de Excel, números de serie y texto latino", () => {
    expect(diaDeCelda(new Date(Date.UTC(2026, 9, 14)))).toBe("2026-10-14");
    expect(diaDeCelda("14/10/2026")).toBe("2026-10-14");
    expect(diaDeCelda("4-1-26")).toBe("2026-01-04");
    expect(diaDeCelda("2026-10-14")).toBe("2026-10-14");
    expect(diaDeCelda(46309)).toBe("2026-10-14");
    expect(diaDeCelda("31/02/2026")).toBeUndefined();
    expect(diaDeCelda("ayer")).toBeUndefined();
    expect(diaDeCelda(null)).toBeUndefined();
  });

  it("convierte cada fila de TikTok y LinkedIn en un caso y explica lo que omite", async () => {
    const store = createDemoStore(now);
    const brand = store.brands[0]!;
    const bytes = await workbookWith([
      ["14/10/2026", "Ana Pérez", "¿Tienen envíos a regiones? Necesito saber el costo", "TikTok", "Comentario", "Despachos", "Neutra", "Resuelto"],
      [new Date(Date.UTC(2026, 9, 15)), "Luis Soto", "Excelente iniciativa de la marca", "LinkedIn", "DM", "", "Positiva", "Pendiente"],
      ["16/10/2026", "Mara", "Hola, consulta por stock", "Instagram", "Comentario", "", "Neutra", "Resuelto"],
      ["", "Sin fecha", "texto sin fecha", "TikTok", "", "", "", ""],
      ["17/10/2026", "Pedro", "No me llegó el pedido", "", "DM", "Reclamos", "Negativa", "Derivado"],
      ["14/10/2026", "Ana Pérez", "¿Tienen envíos a regiones? Necesito saber el costo", "TikTok", "Comentario", "Despachos", "Neutra", "Resuelto"],
    ]);

    const leido = await readManualRecordsWorkbook(bytes);
    expect(leido.hoja).toBe("Histórico");
    const result = buildManualRecords({
      brand, hoja: leido.hoja, filas: leido.filas, existentes: [], archivo: "bd.xlsx", actor, ahora: now,
    });

    expect(result).toMatchObject({
      leidas: 6,
      otraRed: 1,
      invalidas: 2,
      repetidasEnArchivo: 1,
      porRed: { tiktok: 1, linkedin: 1 },
      porTipo: { comment: 1, dm: 1 },
      desde: "2026-10-14",
      hasta: "2026-10-15",
    });
    expect(result.problemas.map((problem) => problem.fila)).toEqual([5, 6]);
    const [tiktok, linkedin] = result.nuevas;
    expect(tiktok).toMatchObject({
      channel: "tiktok",
      type: "comment",
      source: "planilla",
      status: "replied",
      category: "despacho",
      createdAt: "2026-10-14T12:00:00.000Z",
      sacTriage: { esCasoSac: true, modelo: "manual", marcadoPor: "Supervisora", categoria: "despacho" },
    });
    expect(tiktok!.externalId).toMatch(new RegExp(`^planilla:tiktok:${brand.id}:[0-9a-f]{24}$`));
    expect(linkedin).toMatchObject({ channel: "linkedin", type: "dm", status: "pending", sentiment: "positive" });

    // Con la red elegida al cargar, la fila sin plataforma también entra.
    const conRed = buildManualRecords({
      brand, hoja: leido.hoja, filas: leido.filas, existentes: [], archivo: "bd.xlsx", actor, ahora: now, redPorDefecto: "tiktok",
    });
    expect(conRed.nuevas).toHaveLength(3);
    expect(conRed.nuevas[2]).toMatchObject({ status: "escalated", category: "reclamo", sentiment: "negative", sacTriage: { requiereDerivacion: true } });
  });

  it("no repite lo ya cargado ni lo que Metricool ya trajo para esa red", async () => {
    const store = createDemoStore(now);
    const brand = store.brands[0]!;
    const bytes = await workbookWith([
      ["14/10/2026", "Ana Pérez", "¿Tienen envíos a regiones? Necesito saber el costo", "TikTok", "Comentario", "", "Neutra", "Resuelto"],
      ["15/10/2026", "Luis", "¿Cómo postulo para ser embajador de la marca?", "TikTok", "Comentario", "", "Neutra", "Resuelto"],
      ["15/10/2026", "Luis", "¿Cómo postulo para ser embajador de la marca?", "LinkedIn", "Comentario", "", "Neutra", "Resuelto"],
    ]);
    const leido = await readManualRecordsWorkbook(bytes);
    const primera = buildManualRecords({ brand, hoja: leido.hoja, filas: leido.filas, existentes: [], archivo: "bd.xlsx", actor, ahora: now });
    const deMetricool: Interaction = {
      ...primera.nuevas[1]!,
      id: "metricool-1",
      externalId: "tiktok-comment-1",
      source: "metricool",
      createdAt: "2026-10-13T20:00:00.000Z",
      sacTriage: undefined,
    };

    const segunda = buildManualRecords({
      brand, hoja: leido.hoja, filas: leido.filas, existentes: [primera.nuevas[0]!, deMetricool], archivo: "bd.xlsx", actor, ahora: now,
    });

    expect(segunda.yaCargadas).toBe(1);
    // Mismo texto distintivo en TikTok dos días antes: lo trajo Metricool.
    expect(segunda.yaEnNodes).toBe(1);
    // En LinkedIn no estaba: entra.
    expect(segunda.nuevas.map((item) => item.channel)).toEqual(["linkedin"]);
  });

  it("rechaza un archivo sin las columnas de la planilla", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Hoja 1").addRow(["Nombre", "Monto"]);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(readManualRecordsWorkbook(bytes)).rejects.toThrow(/Fecha comentario/);
    await expect(readManualRecordsWorkbook(Buffer.from("no es excel"))).rejects.toThrow(/\.xlsx/);
  });

  it("entrega una plantilla que se vuelve a leer sin filas", async () => {
    const leido = await readManualRecordsWorkbook(await buildManualRecordsTemplate());
    expect(leido).toEqual({ hoja: "Histórico", filas: [] });
  });
});
