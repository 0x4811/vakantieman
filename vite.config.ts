import { defineConfig } from "vite";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// Hoofdbuild voor de beveiligde Worker: beheer, presentatie en afstandsbediening.
// De stempagina (publieke Worker) en de offline-speler hebben eigen configs.
const pages = ["admin", "present", "control"];
const input = Object.fromEntries(
  pages
    .filter((name) => existsSync(resolve(__dirname, `src/web/${name}.html`)))
    .map((name) => [name, resolve(__dirname, `src/web/${name}.html`)])
);

export default defineConfig({
  root: "src/web",
  publicDir: false,
  build: {
    outDir: resolve(__dirname, "dist/web"),
    emptyOutDir: true,
    target: "es2022",
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input }
  }
});
