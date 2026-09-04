import { describe, expect, it } from "vitest";
import {
  buildSacReport,
  esIlegible,
  esMensajeGestionado,
  MAX_ETIQUETA_MOTIVO,
  MAX_FILAS_MOTIVOS,
  reportPlaceholders,
} from "../../server/sac-report.js";
import { SAC_CATEGORIES } from "../../server/ai-classifier.js";
import type { Brand, Interaction } from "../../server/types.js";

const brand = {
  id: "colbun",
  name: "COLBÚN",
  active: true,
  account: { id: "colbun-account", handle: "@energiacolbun", name: "COLBÚN", active: true },
} as Brand;

const AGOSTO = { from: "2026-08-01", to: "2026-08-31", label: "Agosto 2026" };

function caso(overrides: Partial<Interaction> & { triage?: Partial<NonNullable<Interaction["sacTriage"]>> }): Interaction {
  const { triage, ...resto } = overrides;
  return {
    id: crypto.randomUUID(),
    brandId: "colbun",
    accountId: "colbun-account",
    direction: "inbound",
    channel: "instagram",
    type: "dm",
    status: "pending",
    sentiment: "neutral",
    category: "consulta_general",
    text: "hola",
    createdAt: "2026-08-15T12:00:00.000Z",
    internalNotes: [],
    sacTriage: {
      categoria: "consulta_general",
      esCasoSac: true,
      requiereDerivacion: false,
      confianza: 0.9,
      clasificadoEn: "2026-08-28T00:00:00.000Z",
      modelo: "claude-opus-5",
      ...triage,
    },
    ...resto,
  } as Interaction;
}

function conContenido(kind: string, text: string, extra: Partial<Interaction> = {}): Interaction {
  return caso({
    text,
    triage: { esCasoSac: false, categoria: "no_aplica" },
    metricoolRef: { provider: "INSTAGRAM", conversationId: "c1", recipient: "r1", contentContext: { kind } },
    ...extra,
  } as never);
}

describe("esMensajeGestionado", () => {
  it("cuenta un mensaje con contenido real", () => {
    expect(esMensajeGestionado(conContenido("text", "hola, no me llegó el pedido todavía"))).toBe(true);
  });

  it("descarta lo que Instagram deja en la bandeja sin ser un mensaje", () => {
    expect(esMensajeGestionado(conContenido("story_mention", "Mención en una historia"))).toBe(false);
    expect(esMensajeGestionado(conContenido("story_reply", "Respuesta a una historia"))).toBe(false);
    expect(esMensajeGestionado(conContenido("reaction", "❤️"))).toBe(false);
  });

  it("descarta los aplausos y las reacciones de una palabra", () => {
    expect(esMensajeGestionado(conContenido("text", "👏👏👏"))).toBe(false);
    expect(esMensajeGestionado(conContenido("text", "Tremendaaaaa 🔥"))).toBe(false);
  });

  it("cuenta un caso corto, porque el clasificador ya leyó el hilo", () => {
    expect(esMensajeGestionado(caso({ text: "no llegó" }))).toBe(true);
  });

  it("cuenta un archivo adjunto: la foto del producto fallado es el mensaje", () => {
    expect(esMensajeGestionado(conContenido("attachment", "Archivo adjunto"))).toBe(true);
  });

  it("no cuenta lo que no se puede leer, ni siquiera para descartarlo", () => {
    expect(esMensajeGestionado(conContenido("unsupported", "Contenido no disponible desde Metricool"))).toBe(false);
    expect(esIlegible(conContenido("unavailable", "Contenido no disponible"))).toBe(true);
  });
});

