import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const base = process.env.VITE_APP_BASE_PATH?.trim() || "/";

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
