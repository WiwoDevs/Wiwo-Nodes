/**
 * Decide si la aplicación se muestra o si primero hay que iniciar sesión.
 *
 * Cuando el servidor reporta identidad deshabilitada (entorno local/demo), la app se
 * monta directo y nada cambia respecto del comportamiento anterior. Cuando está activa,
 * se comprueba la cookie de sesión contra `/api/me` antes de montar nada.
 */
import { useCallback, useEffect, useState } from "react";
import { loadAuthConfig, loadCurrentActor } from "../lib/api";
import { LoginScreen } from "./LoginScreen";
import type { SessionActor } from "../types";

type GateState =
  | { status: "checking" }
  | { status: "open" }
  | { status: "login" }
  | { status: "failed"; message: string };

type AuthGateProps = {
  children: (actor: SessionActor | null) => React.ReactNode;
};

export function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<GateState>({ status: "checking" });
  const [actor, setActor] = useState<SessionActor | null>(null);

  const check = useCallback(async () => {
    try {
      const config = await loadAuthConfig();
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
    } catch (cause) {
      setState({
        status: "failed",
        message: cause instanceof Error ? cause.message : "No fue posible contactar la API.",
      });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (state.status === "checking") {
    return (
      <main className="login-screen">
        <div className="login-card">
          <span className="login-spinner" aria-label="Verificando sesión" />
        </div>
      </main>
    );
  }

  if (state.status === "failed") {
    return (
      <main className="login-screen">
        <div className="login-card">
          <p className="login-error">{state.message}</p>
          <button type="button" className="login-button" onClick={() => void check()}>
            Reintentar
          </button>
        </div>
      </main>
    );
  }

  if (state.status === "login") {
    return (
      <LoginScreen
        onAuthenticated={(authenticated) => {
          setActor(authenticated);
          setState({ status: "open" });
        }}
      />
    );
  }

  return <>{children(actor)}</>;
}