describe("buildSacReport", () => {
  it("separa el volumen gestionado de los casos y advierte lo ilegible", () => {
    const cifras = buildSacReport(brand, [
      caso({ text: "quiero saber si tienen despacho a regiones" }),
      caso({ text: "no me llegó el pedido", triage: { categoria: "reclamo" } }),
      conContenido("text", "muchas felicitaciones por el reconocimiento al equipo"),
      conContenido("text", "👏👏"),
      conContenido("story_mention", "Mención en una historia"),
      conContenido("unsupported", "Contenido no disponible desde Metricool"),
    ], AGOSTO);
    expect(cifras.volumenBruto).toBe(6);
    expect(cifras.mensajesGestionados).toBe(3);
    expect(cifras.casosSac).toBe(2);
    expect(cifras.ilegibles).toBe(1);
    expect(cifras.advertencias.some((a) => a.includes("sin contenido legible"))).toBe(true);
  });

  it("distribuye por canal sobre el volumen, para que las barras sumen su encabezado", () => {
    const cifras = buildSacReport(brand, [
      caso({ text: "consulta sobre el despacho a regiones" }),
      conContenido("text", "felicitaciones por la campaña de este mes", { channel: "instagram", type: "comment" } as never),
      conContenido("text", "👏", { channel: "instagram", type: "comment" } as never),
    ], AGOSTO);
    const suma = Object.values(cifras.canales).reduce((total, n) => total + n, 0);
    expect(suma).toBe(cifras.mensajesGestionados);
    expect(cifras.privados + cifras.publicos).toBe(cifras.mensajesGestionados);
  });

  it("cuenta casos SAC, no mensajes recibidos", () => {
    const cifras = buildSacReport(brand, [
      caso({}),
      caso({}),
      caso({ triage: { esCasoSac: false } }),
      caso({ triage: { esCasoSac: false } }),
      caso({ triage: { esCasoSac: false } }),
    ], AGOSTO);
    expect(cifras.volumenBruto).toBe(5);
    expect(cifras.casosSac).toBe(2);
  });

  it("excluye lo que cae fuera del período", () => {
    const cifras = buildSacReport(brand, [
      caso({ createdAt: "2026-07-31T23:00:00.000Z" }),
      caso({ createdAt: "2026-08-01T02:00:00.000Z" }),
      caso({ createdAt: "2026-09-01T00:30:00.000Z" }),
    ], AGOSTO);
    expect(cifras.casosSac).toBe(1);
  });

  it("ignora los mensajes salientes", () => {
    const cifras = buildSacReport(brand, [caso({ direction: "outbound" })], AGOSTO);
    expect(cifras.casosSac).toBe(0);
  });

  it("separa privados de públicos por canal", () => {
    const cifras = buildSacReport(brand, [
      caso({ channel: "instagram", type: "dm" }),
      caso({ channel: "instagram", type: "comment" }),
      caso({ channel: "instagram", type: "comment" }),
      caso({ channel: "facebook", type: "dm" }),
      caso({ channel: "tiktok", type: "comment" }),
    ], AGOSTO);
    expect(cifras.canales).toMatchObject({
      ig_privado: 1, ig_publico: 2, fb_privado: 1, tt_publico: 1,
    });
    expect(cifras.privados).toBe(2);
    expect(cifras.publicos).toBe(3);
  });

  it("solo cuenta como derivado lo que el triaje marcó", () => {
    const cifras = buildSacReport(brand, [
      caso({ triage: { requiereDerivacion: true } }),
      caso({ triage: { requiereDerivacion: true } }),
      caso({}),
    ], AGOSTO);
    expect(cifras.derivados).toBe(2);
  });

  it("calcula cobertura sobre casos, no sobre volumen bruto", () => {
    const cifras = buildSacReport(brand, [
      caso({ status: "replied" }),
      caso({ status: "pending" }),
      caso({ status: "replied", triage: { esCasoSac: false } }),
    ], AGOSTO);
    // 1 respondido de 2 casos reales: el tercero no es caso y no diluye la tasa.
    expect(cifras.coberturaPct).toBe(50);
  });

  it("advierte cuando hay mensajes sin clasificar", () => {
    const cifras = buildSacReport(brand, [caso({ sacTriage: undefined })], AGOSTO);
    expect(cifras.advertencias.some((a) => a.includes("sin clasificar"))).toBe(true);
  });

  it("advierte cuando el período anterior no es comparable", () => {
    const actuales = Array.from({ length: 30 }, () => caso({ type: "dm" }));
    const previos = [caso({ type: "dm", createdAt: "2026-07-10T12:00:00.000Z" })];
    const cifras = buildSacReport(brand, [...actuales, ...previos], {
      ...AGOSTO,
      previous: { from: "2026-07-01", to: "2026-07-31" },
    });
    expect(cifras.variacion?.anterior).toBe(1);
    expect(cifras.variacion?.comparable).toBe(false);
    expect(cifras.advertencias.some((a) => a.includes("no es comparable"))).toBe(true);
  });

  it("descarta la variación cuando el período anterior no pasó por el clasificador", () => {
    // Sin triaje, cada mensaje del mes anterior cuenta como caso: se estaría comparando
    // volumen bruto contra casos filtrados.
    const actuales = Array.from({ length: 10 }, () => caso({ type: "dm" }));
    const previos = Array.from({ length: 10 }, () => caso({
      type: "dm",
      createdAt: "2026-07-10T12:00:00.000Z",
      sacTriage: undefined,
    }));
    const cifras = buildSacReport(brand, [...actuales, ...previos], {
      ...AGOSTO,
      previous: { from: "2026-07-01", to: "2026-07-31" },
    });
    expect(cifras.variacion?.comparable).toBe(false);
    expect(cifras.advertencias.some((a) => a.includes("sin clasificar"))).toBe(true);
    expect(reportPlaceholders(cifras).sac_variacion_texto).not.toContain("%");
  });

  it("conserva la variación cuando ambos períodos están clasificados y completos", () => {
    const actuales = Array.from({ length: 12 }, () => caso({ type: "dm" }));
    const previos = Array.from({ length: 10 }, () => caso({
      type: "dm",
      createdAt: "2026-07-10T12:00:00.000Z",
    }));
    const cifras = buildSacReport(brand, [...actuales, ...previos], {
      ...AGOSTO,
      previous: { from: "2026-07-01", to: "2026-07-31" },
    });
    expect(cifras.variacion).toMatchObject({ anterior: 10, deltaPct: 20, comparable: true });
    expect(reportPlaceholders(cifras).sac_variacion_texto).toContain("+20%");
  });

  it("advierte siempre que TikTok privado quede en cero", () => {
    const cifras = buildSacReport(brand, [caso({})], AGOSTO);
    expect(cifras.advertencias.some((a) => a.includes("TikTok"))).toBe(true);
  });

  it("ordena los motivos de mayor a menor", () => {
    const cifras = buildSacReport(brand, [
      caso({ triage: { categoria: "reclamo" } }),
      caso({ triage: { categoria: "stock" } }),
      caso({ triage: { categoria: "stock" } }),
      caso({ triage: { categoria: "stock" } }),
    ], AGOSTO);
    expect(cifras.motivos[0]).toMatchObject({ motivo: "Stock", casos: 3, pct: 75 });
    expect(cifras.motivos[1]).toMatchObject({ motivo: "Reclamos", casos: 1 });
  });

  it("mantiene las etiquetas de motivo dentro del ancho de la columna", () => {
    // Una etiqueta que se parte en dos líneas desplaza las cifras respecto de su motivo:
    // la tabla queda visualmente intacta y diciendo algo falso.
    // Una fila por categoría del clasificador, más el desglose estructural.
    const cifras = buildSacReport(brand, [
      ...SAC_CATEGORIES.map((categoria) => caso({ triage: { categoria } })),
      conContenido("story_mention", "Mención en una historia"),
      conContenido("story_reply", "Respuesta a una historia"),
      conContenido("unsupported", "Contenido no disponible desde Metricool"),
      conContenido("attachment", "Archivo adjunto"),
      conContenido("text", "👏"),
      conContenido("text", "Buenas tardes"),
    ], { ...AGOSTO, volumen: "bruto" });
    for (const { motivo } of cifras.motivos) {
      expect(motivo.length, `"${motivo}" no cabe en la columna`).toBeLessThanOrEqual(MAX_ETIQUETA_MOTIVO);
    }
  });

  it("desglosa lo que el clasificador no puede etiquetar, en vez de amontonarlo en Otros", () => {
    const cifras = buildSacReport(brand, [
      conContenido("story_mention", "Mención en una historia"),
      conContenido("story_mention", "Mención en una historia"),
      conContenido("unsupported", "Contenido no disponible desde Metricool"),
      conContenido("text", "👏👏"),
      conContenido("text", "Hola"),
      conContenido("attachment", "Archivo adjunto"),
    ], { ...AGOSTO, volumen: "bruto" });
    const porMotivo = Object.fromEntries(cifras.motivos.map((m) => [m.motivo, m.casos]));
    expect(porMotivo).toMatchObject({
      Menciones: 2, "Sin contenido": 1, Reacciones: 1, Saludos: 1, Adjuntos: 1,
    });
    expect(porMotivo.Otros).toBeUndefined();
  });

  it("respeta la categoría del clasificador por sobre el desglose estructural", () => {
    const cifras = buildSacReport(brand, [
      conContenido("attachment", "Archivo adjunto", { sacTriage: { categoria: "reclamo", esCasoSac: true, requiereDerivacion: false, confianza: 0.9, clasificadoEn: "", modelo: "" } } as never),
    ], { ...AGOSTO, volumen: "bruto" });
    expect(cifras.motivos[0].motivo).toBe("Reclamos");
  });

  it("agrupa la cola de motivos para no desbordar la lámina", () => {
    const muchos = SAC_CATEGORIES.flatMap((categoria, n) =>
      Array.from({ length: SAC_CATEGORIES.length - n }, () => caso({ triage: { categoria } })));
    const cifras = buildSacReport(brand, muchos, AGOSTO);
    expect(cifras.motivos.length).toBeLessThanOrEqual(MAX_FILAS_MOTIVOS);
    expect(cifras.motivos.reduce((total, m) => total + m.casos, 0)).toBe(cifras.mensajesGestionados);
  });

  it("analiza los motivos sobre el mismo conjunto que encabeza el informe", () => {
    const cifras = buildSacReport(brand, [
      caso({ text: "quiero saber si hay despacho a regiones", triage: { categoria: "despacho" } }),
      caso({ text: "felicitaciones al equipo por la campaña", triage: { categoria: "agradecimiento", esCasoSac: false } }),
    ], AGOSTO);
    const suma = cifras.motivos.reduce((total, m) => total + m.casos, 0);
    expect(suma).toBe(cifras.mensajesGestionados);
    expect(cifras.motivos.reduce((total, m) => total + m.pct, 0)).toBeCloseTo(100, 0);
  });
});

