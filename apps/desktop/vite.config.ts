import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The React frontend is served by Vite in dev and bundled into the Tauri
// webview in production. It talks to the control plane over HTTP + WebSocket
// (see `VITE_CONTROL_URL`), never importing Node-only workspace packages.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
});
