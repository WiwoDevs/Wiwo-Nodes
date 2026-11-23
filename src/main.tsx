import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/plus-jakarta-sans";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import "./styles/thinking-orb.css";
import "./styles/wiwo-ecosystem.css";
import { App } from "./App";
import { AuthGate } from "./components/AuthGate";
import { initTheme } from "./lib/theme";
import { initSidebar } from "./lib/sidebar";
import { prepararSonidosMarca } from "./lib/sonidos-wiwo";
import { AppErrorBoundary, reloadForNewVersion } from "./components/AppErrorBoundary";

initTheme();
initSidebar();
// Soundbranding WiWO: no descarga nada hasta el primer gesto y solo si el sonido está activado.
prepararSonidosMarca({ base: "/sonidos", volumen: 0.5 });

// Vite avisa cuando no puede precargar un archivo de la versión anterior (hubo un despliegue con
// la página abierta): se recarga una vez para traer la versión nueva en vez de fallar.
window.addEventListener("vite:preloadError", (event) => {
  if (reloadForNewVersion()) event.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary scope="app">
      <AuthGate>{(actor, signOut) => <App onSignOut={signOut ?? undefined} sessionActor={actor} />}</AuthGate>
    </AppErrorBoundary>
  </React.StrictMode>,
);
