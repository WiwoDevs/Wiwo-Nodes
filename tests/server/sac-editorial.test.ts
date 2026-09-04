import { describe, expect, it, vi } from "vitest";
import {
  ajustar,
  draftSacEditorial,
  editorialPlaceholders,
  EditorialError,
  LIMITES,
  type EditorialContext,
} from "../../server/sac-editorial.js";
import type { SacReportFigures } from "../../server/sac-report.js";

function figures(overrides: Partial<SacReportFigures> = {}): SacReportFigures {
  return {
    brandKey: "vans-colombia",
    brandLabel: "Vans Colombia",
    period: "Agosto 2026",
    volumenBruto: 271,
    casosSac: 93,
    derivados: 44,
    respondidos: 29,
    coberturaPct: 31.2,
    canales: { ig_privado: 18, ig_publico: 21, fb_privado: 39, fb_publico: 15, tt_privado: 0, tt_publico: 0 },
    privados: 57,
    publicos: 36,
    motivos: [{ motivo: "Reclamos", casos: 30, pct: 32.3 }],
    tono: { positivo: 4, neutro: 50, negativo: 39 },
    advertencias: [],
    ...overrides,
  };
}

function context(overrides: Partial<EditorialContext> = {}): EditorialContext {
  return {
    figures: figures(),
    superficies: [
      { superficie: "Facebook privado", casos: 39, respondidos: 11, pct: 28.2 },
      { superficie: "Instagram comentarios", casos: 21, respondidos: 3, pct: 14.3 },
    ],
    ejemplos: [
      { motivo: "reclamo", tono: "negative", superficie: "Facebook comentarios", respondido: false, texto: "mi pedido no llega" },
    ],
    fueraDePlantilla: [],
    redesConectadas: ["Instagram", "Facebook"],
    ...overrides,
  };
}

/** Doble del cliente de Anthropic: devuelve lo que se le indique sin salir a la red. */
function clienteFalso(parsed: unknown) {
  return { parse: vi.fn().mockResolvedValue({ parsed_output: parsed }) };
}

const respuestaValida = {
  lectura: "La cobertura de 31,2% no es un problema de capacidad.",
  next1: { titulo: "Cubrir comentarios de Facebook", detalle: "Turno diario sobre las publicaciones con reclamos." },
  next2: { titulo: "Reducir derivaciones", detalle: "Guion de primera respuesta para seguimiento de pedidos." },
};

describe("ajustar", () => {
  it("deja intacto un texto dentro del límite", () => {
    expect(ajustar("Cobertura pareja en todos los canales.", 100))
      .toBe("Cobertura pareja en todos los canales.");
  });

  it("colapsa espacios y saltos de línea", () => {
    expect(ajustar("  dos   palabras\n  más ", 100)).toBe("dos palabras más");
  });

  it("corta en el último espacio y marca la elisión", () => {
    const recortado = ajustar("palabra ".repeat(20), 30);
    expect(recortado.length).toBeLessThanOrEqual(31);
    expect(recortado.endsWith("…")).toBe(true);
    expect(recortado).not.toContain("palabr…");
  });

  it("corta a la fuerza cuando no hay espacio útil donde partir", () => {
    expect(ajustar("a".repeat(50), 10)).toBe(`${"a".repeat(10)}…`);
  });

  it("no deja un signo de puntuación colgando antes de la elisión", () => {
    expect(ajustar("uno dos tres, cuatro cinco seis", 13)).toBe("uno dos tres…");
  });
});

