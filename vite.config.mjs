import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const base = process.env.VITE_APP_BASE_PATH?.trim() || "/";

// El .env local trae NODE_ENV=development para la API. Vite lo lee y `vite build` generaría un
// bundle de desarrollo (React con StrictMode ejecuta cada efecto dos veces y pesa más). Vite solo
// toma ese valor si VITE_USER_NODE_ENV está sin definir: dejarlo vacío mantiene el build de
// producción. VITE_ALLOW_DEV_BUILD=true permite un build de desarrollo a propósito.
if (process.argv.includes("build") && !process.env.VITE_ALLOW_DEV_BUILD) {
  process.env.VITE_USER_NODE_ENV = "";
}

export default defineConfig({
  base,
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local", "localhost"],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
    warmup: {
      clientFiles: ["./src/main.tsx"],
    },
  },
  plugins: [react()],
});
