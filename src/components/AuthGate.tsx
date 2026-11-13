/**
 * Decide si la aplicación se muestra o si primero hay que iniciar sesión.
 *
 * Cuando el servidor reporta identidad deshabilitada (entorno local/demo), la app se
 * monta directo y nada cambia respecto del comportamiento anterior. Cuando está activa,
 * se comprueba la cookie de sesión contra `/api/me` antes de montar nada.
 */
import { useCallback, useEffect, useState } from "react";
import { closeSession, loadAuthConfig, loadCurrentActor, type AuthProvider } from "../lib/api";
import { LoginScreen } from "./LoginScreen";
import { LoginShell } from "./LoginShell";
import type { SessionActor } from "../types";

type GateState =
  | { status: "checking" }
  | { status: "open" }
  | { status: "login" }
  | { status: "failed"; message: string };

type AuthGateProps = {
  /** signOut solo existe cuando el inicio de sesión está activo. */
  children: (actor: SessionActor | null, signOut: (() => Promise<void>) | null) => React.ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<GateState>({ status: "checking" });
  const [actor, setActor] = useState<SessionActor | null>(null);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [provider, setProvider] = useState<AuthProvider>("google");

  const signOut = useCallback(async () => {
    await closeSession();
    setActor(null);
    setState({ status: "login" });
  }, []);

  /** Lee la configuración de inicio de sesión y la sesión vigente. Lanza ante errores de la API. */
  const resolveSession = useCallback(async () => {
    const config = await loadAuthConfig();
    setAuthEnabled(config.enabled);
    setProvider(config.provider ?? "google");
    if (!config.enabled) {
      setState({ status: "open" });
      return;
    }
    const current = await loadCurrentActor();
    if (!current) {
      setState({ status: "login" });
      return;
    }
    setActor(current);
    setState({ status: "open" });
  }, []);

  const check = useCallback(async () => {
    setState({ status: "checking" });
    // Errores transitorios del proxy (502/503) son habituales mientras la API sincroniza:
    // se reintenta unas veces antes de mostrar el error.
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 1_500 * attempt));
      try {
        await resolveSession();
        return;
      } catch (cause) {
        lastError = cause;
      }
    }
    setState({
      status: "failed",
      message: lastError instanceof Error ? lastError.message : "No fue posible contactar la API.",
    });
  }, [resolveSession]);



  useEffect(() => {
    void check();
  }, [check]);

  if (state.status === "checking") {
    return (
      <LoginShell>
        <div className="wl-checking">
          <span className="wl-spinner" role="status" aria-label="Verificando sesión" />
        </div>
      </LoginShell>
    );
  }

  if (state.status === "failed") {
    return (
      <LoginShell>
        <div className="wl-checking">
          <div className="wl-panel">
            <h1 className="wl-title">No pudimos conectar</h1>
            <p className="wl-message wl-message--error" role="alert">{state.message}</p>
            <button type="button" className="wl-submit" style={{ marginTop: "1.25rem" }} onClick={() => void check()}>
              Reintentar
            </button>
          </div>
        </div>
      </LoginShell>
    );
  }

  if (state.status === "login") {
    return (
      <LoginScreen
        provider={provider}
        onAuthenticated={(authenticated) => {
          setActor(authenticated);
          setState({ status: "open" });
        }}
      />
    );
  }

  return <>{children(actor, authEnabled ? signOut : null)}</>;
}
