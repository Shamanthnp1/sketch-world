import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      // Browser-side pure code (layout, collide, threshold, assign, schemas) in Node.
      { test: { name: "browser", include: ["test/{unit,property}/**/*.test.ts"] } },
      // Worker code inside workerd with local D1/R2 from wrangler.jsonc.
      {
        plugins: [cloudflareTest(async () => ({
          wrangler: { configPath: "./wrangler.jsonc" },
          miniflare: {
            bindings: {
              // Fake key that overrides the real one wrangler loads from .dev.vars.
              MODEL_API_KEY: "test-only-model-api-key",
              // Test-only binding; test/worker/apply-migrations.ts applies these to DB.
              TEST_MIGRATIONS: await readD1Migrations("./migrations"),
            },
          },
        }))],
        test: { name: "worker", include: ["test/worker/**/*.test.ts"], setupFiles: ["./test/worker/apply-migrations.ts"] },
      },
    ],
  },
});
