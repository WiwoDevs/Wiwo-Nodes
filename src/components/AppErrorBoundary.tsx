/**
 * Red de seguridad para errores de la interfaz: nunca más una pantalla en blanco.
 *
 * React desmonta todo el árbol cuando un componente falla al dibujarse. Sin este límite, un
 * error en una vista dejaba la página vacía. Ahora:
 * - Si falla la carga de un archivo de la versión anterior (pasa a quien tenía wiwo.sac abierto
 *   durante un despliegue y abre Flujo SAC o Automatización), recarga la página una vez para
 *   traer la versión nueva.
 * - Cualquier otro error muestra una pantalla para reintentar o recargar, con el detalle, y se
 *   informa al servidor (`POST /api/client-errors`) para poder diagnosticarlo.
 */
import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";
import { Component, type ErrorInfo, type ReactNode } from "react";

const RELOAD_KEY = "wiwo-nodes.chunk-reload-at";

/** Archivo de código que ya no existe en el servidor (despliegue nuevo). */
export function isChunkLoadError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk [\w-]+ failed|ChunkLoadError/i.test(text);
}

/** Recarga una vez por minuto como máximo, para no entrar en un bucle si el archivo falta de verdad. */
export function reloadForNewVersion(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Sin almacenamiento de sesión: se recarga igual, una vez por evento.
  }
  window.location.reload();
  return true;
}

/** Informa el error al servidor sin datos de clientes: solo mensaje, pila acotada y sección. */
export function reportClientError(error: unknown, view?: string, componentStack?: string): void {
  try {
    const value = error instanceof Error ? error : new Error(String(error));
    void fetch(`${(import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "")}/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        message: value.message.slice(0, 500),
        name: value.name.slice(0, 80),
        stack: (value.stack || "").slice(0, 2_000),
        componentStack: (componentStack || "").slice(0, 2_000),
        view: view?.slice(0, 60),
        path: window.location.pathname.slice(0, 200),
      }),
    }).catch(() => undefined);
  } catch {
    // Informar nunca debe romper la pantalla de recuperación.
  }
}

interface Props {
  children: ReactNode;
  /** Sección abierta, para el informe y el texto. */
  view?: string;
  /** Todo el sitio (último recurso) o solo la zona de contenido. */
  scope?: "app" | "view";
}

interface State {
  error: Error | null;
  reloading: boolean;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reloading: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (isChunkLoadError(error) && reloadForNewVersion()) {
      this.setState({ reloading: true });
      return;
    }
    reportClientError(error, this.props.view, info.componentStack ?? undefined);
  }

  private retry = () => this.setState({ error: null, reloading: false });

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    const newVersion = isChunkLoadError(error);
    return (
      <section className={`app-error ${this.props.scope === "app" ? "app-error--full" : ""}`} role="alert">
        <div className="app-error__card">
          <span className="app-error__icon" aria-hidden="true"><WarningCircle size={26} weight="duotone" /></span>
          <h2>{reloading || newVersion ? "Hay una versión nueva de wiwo.sac" : "Algo falló al mostrar esta pantalla"}</h2>
          <p>
            {reloading
              ? "Recargando para traerla…"
              : newVersion
                ? "Se publicó una actualización mientras tenías la página abierta. Recarga para seguir trabajando."
                : "No se perdió nada de lo guardado. Puedes reintentar o recargar la página; el error quedó registrado para revisarlo."}
          </p>
          {!reloading ? (
            <div className="app-error__actions">
              <button type="button" className="button primary" onClick={() => window.location.reload()}>
                <ArrowClockwise size={16} weight="bold" aria-hidden="true" /> Recargar
              </button>
              {!newVersion ? (
                <button type="button" className="button secondary" onClick={this.retry}>Reintentar</button>
              ) : null}
            </div>
          ) : null}
          {!newVersion && !reloading ? (
            <details className="app-error__details">
              <summary>Detalle técnico</summary>
              <code>{error.name}: {error.message}</code>
            </details>
          ) : null}
        </div>
      </section>
    );
  }
}
