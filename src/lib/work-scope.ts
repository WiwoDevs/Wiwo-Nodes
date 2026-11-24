/**
 * Alcance de trabajo: solo las cuentas que el equipo atiende hoy (marcadas «En SAC» en Clientes)
 * o todas. Lo comparten el Inicio, el contador del menú, la campana y el filtro de cuenta de la
 * Bandeja SAC, para que las cifras coincidan. Se recuerda por navegador; sin preferencia, parte en
 * «En SAC». Si ninguna cuenta está marcada, siempre es «todas».
 */
export type WorkScope = "sac" | "all";

const STORAGE_KEY = "wiwo-nodes-work-scope";

export function readWorkScope(): WorkScope {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "sac" || stored === "all") return stored;
  } catch {
    // Sin almacenamiento: vale el valor por defecto.
  }
  return "sac";
}

export function writeWorkScope(scope: WorkScope): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, scope);
  } catch {
    // Sin almacenamiento: la preferencia dura hasta recargar.
  }
}
