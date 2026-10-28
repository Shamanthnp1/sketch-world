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
            // The route tests send far more than 6 requests a minute, all with the same key (no CF-Connecting-IP),
            // so the local limiters get a limit no test reaches. The real limits stay in wrangler.jsonc;
            // test/worker/rate.test.ts stubs limit() to test the 429 path.
            ratelimits: Object.fromEntries(["RL_UNDERSTAND", "RL_POINT", "RL_SEGMENT", "RL_BACKDROP", "RL_SAVE"]
              .map((name) => [name, { namespace_id: name, simple: { limit: 1_000_000, period: 60 as const } }])),
          },
        }))],
        test: { name: "worker", include: ["test/worker/**/*.test.ts"], setupFiles: ["./test/worker/apply-migrations.ts"] },
      },
    ],
  },
});
