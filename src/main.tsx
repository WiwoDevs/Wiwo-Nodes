import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { App } from "./App";
import { AuthGate } from "./components/AuthGate";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>{() => <App />}</AuthGate>
  </React.StrictMode>,
);
