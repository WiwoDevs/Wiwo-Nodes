import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBrandQaTemplate, inspectBrandQaWorkbook } from "../../server/brand-qa-workbook.js";

async function qaWorkbookBytes(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.title = "QA Converse";
  const sheet = workbook.addWorksheet("QA");
  sheet.addRow([
    "ID",
    "Pregunta/Intención",
    "Intención normalizada",
    "Respuesta aprobada",
    "Categoría",
    "Canal",
    "Estado",
    "Vigencia desde",
    "Vigencia hasta",
    "Fuente",
    "Aprobado por",
  ]);
  sheet.addRow(["qa-ubicacion", "¿Dónde hay tiendas?", "ubicacion", "Revisa nuestras tiendas en {brand}.", "Tiendas", "Todos", "Aprobada", "2026-08-01", "2027-08-01", "Manual SAC", "Marca"]);
  sheet.addRow(["qa-stock", "¿Hay stock?", "stock", "Revisa el stock en línea.", "Stock", "Todos", "Pendiente", "2026-08-01", "", "Manual SAC", "Marca"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

afterEach(() => vi.unstubAllGlobals());

describe("brand QA workbook", () => {
  it("imports only approved answers from the strict QA contract", async () => {
    const bytes = await qaWorkbookBytes();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { status: 200 })));
    const result = await inspectBrandQaWorkbook(
      "https://docs.google.com/spreadsheets/d/1VNeZsqB2iRf6-YyGoneGWe3sZXAYJ9Amj73SBlCNHFc/edit",
      { userId: "admin" },
    );
    expect(result.config).toMatchObject({ sheetName: "QA", dataRows: 2, approvedRows: 1 });
    expect(result.approvedAnswers).toEqual([
      expect.objectContaining({ id: "qa-ubicacion", intent: "ubicacion", sourceLabel: "Manual SAC" }),
    ]);
  });

  it("creates an empty professional QA template without fictitious answers", async () => {
    const bytes = await buildBrandQaTemplate("Converse");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["QA", "Instrucciones"]);
    const qa = workbook.getWorksheet("QA");
    expect(qa?.actualRowCount).toBe(1);
    expect(qa?.getRow(1).getCell(4).value).toBe("Respuesta aprobada");
    expect(qa?.getCell("G2").dataValidation.type).toBe("list");
  });
});
