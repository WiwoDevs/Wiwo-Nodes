import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBrandWorkbookExport, googleSpreadsheetId, inspectBrandWorkbook } from "../../server/brand-workbook.js";
import type { Interaction } from "../../server/types.js";

async function workbookBytes(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.title = "Converse SAC";
  const history = workbook.addWorksheet("Histórico");
  history.addRow([
    "Fecha comentario",
    "Links",
    "Nombre Usuario/Cliente",
    "Reclamo/Mensaje",
    "Plataforma / RRSS",
    "Canal",
    "Clasificación Categoría \nComentario",
    "Tonalidad",
    "Estado",
  ]);
  history.addRow(["01/01/2026", "", "Cliente", "Mensaje existente", "Instagram", "DM", "Información", "Neutro", "Resuelto"]);
  workbook.addWorksheet("Criterios").addRow(["Plataforma / RRSS", "Canal", "Categoría", "Tonalidad", "Estado"]);
  workbook.addWorksheet("Dashboard SAC");
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function interaction(text: string, overrides: Partial<Interaction> = {}): Interaction {
  const now = "2026-08-17T12:00:00.000Z";
  return {
    id: `interaction-${text.length}`,
    externalId: `external-${text.length}`,
    brandId: "converse",
    accountId: "converse-account",
    channel: "instagram",
    type: "dm",
    direction: "inbound",
    customerName: "Cliente nuevo",
    customerHandle: "@cliente",
    text,
    category: "Información",
    sentiment: "neutral",
    confidence: 0.9,
    status: "new",
    source: "metricool",
    version: 1,
    createdAt: now,
    updatedAt: now,
    internalNotes: [],
    audit: [],
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("brand workbook", () => {
  it("accepts only canonical Google Sheets URLs", () => {
    expect(googleSpreadsheetId("https://docs.google.com/spreadsheets/d/1VNeZsqB2iRf6-YyGoneGWe3sZXAYJ9Amj73SBlCNHFc/edit"))
      .toBe("1VNeZsqB2iRf6-YyGoneGWe3sZXAYJ9Amj73SBlCNHFc");
    expect(() => googleSpreadsheetId("https://example.com/spreadsheets/d/not-safe/edit")).toThrow(/Solo se aceptan/);
  });

  it("learns the exact records contract without writing to Google", async () => {
    const bytes = await workbookBytes();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, {
      status: 200,
      headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    })));
    const config = await inspectBrandWorkbook(
      "https://docs.google.com/spreadsheets/d/1VNeZsqB2iRf6-YyGoneGWe3sZXAYJ9Amj73SBlCNHFc/edit",
      { userId: "admin" },
    );
    expect(config.recordsSheet).toBe("Histórico");
    expect(config.headers).toHaveLength(9);
    expect(config.mapping.text).toBe(3);
    expect(config.dataRows).toBe(1);
  });

  it("appends only missing interactions while preserving the nine-column contract", async () => {
    const bytes = await workbookBytes();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { status: 200 })));
    const config = await inspectBrandWorkbook(
      "https://docs.google.com/spreadsheets/d/1VNeZsqB2iRf6-YyGoneGWe3sZXAYJ9Amj73SBlCNHFc/edit",
      { userId: "admin" },
    );
    const result = await buildBrandWorkbookExport(config, [
      interaction("Mensaje existente", { createdAt: "2026-01-01T12:00:00.000Z", customerName: "Cliente" }),
      interaction("Mensaje nuevo"),
    ]);
    expect(result.appended).toBe(1);
    const exported = new ExcelJS.Workbook();
    await exported.xlsx.load(result.bytes as unknown as ExcelJS.Buffer);
    const sheet = exported.getWorksheet("Histórico");
    expect(sheet?.getRow(1).values).toHaveLength(10);
    expect(sheet?.getRow(3).getCell(4).value).toBe("Mensaje nuevo");
  });

  it("exports the safest available link without changing the workbook contract", async () => {
    const bytes = await workbookBytes();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { status: 200 })));
    const config = await inspectBrandWorkbook(
      "https://docs.google.com/spreadsheets/d/1VNeZsqB2iRf6-YyGoneGWe3sZXAYJ9Amj73SBlCNHFc/edit",
      { userId: "admin" },
    );
    const result = await buildBrandWorkbookExport(config, [
      interaction("=Mensaje con post", {
        metricoolRef: {
          post: { id: "post-1", url: "https://social.example/post/1" },
          contentContext: { kind: "attachment", mediaUrls: ["https://cdn.example/ignored.jpg"] },
        },
      }),
      interaction("Adjunto seguro", {
        metricoolRef: {
          contentContext: {
            kind: "attachment",
            mediaUrls: ["http://unsafe.example/file.jpg", "https://cdn.example/file.jpg"],
            permalink: "https://social.example/ignored",
          },
        },
      }),
      interaction("Permalink seguro", {
        metricoolRef: {
          contentContext: {
            kind: "story_reply",
            mediaUrls: ["javascript:alert(1)"],
            permalink: "https://social.example/story/1",
          },
        },
      }),
      interaction("URL insegura", {
        metricoolRef: {
          post: { id: "post-2", url: "http://unsafe.example/post/2" },
          contentContext: {
            kind: "attachment",
            mediaUrls: ["data:text/plain,unsafe"],
            permalink: "javascript:alert(1)",
          },
        },
      }),
    ]);

    const exported = new ExcelJS.Workbook();
    await exported.xlsx.load(result.bytes as unknown as ExcelJS.Buffer);
    const sheet = exported.getWorksheet("Histórico");
    expect(sheet?.getRow(1).values).toHaveLength(10);
    expect(sheet?.getRow(3).getCell(2).value).toBe("https://social.example/post/1");
    expect(sheet?.getRow(3).getCell(4).value).toBe("'=Mensaje con post");
    expect(sheet?.getRow(4).getCell(2).value).toBe("https://cdn.example/file.jpg");
    expect(sheet?.getRow(5).getCell(2).value).toBe("https://social.example/story/1");
    expect(sheet?.getRow(6).getCell(2).value).toBe("");
  });
});
