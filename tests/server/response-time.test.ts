import { describe, expect, it } from "vitest";
import { median, responseMinutes, summarizeResponseTimes } from "../../server/response-time.js";
import type { Interaction } from "../../server/types.js";

/** Caso mínimo: solo los campos que intervienen en el cálculo del tiempo de respuesta. */
function caso(overrides: Partial<Interaction>): Interaction {
  return {
    direction: "inbound",
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  } as Interaction;
}

describe("median", () => {
  it("devuelve null sin muestras", () => {
    expect(median([])).toBeNull();
  });

  it("toma el valor central en una lista impar", () => {
    expect(median([5, 1, 100])).toBe(5);
  });

  it("promedia los dos centrales en una lista par", () => {
    expect(median([1, 3, 5, 100])).toBe(4);
  });

  it("no se deja arrastrar por un valor extremo", () => {
    // El promedio de esta serie supera 2000; la mediana se mantiene en el caso típico.
    expect(median([5, 10, 15, 20, 10_000])).toBe(15);
  });
});

describe("responseMinutes", () => {
  it("mide desde el mensaje del cliente hasta la respuesta del equipo", () => {
    const minutos = responseMinutes([caso({
      createdAt: "2026-08-01T10:00:00.000Z",
      respondedAt: "2026-08-01T12:30:00.000Z",
    })]);
    expect(minutos).toEqual([150]);
  });

  it("ignora los casos sin respuesta", () => {
    expect(responseMinutes([caso({}), caso({ respondedAt: undefined })])).toEqual([]);
  });

  it("ignora los salientes: solo se mide la espera de un cliente", () => {
    const minutos = responseMinutes([caso({
      direction: "outbound",
      respondedAt: "2026-08-01T11:00:00.000Z",
    })]);
    expect(minutos).toEqual([]);
  });

  it("descarta fechas invertidas o no parseables en vez de propagar basura", () => {
    const minutos = responseMinutes([
      caso({ createdAt: "2026-08-01T12:00:00.000Z", respondedAt: "2026-08-01T10:00:00.000Z" }),
      caso({ createdAt: "no es fecha", respondedAt: "2026-08-01T10:00:00.000Z" }),
    ]);
    expect(minutos).toEqual([]);
  });
});

describe("summarizeResponseTimes", () => {
  it("publica mediana, promedio y tamaño de muestra", () => {
    const resumen = summarizeResponseTimes([
      caso({ createdAt: "2026-08-01T10:00:00.000Z", respondedAt: "2026-08-01T10:10:00.000Z" }),
      caso({ createdAt: "2026-08-01T10:00:00.000Z", respondedAt: "2026-08-01T10:20:00.000Z" }),
      caso({ createdAt: "2026-08-01T10:00:00.000Z", respondedAt: "2026-08-08T10:00:00.000Z" }),
    ]);
    expect(resumen.sampleSize).toBe(3);
    expect(resumen.medianMinutes).toBe(20);
    // El promedio queda arrastrado por el caso de siete días: por eso la vista usa la mediana.
    expect(resumen.averageMinutes).toBeGreaterThan(3000);
  });

  it("devuelve null en vez de cero cuando no hay casos respondidos", () => {
    const resumen = summarizeResponseTimes([caso({})]);
    expect(resumen).toEqual({ medianMinutes: null, averageMinutes: null, sampleSize: 0 });
  });
});
