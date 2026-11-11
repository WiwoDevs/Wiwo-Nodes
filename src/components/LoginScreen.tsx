/**
 * Puerta de entrada cuando el inicio de sesión está activo, con la anatomía de WiWO Ops:
 * orbe y lema a la izquierda, panel de vidrio "Entrar" a la derecha.
 *
 * - provider "google": botón de Google. El navegador va a /api/auth/google/start y el
 *   servidor completa OAuth, valida la allowlist y vuelve con una cookie httpOnly. Si algo
 *   falla, vuelve con ?login_error=CODIGO y aquí se muestra el motivo.
 * - provider "dev": prueba local con correo y contraseña de usuarios ficticios.
 *
 * Ningún token ni contraseña se guarda en el navegador.
 */
import { useEffect, useState } from "react";
import { WarningCircle } from "@phosphor-icons/react";
import { GOOGLE_SIGN_IN_URL, openDevSession, type AuthProvider } from "../lib/api";
import type { SessionActor } from "../types";
import { LoginShell, WiwoNodesLogo } from "./LoginShell";
import { WiwoThinkingOrb } from "./WiwoThinkingOrb";

type LoginScreenProps = {
  /** "dev" valida contra usuarios ficticios del servidor; "google" usa OAuth de Google. */
  provider: AuthProvider;
  onAuthenticated: (actor: SessionActor) => void;
};

const LOGIN_ERRORS: Record<string, string> = {
  ACCOUNT_NOT_ALLOWED: "Tu cuenta de Google no está autorizada para Wiwo Nodes. Pide acceso a un administrador.",
  PERMISSION_REQUIRED: "Tu cuenta no tiene el permiso necesario para Wiwo Nodes.",
  EMAIL_NOT_VERIFIED: "Tu cuenta de Google no tiene un correo verificado.",
  GOOGLE_CANCELLED: "Cancelaste el inicio de sesión con Google.",
  OAUTH_STATE_INVALID: "El intento de inicio de sesión expiró. Vuelve a intentarlo.",
  GOOGLE_TOKEN_INVALID: "No pudimos validar la respuesta de Google. Vuelve a intentarlo.",
};

/** Lee y quita ?login_error de la URL para que un recargo no repita el mensaje. */
function takeLoginError(): string | null {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("login_error");
  if (!code) return null;
  url.searchParams.delete("login_error");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return LOGIN_ERRORS[code] ?? "No fue posible iniciar sesión con Google. Vuelve a intentarlo.";
}

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export function LoginScreen({ provider, onAuthenticated }: LoginScreenProps) {
  const isDev = provider === "dev";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const message = takeLoginError();
    if (message) setError(message);
  }, []);

  function handleGoogle() {
    if (loading) return;
    setLoading(true);
    setError(null);
    window.location.assign(GOOGLE_SIGN_IN_URL);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const actor = await openDevSession(email, password);
      setPassword("");
      onAuthenticated(actor);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "No fue posible iniciar sesión.");
      setLoading(false);
    }
  }

  return (
    <LoginShell>
      <div className="wl-layout">
        <aside className="wl-aside">
          <WiwoNodesLogo size="large" />
          <WiwoThinkingOrb width="clamp(14rem, 22vw, 21rem)" />
          <p className="wl-tagline">
            Mensajes, Cuentas y Automatizaciones.
            <br />
            <span>Un solo lugar.</span>
          </p>
        </aside>

        <div className="wl-mobile-brand">
          <WiwoThinkingOrb width="3.5rem" />
          <WiwoNodesLogo size="small" />
        </div>

        <div className="wl-panel">
          <h1 className="wl-title">Entrar</h1>

          {isDev ? (
            <>
              <p className="wl-dev-badge">
                Modo de prueba local · usuarios ficticios de <code>dev-users.example.json</code>
              </p>
              <form className="wl-form wl-form--solo" onSubmit={(event) => void handleSubmit(event)} noValidate>
                <div className="wl-field">
                  <label htmlFor="wl-email">Correo<span aria-hidden="true">*</span></label>
                  <input
                    id="wl-email"
                    className="wl-input"
                    type="email"
                    name="email"
                    autoComplete="username"
                    inputMode="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={loading}
                    aria-required="true"
                    required
                    autoFocus
                  />
                </div>
                <div className="wl-field">
                  <label htmlFor="wl-password">Contraseña<span aria-hidden="true">*</span></label>
                  <input
                    id="wl-password"
                    className="wl-input"
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={loading}
                    aria-required="true"
                    required
                  />
                </div>
                <button type="submit" className="wl-submit" disabled={loading || !email.trim() || !password}>
                  {loading ? <span className="wl-spinner" aria-hidden="true" /> : null}
                  {loading ? "Verificando…" : "Entrar"}
                </button>
              </form>
            </>
          ) : (
            <>
              <button type="button" className="wl-google" onClick={handleGoogle} disabled={loading}>
                <span className="wl-google__mark"><GoogleMark /></span>
                <span>{loading ? "Abriendo Google…" : "Iniciar sesión con Google"}</span>
              </button>
              <p className="wl-footnote">Solo cuentas autorizadas pueden ingresar.</p>
            </>
          )}

          <p className="sr-only" role="status" aria-live="polite">{loading ? "Verificando credenciales" : ""}</p>
          {error ? (
            <p className="wl-message wl-message--error" role="alert">
              <WarningCircle size={16} weight="bold" />
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </LoginShell>
  );
}
