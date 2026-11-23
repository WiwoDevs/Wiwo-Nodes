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

initTheme();
initSidebar();
// Soundbranding WiWO: no descarga nada hasta el primer gesto y solo si el sonido está activado.
prepararSonidosMarca({ base: "/sonidos", volumen: 0.5 });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>{(actor, signOut) => <App onSignOut={signOut ?? undefined} sessionActor={actor} />}</AuthGate>
  </React.StrictMode>,
);
