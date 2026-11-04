/** Isolated browser contract fixtures; no Worker, credentials or deployed data. */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dshSource } from "./vite.config.ts";

export default defineConfig({
  root: fileURLToPath(new URL("./tests/parity", import.meta.url)),
  plugins: [dshSource(), react()],
  resolve: { dedupe: ["react", "react-dom"] },
  server: { host: "127.0.0.1", fs: { allow: [fileURLToPath(new URL("../../", import.meta.url))] } },
  define: { "process.env.DSH_CLIENT_TITLE": JSON.stringify("DSH parity fixture") },
  build: { outDir: fileURLToPath(new URL("./dist/parity", import.meta.url)), emptyOutDir: true },
});
