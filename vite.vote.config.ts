import { defineConfig } from "vite";
import { resolve } from "node:path";

// Build van de publieke stempagina (aparte Worker, aparte map).
export default defineConfig({
  root: "src/web",
  publicDir: false,
  build: {
    outDir: resolve(__dirname, "dist/vote"),
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: resolve(__dirname, "src/web/vote.html") }
  }
});
