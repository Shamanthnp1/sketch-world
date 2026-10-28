// Property 7 on reserve's real SQL: concurrent reservations on local D1. test/property/cost.test.ts runs the model.
import { env } from "cloudflare:workers";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { COST_MICRO, reserve, utcDay } from "../../worker/cost";

// Every run, shrinking included, reserves on its own UTC day counted up from 1900-01-01, years no other test uses.
const DAY0 = Date.UTC(1900, 0, 1), DAY_MS = 86_400_000;
let runs = 0;
const freshDay = () => utcDay(DAY0 + runs++ * DAY_MS);

// The generators of test/property/cost.test.ts: caps of 0, multiples of 2 500 µ$, up to $0.20 or $5; costs from
// COST_MICRO or 1–20 000 µ$. About half the runs mix accepted and refused calls; the rest accept or refuse all.
const capArb = fc.oneof(
  { arbitrary: fc.constant(0), weight: 1 }, { arbitrary: fc.integer({ min: 1, max: 40 }).map((k) => k * 2_500), weight: 4 },
  { arbitrary: fc.noBias(fc.integer({ min: 0, max: 200_000 })), weight: 4 }, { arbitrary: fc.constant(5_000_000), weight: 1 },
);
const costArb = fc.oneof(fc.constantFrom(...Object.values(COST_MICRO)), fc.integer({ min: 1, max: 20_000 }));
const caseArb = capArb.chain((cap) => fc.record({
  cap: fc.constant(cap),
  // null: no row yet, so the concurrent INSERT OR IGNOREs create it. Otherwise a seeded spent_micro ≤ cap.
  start: fc.oneof(
    { arbitrary: fc.constant(null), weight: 2 }, { arbitrary: fc.noBias(fc.integer({ min: 0, max: cap })), weight: 4 },
    { arbitrary: fc.constant(cap), weight: 1 }, { arbitrary: fc.integer({ min: 1, max: 8 }).map((k) => Math.max(0, cap - k * 2_500)), weight: 2 },
  ),
  micros: fc.array(costArb, { minLength: 2, maxLength: 40 }),
}));

beforeAll(async () => {
  await env.DB.prepare("DELETE FROM usage WHERE day < '2000'").run();
});

describe("Feature: sketch-world, Property 7: Cost accounting never exceeds the daily cap", () => {
  // **Validates: Requirements 11.5, 11.6**
  it("keeps one day's total at most the cap when 2–40 reservations run at once, and refuses only those that do not fit", async () => {
    await fc.assert(fc.asyncProperty(caseArb, async ({ cap, start, micros }) => {
      const day = freshDay();
      if (start !== null) await env.DB.prepare("INSERT INTO usage (day, spent_micro) VALUES (?1, ?2)").bind(day, start).run();

      const ok = await Promise.all(micros.map((micro) => reserve(env.DB, day, micro, cap)));

      const final = await env.DB.prepare("SELECT spent_micro FROM usage WHERE day = ?1").bind(day).first<number>("spent_micro");
      const accepted = micros.reduce((sum, micro, i) => (ok[i] ? sum + micro : sum), 0);
      expect(final).toBe((start ?? 0) + accepted);
      expect(final!).toBeLessThanOrEqual(cap);
      // D1 ran the UPDATEs in some order we cannot see. spent_micro only grows, so in every order a refused call
      // still does not fit at the end: final + micro > cap. (If all calls fit, this forces every call to be accepted.)
      micros.forEach((micro, i) => { if (!ok[i]) expect(final! + micro).toBeGreaterThan(cap); });
    }), { numRuns: 100 }); // about 1.5 s on local D1, so the design's 100 runs per property fit here too
  }, 60_000);
});
