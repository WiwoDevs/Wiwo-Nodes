/**
 * Fondo compartido de las pantallas previas a la app (inicio de sesión, verificación):
 * escena ilustrada de WiWO Ops, velo de marca y contenido encima.
 */
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import escenaPrimavera from "../assets/login-escena-primavera.html?raw";
import { applySceneStyles, prepareSceneMarkup } from "../lib/login-scene";
import sacWiwoLogo from "../assets/sac-wiwo-logo.png";
import "@fontsource-variable/outfit";
import "../styles/login.css";
import "../styles/login-escena.css";

// Sin <style> ni style="…" en línea: la CSP de producción los bloquearía (ver lib/login-scene).
const SCENE_MARKUP = prepareSceneMarkup(escenaPrimavera);

export function LoginShell({ children }: { children: ReactNode }) {
  const sceneRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (sceneRef.current) applySceneStyles(sceneRef.current);
  }, []);
  return (
    <div className="wl-shell" style={{ "--wl-logo-url": `url("${sacWiwoLogo}")` } as CSSProperties}>
      {/* Marcado estático propio (sin scripts ni recursos externos), solo decorativo. */}
      <div ref={sceneRef} className="wl-scene" aria-hidden="true" dangerouslySetInnerHTML={{ __html: SCENE_MARKUP }} />
      <main className="wl-main">{children}</main>
    </div>
  );
}

export function SacWiwoLogo({ size }: { size: "large" | "small" }) {
  return <span role="img" aria-label="sac.wiwo" className={`wl-logo wl-logo--${size}`} />;
}
