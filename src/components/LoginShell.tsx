/**
 * Fondo compartido de las pantallas previas a la app (inicio de sesión, verificación):
 * escena ilustrada de WiWO Ops, velo de marca y contenido encima.
 */
import type { CSSProperties, ReactNode } from "react";
import escenaPrimavera from "../assets/login-escena-primavera.html?raw";
import wiwoNodesLogo from "../assets/wiwo-nodes-logo.png";
import "@fontsource-variable/outfit";
import "../styles/login.css";

export function LoginShell({ children }: { children: ReactNode }) {
  return (
    <div className="wl-shell" style={{ "--wl-logo-url": `url("${wiwoNodesLogo}")` } as CSSProperties}>
      {/* Marcado estático propio (sin scripts ni recursos externos), solo decorativo. */}
      <div className="wl-scene" aria-hidden="true" dangerouslySetInnerHTML={{ __html: escenaPrimavera }} />
      <main className="wl-main">{children}</main>
    </div>
  );
}

export function WiwoNodesLogo({ size }: { size: "large" | "small" }) {
  return <span role="img" aria-label="WIWO.Nodes" className={`wl-logo wl-logo--${size}`} />;
}