describe("draftSacEditorial", () => {
  it("devuelve los cinco campos redactados", async () => {
    const editorial = await draftSacEditorial(context(), { client: clienteFalso(respuestaValida) });
    expect(editorial.lectura).toBe(respuestaValida.lectura);
    expect(editorial.next1.titulo).toBe("Cubrir comentarios de Facebook");
    expect(editorial.next2.detalle).toContain("seguimiento de pedidos");
  });

  it("recorta cada campo al largo que tolera la plantilla", async () => {
    const editorial = await draftSacEditorial(context(), {
      client: clienteFalso({
        lectura: "frase larga ".repeat(80),
        next1: { titulo: "titulo larguísimo ".repeat(10), detalle: "detalle extenso ".repeat(40) },
        next2: { titulo: "otro título muy largo ".repeat(10), detalle: "más detalle ".repeat(40) },
      }),
    });
    expect(editorial.lectura.length).toBeLessThanOrEqual(LIMITES.lectura + 1);
    expect(editorial.next1.titulo.length).toBeLessThanOrEqual(LIMITES.titulo + 1);
    expect(editorial.next2.detalle.length).toBeLessThanOrEqual(LIMITES.detalle + 1);
  });

  it("entrega al modelo el corte por superficie y los canales sin gráfico", async () => {
    const client = clienteFalso(respuestaValida);
    await draftSacEditorial(
      context({ fueraDePlantilla: [{ canal: "LinkedIn comentarios", casos: 10 }] }),
      { client },
    );
    const enviado = client.parse.mock.calls[0][0].messages[0].content as string;
    expect(enviado).toContain("Instagram comentarios");
    expect(enviado).toContain("LinkedIn comentarios");
    expect(enviado).toContain("Vans Colombia");
  });

  it("entrega las redes conectadas, para no proponer trabajo en cuentas inexistentes", async () => {
    const client = clienteFalso(respuestaValida);
    await draftSacEditorial(context({ redesConectadas: ["TikTok"] }), { client });
    const enviado = client.parse.mock.calls[0][0].messages[0].content as string;
    expect(enviado).toContain("\"redes_conectadas\"");
    expect(enviado).toContain("TikTok");
  });

  it("le informa al modelo el largo que tolera cada cuadro", async () => {
    const client = clienteFalso(respuestaValida);
    await draftSacEditorial(context(), { client });
    const enviado = client.parse.mock.calls[0][0].messages[0].content as string;
    expect(enviado).toContain("largos_maximos");
    expect(enviado).toContain(String(LIMITES.lectura));
  });

  it("oculta la variación cuando el período anterior no es comparable", async () => {
    const client = clienteFalso(respuestaValida);
    await draftSacEditorial(
      context({
        figures: figures({
          variacion: { anterior: 12, deltaPct: 675, comparable: false },
          advertencias: ["El período anterior tiene muy pocos mensajes privados. La variación no es comparable."],
        }),
      }),
      { client },
    );
    const enviado = client.parse.mock.calls[0][0].messages[0].content as string;
    expect(enviado).toContain("no comparable, no mencionar");
    expect(enviado).not.toContain("675");
  });

  it("conserva la variación cuando sí es comparable", async () => {
    const client = clienteFalso(respuestaValida);
    await draftSacEditorial(
      context({ figures: figures({ variacion: { anterior: 80, deltaPct: 16.3, comparable: true } }) }),
      { client },
    );
    const enviado = client.parse.mock.calls[0][0].messages[0].content as string;
    expect(enviado).toContain("16.3");
  });

  it("cachea el encargo, que no cambia entre marcas", async () => {
    const client = clienteFalso(respuestaValida);
    await draftSacEditorial(context(), { client });
    expect(client.parse.mock.calls[0][0].system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  it("falla con un mensaje claro cuando la respuesta no calza con el esquema", async () => {
    await expect(draftSacEditorial(context(), { client: clienteFalso(null) }))
      .rejects.toThrow(EditorialError);
  });

  it("exige credencial antes de intentar la llamada", async () => {
    const previa = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(draftSacEditorial(context())).rejects.toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (previa !== undefined) process.env.ANTHROPIC_API_KEY = previa;
    }
  });
});

describe("editorialPlaceholders", () => {
  it("mapea los cinco marcadores que espera la plantilla", () => {
    const valores = editorialPlaceholders({
      lectura: "Una lectura.",
      next1: { titulo: "Primero", detalle: "Detalle uno." },
      next2: { titulo: "Segundo", detalle: "Detalle dos." },
    });
    expect(Object.keys(valores).sort()).toEqual([
      "sac_lectura",
      "sac_next1_detalle",
      "sac_next1_titulo",
      "sac_next2_detalle",
      "sac_next2_titulo",
    ]);
    expect(valores.sac_next2_titulo).toBe("Segundo");
  });
});
