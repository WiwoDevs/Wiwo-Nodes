/**
 * Soundbranding WiWO en wiwo.sac. Los tres sonidos y su módulo (`sonidos-wiwo.ts`, copia del kit de
 * Ops sin cambios) se usan con la misma regla que el resto del ecosistema: si la persona hizo clic y
 * esperó, el resultado suena; si fue el sistema por su cuenta, no suena.
 *
 * - Marca: una vez, al entrar después de iniciar sesión.
 * - Error: avisos de una acción de la persona que falló (los avisos «No se pudo…»), salvo que el aviso
 *   lleve `sound: false` (lecturas en segundo plano).
 * - Éxito: solo los avisos marcados con `sound: true` (procesos lentos: sincronizar, exportar,
 *   importar, acciones en lote). Los guardados comunes no suenan.
 *
 * Nada de esto lanza ni bloquea la interfaz: el sonido refuerza el aviso visual, no lo reemplaza.
 */
import { sonarError, sonarExito, sonarMarca } from "./sonidos-wiwo";

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
/** La intro de Ops dura 1,8 s con un tope de 2,5 s: pasado eso la firma ya no corresponde. */
const INTRO_WINDOW_MS = 2_500;
const INTRO_RETRY_MS = 150;

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

/**
 * Suena la firma de marca al entrar. Los MP3 se descargan en el primer gesto (el clic de «Entrar»),
 * así que se reintenta brevemente hasta que estén listos; si no lo están dentro de la ventana de la
 * intro (o el sonido está apagado, o el navegador lo bloquea), no suena y no pasa nada.
 */
export function playBrandIntro(): void {
  const startedAt = Date.now();
  const attempt = () => {
    if (sonarMarca()) return;
    if (Date.now() - startedAt < INTRO_WINDOW_MS) window.setTimeout(attempt, INTRO_RETRY_MS);
  };
  attempt();
}
