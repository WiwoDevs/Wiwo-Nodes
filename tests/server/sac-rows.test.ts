import { describe, expect, it } from "vitest";
import { buildSacRows } from "../../server/sac-rows.js";
import type { Brand, Interaction } from "../../server/types.js";

const brand = {
  id: "colbun",
  name: "COLBÚN",
  active: true,
  account: { id: "colbun-account", handle: "@energiacolbun", name: "COLBÚN", active: true },
} as Brand;

function caso(overrides: Partial<Interaction>): Interaction {
  return {
    id: crypto.randomUUID(),
    brandId: "colbun",
    accountId: "colbun-account",
    direction: "inbound",
    channel: "instagram",
    type: "dm",
    status: "pending",
    sentiment: "negative",
    category: "reclamo",
    customerName: "Ana Cliente",
    customerHandle: "@ana",
    text: "No me llegó el pedido",
    createdAt: "2026-08-15T14:30:00.000Z",
    internalNotes: [],
    ...overrides,
  } as Interaction;
}

describe("buildSacRows", () => {
  it("proyecta una interacción al formato de planilla SAC", () => {
    const { rows } = buildSacRows(brand, [caso({})]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      brandKey: "colbun",
      brandLabel: "COLBÚN",
      fechaComentario: "2026-08-15",
      plataforma: "Instagram",
      canal: "@energiacolbun",
      usuario: "Ana Cliente (@ana)",
      reclamo: "No me llegó el pedido",
      categoria: "reclamo",
      tonalidad: "Negativa",
      estado: "Pendiente",
      mes: "Agosto",
    });
  });

  it("descarta los mensajes salientes: una fila SAC es lo que dijo el cliente", () => {
    const { rows } = buildSacRows(brand, [caso({ direction: "outbound" })]);
    expect(rows).toHaveLength(0);
  });

  it("ignora interacciones de otra marca", () => {
    const { rows } = buildSacRows(brand, [caso({ brandId: "otra" })]);
    expect(rows).toHaveLength(0);
  });

  it("recorta por período usando días completos", () => {
    const casos = [
      caso({ createdAt: "2026-07-31T23:00:00.000Z" }),
      caso({ createdAt: "2026-08-01T00:30:00.000Z" }),
      caso({ createdAt: "2026-08-31T23:30:00.000Z" }),
      caso({ createdAt: "2026-09-01T01:00:00.000Z" }),
    ];
    const { rows } = buildSacRows(brand, casos, { from: "2026-08-01", to: "2026-08-31" });
    expect(rows.map((row) => row.fechaComentario)).toEqual(["2026-08-31", "2026-08-01"]);
  });

  it("cuenta los descartes por fecha inutilizable en vez de inventar una", () => {
    const { rows, droppedNoDate } = buildSacRows(brand, [caso({ createdAt: "sin fecha" })]);
    expect(rows).toHaveLength(0);
    expect(droppedNoDate).toBe(1);
  });

  it("ordena de más reciente a más antiguo", () => {
    const { rows } = buildSacRows(brand, [
      caso({ createdAt: "2026-08-01T10:00:00.000Z" }),
      caso({ createdAt: "2026-08-20T10:00:00.000Z" }),
      caso({ createdAt: "2026-08-10T10:00:00.000Z" }),
    ]);
    expect(rows.map((row) => row.fechaComentario)).toEqual(["2026-08-20", "2026-08-10", "2026-08-01"]);
  });

  it("traduce cada canal y sentimiento a la etiqueta de la planilla", () => {
    const { rows } = buildSacRows(brand, [
      caso({ channel: "facebook", sentiment: "positive", status: "replied" }),
      caso({ channel: "tiktok", sentiment: "neutral", status: "escalated" }),
    ]);
    expect(rows.map((row) => [row.plataforma, row.tonalidad, row.estado])).toEqual(
      expect.arrayContaining([
        ["Facebook", "Positiva", "Respondido"],
        ["TikTok", "Neutra", "Escalado"],
      ]),
    );
  });

  it("resume el contexto interno sin copiar el texto de las notas", () => {
    const { rows } = buildSacRows(brand, [caso({
      type: "comment",
      respondedAt: "2026-08-16T09:00:00.000Z",
      internalNotes: [{ id: "n1", text: "dato sensible del cliente", authorId: "u1", at: "2026-08-15T15:00:00.000Z" }],
    } as Partial<Interaction>)]);
    const observacion = rows[0]!.observacion;
    expect(observacion).toContain("Comentario en publicación");
    expect(observacion).toContain("1 nota interna");
    expect(observacion).toContain("Respondido el 2026-08-16");
    expect(observacion).not.toContain("dato sensible");
  });

  it("no duplica el nombre cuando el handle coincide", () => {
    const { rows } = buildSacRows(brand, [caso({ customerName: "ana", customerHandle: "@ana" })]);
    expect(rows[0]!.usuario).toBe("ana");
  });
});