describe("reportPlaceholders", () => {
  it("rotula los tres cuadros de tono, que en la plantilla van sin título", () => {
    const cifras = buildSacReport(brand, [
      caso({ sentiment: "positive" }),
      caso({ sentiment: "neutral" }),
      caso({ sentiment: "neutral" }),
      caso({ sentiment: "negative" }),
    ], AGOSTO);
    const v = reportPlaceholders(cifras);
    expect(v.sac_tono_positivo).toBe("Positivo\n25%");
    expect(v.sac_tono_neutro).toBe("Neutro\n50%");
    expect(v.sac_tono_negativo).toBe("Negativo\n25%");
  });

  it("produce los marcadores de la plantilla con formato legible", () => {
    const cifras = buildSacReport(brand, [
      caso({ channel: "instagram", type: "dm", status: "replied" }),
      caso({ channel: "instagram", type: "comment", sentiment: "negative", triage: { categoria: "reclamo" } }),
    ], AGOSTO);
    const valores = reportPlaceholders(cifras);
    expect(valores.CLIENTE).toBe("COLBÚN");
    expect(valores.PERIODO).toBe("Agosto 2026");
    expect(valores.sac_total).toBe("2");
    expect(valores.sac_ig_privado).toBe("1");
    expect(valores.sac_ig_privado_pct).toBe("50%");
    expect(valores.sac_tt_privado).toBe("0");
    expect(valores.sac_motivos_labels.split("\n")).toHaveLength(2);
  });

  it("dice que es el primer período cuando no hay comparable", () => {
    const cifras = buildSacReport(brand, [caso({})], AGOSTO);
    expect(reportPlaceholders(cifras).sac_variacion_texto).toContain("Primer período");
  });
});
