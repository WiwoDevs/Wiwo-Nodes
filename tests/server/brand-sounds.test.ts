/**
 * Soundbranding WiWO en wiwo.sac: qué avisos suenan, el freno de ráfagas del kit y la preferencia de
 * silencio compartida. Lo que se protege es que solo suenen los fallos de una acción de la persona y
 * los éxitos de procesos lentos, que una cadena de errores no ensordezca y que el silencio se respete.
 */
import { afterEach, describe, expect, it } from "vitest";
import { toastSound } from "../../src/lib/brand-sounds";
import {
  CLAVE_SONIDOS,
  ESPERA_MISMO_TIPO_MS,
  ESPERA_OTRO_TIPO_MS,
  crearLimitador,
  establecerSonidos,
  leerSonidosActivos,
  sonidoDelLote,
} from "../../src/lib/sonidos-wiwo";

const globalWithWindow = globalThis as unknown as { window?: unknown };

function installWindow() {
  const stored = new Map<string, string>();
  const dispatched: string[] = [];
  globalWithWindow.window = {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    },
    dispatchEvent: (event: Event) => {
      dispatched.push(event.type);
      return true;
    },
  };
  return { stored, dispatched };
}

afterEach(() => {
  delete globalWithWindow.window;
});

describe("toastSound", () => {
  it("suena error en los fallos de una acción de la persona", () => {
    expect(toastSound({ tone: "warning", title: "No se pudo guardar el borrador" })).toBe("error");
    expect(toastSound({ tone: "warning", title: "No se pudieron guardar las reglas" })).toBe("error");
    expect(toastSound({ tone: "warning", title: "La respuesta no fue confirmada" })).toBe("error");
  });

  it("no suena en lecturas de fondo marcadas ni en advertencias informativas", () => {
    expect(toastSound({ tone: "warning", title: "No se pudo cargar el historial", sound: false })).toBeNull();
    expect(toastSound({ tone: "warning", title: "Nada para archivar" })).toBeNull();
  });

  it("el éxito suena solo cuando el aviso lo pide (procesos lentos)", () => {
    expect(toastSound({ tone: "success", title: "Nota interna guardada" })).toBeNull();
    expect(toastSound({ tone: "success", title: "Excel generado", sound: true })).toBe("exito");
  });
});

describe("kit sonidos-wiwo", () => {
  it("frena ráfagas del mismo tipo y entre tipos distintos", () => {
    let now = 0;
    const limiter = crearLimitador(() => now);
    expect(limiter.permitir("error")).toBe(true);
    now += ESPERA_OTRO_TIPO_MS - 1;
    expect(limiter.permitir("exito")).toBe(false);
    now += 1;
    expect(limiter.permitir("exito")).toBe(true);
    now += ESPERA_OTRO_TIPO_MS;
    expect(limiter.permitir("error")).toBe(false);
    now = ESPERA_MISMO_TIPO_MS;
    expect(limiter.permitir("error")).toBe(true);
  });

  it("un lote suena una sola vez al terminar", () => {
    expect(sonidoDelLote(3, 0, true)).toBeNull();
    expect(sonidoDelLote(3, 1, false)).toBe("error");
    expect(sonidoDelLote(3, 0, false)).toBe("exito");
    expect(sonidoDelLote(0, 0, false)).toBeNull();
  });

  it("la preferencia de silencio es la compartida del ecosistema y arranca encendida", () => {
    const { stored, dispatched } = installWindow();
    expect(leerSonidosActivos()).toBe(true);
    establecerSonidos(false);
    expect(stored.get(CLAVE_SONIDOS)).toBe("apagados");
    expect(leerSonidosActivos()).toBe(false);
    establecerSonidos(true);
    expect(stored.has(CLAVE_SONIDOS)).toBe(false);
    expect(dispatched).toEqual(["wiwo:sonidos", "wiwo:sonidos"]);
  });
});
