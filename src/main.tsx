import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/plus-jakarta-sans";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { App } from "./App";
import { AuthGate } from "./components/AuthGate";
import { initTheme } from "./lib/theme";

initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>{() => <App />}</AuthGate>
  </React.StrictMode>,
);
