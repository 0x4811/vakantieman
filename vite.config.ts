import { defineConfig } from "vite";
import { resolve } from "node:path";

// Hoofdbuild: beheer, presentatie, afstandsbediening en stempagina.
// De offline-speler heeft een eigen config (vite.offline.config.ts).
export default defineConfig({
  root: "src/web",
  publicDir: false,
  build: {
    outDir: resolve(__dirname, "dist/web"),
    emptyOutDir: true,
    target: "es2022",
    rollupOptions: {
      input: {
        admin: resolve(__dirname, "src/web/admin.html"),
        present: resolve(__dirname, "src/web/present.html"),
        control: resolve(__dirname, "src/web/control.html"),
        vote: resolve(__dirname, "src/web/vote.html")
      }
    }
  }
});
