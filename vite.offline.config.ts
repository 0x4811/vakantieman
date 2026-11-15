import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";

// Bouwt de offline-speler als één zelfstandig HTML-bestand (alles inline).
export default defineConfig({
  root: "src/web",
  publicDir: false,
  plugins: [viteSingleFile()],
  build: {
    outDir: resolve(__dirname, "dist/web"),
    emptyOutDir: false,
    target: "es2022",
    rollupOptions: {
      input: resolve(__dirname, "src/web/offline-player.html")
    }
  }
});
