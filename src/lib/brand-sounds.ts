/**
 * Soundbranding WiWO en wiwo.sac. Los tres sonidos y su módulo (`sonidos-wiwo.ts`, copia del kit de
 * Ops sin cambios) se usan con la misma regla que el resto del ecosistema: si la persona hizo clic y
 * esperó, el resultado suena; si fue el sistema por su cuenta, no suena.
 *
 * - Marca: una vez, al entrar después de iniciar sesión (precargada aparte, ver «Firma de entrada»).
 * - Error: avisos de una acción de la persona que falló (los avisos «No se pudo…»), salvo que el aviso
 *   lleve `sound: false` (lecturas en segundo plano).
 * - Éxito: solo los avisos marcados con `sound: true` (procesos lentos: sincronizar, exportar,
 *   importar, acciones en lote). Los guardados comunes no suenan.
 *
 * Nada de esto lanza ni bloquea la interfaz: el sonido refuerza el aviso visual, no lo reemplaza.
 */
import { leerSonidosActivos, sonarError, sonarExito } from "./sonidos-wiwo";

export type ToastSoundInput = {
  tone: "success" | "warning";
  title: string;
  /** true: un éxito que suena; false: un fallo que no suena (lectura en segundo plano). */
  sound?: boolean;
};

/** Avisos de advertencia que informan que algo pedido por la persona falló. */
const FAILURE_TITLE = /^(No se pud|La ejecución no pudo|La respuesta no fue confirmada|Metricool se sincronizó, pero)/;

export function toastSound(toast: ToastSoundInput): "exito" | "error" | null {
  if (toast.sound === false) return null;
  if (toast.tone === "warning") return FAILURE_TITLE.test(toast.title) ? "error" : null;
  return toast.sound === true ? "exito" : null;
}

export function playToastSound(toast: ToastSoundInput): void {
  const sound = toastSound(toast);
  if (sound === "exito") sonarExito();
  else if (sound === "error") sonarError();
}

export { sonarError as playErrorSound };

/* ---------- Firma de entrada ---------- */

const INTRO_KEY = "wiwo-sac-intro";
const MARCA_URL = "/sonidos/wiwo-sonic-marca.mp3";
const MARCA_VOLUME = 0.5;
/** Tras volver de Google, cuánto se espera el primer gesto para que la firma todavía sea «la entrada». */
const RETURN_GESTURE_WINDOW_MS = 30_000;
/** Si el archivo no llegó en este plazo desde que se pidió la firma, ya no corresponde y no suena. */
const INTRO_READY_WINDOW_MS = 4_000;
const GESTURE_EVENTS = ["pointerdown", "keydown"] as const;

/** Antes de ir a Google: al volver con la sesión abierta, la entrada suena una vez. */
export function markIntroPending(): void {
  try {
    window.sessionStorage.setItem(INTRO_KEY, "1");
  } catch {
    // Sin almacenamiento simplemente no suena la firma al volver.
  }
}

export function consumeIntroPending(): boolean {
  try {
    const pending = window.sessionStorage.getItem(INTRO_KEY) === "1";
    window.sessionStorage.removeItem(INTRO_KEY);
    return pending;
  } catch {
    return false;
  }
}

/*
 * La firma no usa la carga diferida del kit: ahí los tres MP3 recién bajan con el primer gesto y,
 * con la app pidiendo la bandeja al mismo tiempo, llegaban varios segundos tarde. Aquí se precarga
 * solo la firma (43 KB) apenas se sabe que la persona está entrando —pantalla de inicio de sesión o
 * vuelta de Google— y solo si el sonido está activado; queda decodificada en un contexto suspendido
 * que el gesto reanuda. Éxito y error siguen con el kit (sonidos-wiwo.ts).
 */
let introContext: AudioContext | null = null;
let introBuffer: Promise<AudioBuffer | null> | null = null;
let introPlayed = false;

/** Precarga la firma. Idempotente; con el sonido apagado o sin Web Audio no hace nada. */
export function preloadBrandIntro(): void {
  if (introBuffer || introPlayed || !leerSonidosActivos()) return;
  if (typeof globalThis.AudioContext !== "function") return;
  try {
    introContext = new AudioContext();
  } catch {
    return;
  }
  const context = introContext;
  introBuffer = fetch(MARCA_URL)
    .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
    .then((data) => context.decodeAudioData(data))
    .catch(() => null);
}

/** Reanuda el contexto; llamarlo dentro del gesto (Safari lo exige sincrónico). */
function wakeIntroContext(): void {
  if (introContext && introContext.state === "suspended") void introContext.resume().catch(() => undefined);
}

/** Suena la firma si el archivo llega a tiempo y el navegador lo permite. Nunca lanza. */
async function playPreloadedIntro(): Promise<boolean> {
  try {
    if (introPlayed || !leerSonidosActivos()) return false;
    preloadBrandIntro();
    wakeIntroContext();
    if (!introContext || !introBuffer) return false;
    const buffer = await Promise.race([
      introBuffer,
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), INTRO_READY_WINDOW_MS)),
    ]);
    if (!buffer || introPlayed) return false;
    if (introContext.state !== "running") await introContext.resume().catch(() => undefined);
    // Sin pausas desde aquí hasta marcarla: el intento inmediato y el del clic no suenan los dos.
    if (introContext.state !== "running" || introPlayed) return false;
    const source = introContext.createBufferSource();
    const gain = introContext.createGain();
    source.buffer = buffer;
    gain.gain.value = MARCA_VOLUME;
    source.connect(gain).connect(introContext.destination);
    source.start();
    introPlayed = true;
    return true;
  } catch {
    return false;
  }
}

/** Entrada con el formulario de prueba local: el clic de «Entrar» ya es el gesto. */
export function playBrandIntro(): void {
  void playPreloadedIntro();
}

/**
 * Vuelta de Google con la sesión abierta. El navegador no deja sonar audio en una página a la que se
 * llegó por redirección hasta que la persona toca algo: la firma se precarga ya, se intenta por si el
 * navegador lo permite y, si no sonó, suena con el primer clic o tecla de los siguientes 30 s.
 */
export function playBrandIntroAfterRedirect(): void {
  preloadBrandIntro();
  const onGesture = () => {
    stop();
    void playPreloadedIntro();
  };
  const timeout = window.setTimeout(() => stop(), RETURN_GESTURE_WINDOW_MS);
  function stop() {
    window.clearTimeout(timeout);
    for (const event of GESTURE_EVENTS) window.removeEventListener(event, onGesture, true);
  }
  for (const event of GESTURE_EVENTS) window.addEventListener(event, onGesture, { capture: true, passive: true });
  // Algunos navegadores ya permiten el audio (p. ej. por uso previo del sitio): entonces suena sin esperar.
  void playPreloadedIntro().then((played) => {
    if (played) stop();
  });
}

/** Estado de la firma, para diagnóstico en el navegador y pruebas (sin datos de la persona). */
export function brandIntroStatus(): { played: boolean; preloaded: boolean; context: AudioContextState | "none" } {
  return { played: introPlayed, preloaded: introBuffer !== null, context: introContext?.state ?? "none" };
}
