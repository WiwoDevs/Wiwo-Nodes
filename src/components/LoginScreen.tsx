/**
 * Puerta de entrada cuando la identidad Firebase está activa.
 *
 * El flujo es el mismo de METRIQ: popup de Google, se obtiene el idToken y el servidor
 * lo canjea por una cookie httpOnly tras validar la allowlist de Firestore. El token
 * nunca se guarda en el navegador.
 */
import { useState } from "react";
import { SignIn, WarningCircle } from "@phosphor-icons/react";
import wiwoNodesLogo from "../assets/wiwo-nodes-logo.png";
import { openFirebaseSession } from "../lib/api";
import { firebaseConfigured, signInWithGoogle, signOutFromGoogle } from "../lib/firebase";
import type { SessionActor } from "../types";

type LoginScreenProps = {
  onAuthenticated: (actor: SessionActor) => void;
};

export function LoginScreen({ onAuthenticated }: LoginScreenProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleLogin() {
    setLoading(true);
    setError(null);
    try {
      const idToken = await signInWithGoogle();
      const actor = await openFirebaseSession(idToken);
      onAuthenticated(actor);
    } catch (cause) {
      // Si el canje falla (cuenta sin permiso), se cierra también la sesión del SDK
      // para no dejar al navegador con una cuenta activa que la API rechaza.
      await signOutFromGoogle();
      const message = cause instanceof Error ? cause.message : "";
      setError(
        message.includes("popup-closed") || message.includes("cancelled")
          ? "Cerraste la ventana de Google antes de terminar."
          : message || "No fue posible iniciar sesión.",
      );
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <div className="login-card">
        <img src={wiwoNodesLogo} alt="Wiwo Nodes" className="login-logo" />
        <p className="login-subtitle">Centro de atención y automatización</p>

        {firebaseConfigured ? (
          <button
            type="button"
            className="login-button"
            onClick={handleGoogleLogin}
            disabled={loading}
          >
            {loading ? <span className="login-spinner" aria-hidden="true" /> : <SignIn size={18} weight="bold" />}
            {loading ? "Conectando…" : "Continuar con Google"}
          </button>
        ) : (
          <p className="login-error">
            <WarningCircle size={16} weight="bold" />
            Falta la configuración de Firebase en el entorno del navegador.
          </p>
        )}

        {error && (
          <p className="login-error">
            <WarningCircle size={16} weight="bold" />
            {error}
          </p>
        )}

        <p className="login-footnote">Solo cuentas autorizadas pueden ingresar.</p>
      </div>
    </main>
  );
}
