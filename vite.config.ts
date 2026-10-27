import { defineConfig } from "vite";

// Worker Static Assets serves dist/ (see wrangler.jsonc).
export default defineConfig({ build: { outDir: "dist" } });
