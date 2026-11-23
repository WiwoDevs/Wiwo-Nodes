import { useCallback, useEffect, useState } from "react";

/**
 * Menú lateral desplegable del ecosistema WiWO (como el shell Neo de MetriQ): ancho completo con
 * secciones y etiquetas, o riel de íconos con micro-etiqueta. La preferencia se recuerda por
 * navegador; sin preferencia guardada, las pantallas angostas parten en riel para dejarle espacio
 * a la bandeja y a Gestión DMs/comentarios. El estado también queda en <html data-sidebar> antes
 * del primer render, así el primer pintado ya sale con el ancho correcto.
 */
const STORAGE_KEY = "wiwo-nodes-sidebar";
const EXPANDED_MIN_WIDTH = 1360;

export type SidebarMode = "expanded" | "collapsed";

function readStoredMode(): SidebarMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "expanded" || stored === "collapsed") return stored;
  } catch {
    // Storage can be blocked (private mode, previews); fall back to the width default.
  }
  return window.innerWidth >= EXPANDED_MIN_WIDTH ? "expanded" : "collapsed";
}

function applyMode(mode: SidebarMode) {
  document.documentElement.dataset.sidebar = mode;
}

export function initSidebar() {
  applyMode(readStoredMode());
}

export function useSidebarMode() {
  const [mode, setMode] = useState<SidebarMode>(() => readStoredMode());
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    applyMode(mode);
    if (!touched) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Preference simply won't persist when storage is unavailable.
    }
  }, [mode, touched]);

  const toggleSidebar = useCallback(() => {
    setTouched(true);
    setMode((current) => (current === "expanded" ? "collapsed" : "expanded"));
  }, []);

  return { isCollapsed: mode === "collapsed", toggleSidebar };
}
