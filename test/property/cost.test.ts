import fc from "fast-check";
import { describe, expect, it } from "vitest";

// A model of reserve (worker/cost.ts). That file is not imported here: it names the workerd types D1Database and
// Env, which the browser tsconfig does not have, so `npm run typecheck` fails on it. test/worker/cost-concurrency.test.ts
// checks the same property on reserve's real SQL in local D1.

/** COST_MICRO's spark, sam and image estimates in µ$ (test/worker/cost.test.ts pins them in worker/cost.ts). */
const COSTS = [10_000, 2_500, 10_000];

/** `UPDATE usage SET spent_micro = spent_micro + micro WHERE day = ? AND spent_micro + micro <= cap`, one atomic step. */
const applyReserve = (spent: number, micro: number, cap: number) =>
  spent + micro <= cap ? { spent: spent + micro, ok: true } : { spent, ok: false };

/** reserve's batch on a model usage table: INSERT OR IGNORE the day's row at 0, then the conditional UPDATE. */
function reserveModel(usage: Map<string, number>, day: string, micro: number, cap: number): boolean {
  const { spent, ok } = applyReserve(usage.get(day) ?? 0, micro, cap);
  usage.set(day, spent);
  return ok;
}

const DAYS = ["2026-10-27", "2026-10-28", "2026-10-29"];

// A cap of 0 (refuses everything), an exact multiple of the 2 500 µ$ SAM estimate (so estimates can fill it exactly),
// any cap up to $0.20, or the $5 default. noBias keeps the uniform picks from crowding at the edges, which mostly
// gives runs where every reservation is refused.
const capArb = fc.oneof(
  { arbitrary: fc.constant(0), weight: 1 }, { arbitrary: fc.integer({ min: 1, max: 40 }).map((k) => k * 2_500), weight: 4 },
  { arbitrary: fc.noBias(fc.integer({ min: 0, max: 200_000 })), weight: 4 }, { arbitrary: fc.constant(5_000_000), weight: 1 },
);
const costArb = fc.oneof(fc.constantFrom(...COSTS), fc.integer({ min: 1, max: 20_000 }));
// A day's starting spent_micro: no row yet (null), anything up to the cap, the cap itself, or a few estimates short of it.
const startArb = (cap: number) => fc.oneof(
  { arbitrary: fc.constant(null), weight: 2 }, { arbitrary: fc.noBias(fc.integer({ min: 0, max: cap })), weight: 4 },
  { arbitrary: fc.constant(cap), weight: 1 }, { arbitrary: fc.integer({ min: 1, max: 8 }).map((k) => Math.max(0, cap - k * 2_500)), weight: 2 },
);

// Requests on up to 3 days that arrive at once. D1 runs each request's UPDATE atomically, so any run of them is some
// order of whole UPDATEs: `order` is a random permutation of the requests.
const scenarioArb = capArb.chain((cap) => fc.record({
  cap: fc.constant(cap),
  starts: fc.tuple(...DAYS.map(() => startArb(cap))),
  requests: fc.array(fc.record({ day: fc.nat(DAYS.length - 1), micro: costArb }), { minLength: 1, maxLength: 60 }),
})).chain((s) => fc.record({
  s: fc.constant(s),
  order: fc.shuffledSubarray(s.requests.map((_, i) => i), { minLength: s.requests.length, maxLength: s.requests.length }),
}));

describe("Feature: sketch-world, Property 7: Cost accounting never exceeds the daily cap", () => {
  // **Validates: Requirements 11.5, 11.6**
  it("accepts a reservation exactly when it fits under the cap, in any interleaving, and keeps every day at most the cap", () => {
    fc.assert(fc.property(scenarioArb, ({ s: { cap, starts, requests }, order }) => {
      const usage = new Map<string, number>();
      starts.forEach((start, d) => { if (start !== null) usage.set(DAYS[d], start); });
      const accepted = DAYS.map(() => 0), refused: number[][] = DAYS.map(() => []);

      for (const i of order) {
        const { day: d, micro } = requests[i];
        const before = DAYS.map((k) => usage.get(k));
        const spent = before[d] ?? 0; // a day with no row starts at 0
        const ok = reserveModel(usage, DAYS[d], micro, cap);
        expect(ok).toBe(spent + micro <= cap);
        expect(usage.get(DAYS[d])).toBe(ok ? spent + micro : spent); // a refused reservation adds nothing
        DAYS.forEach((k, e) => { if (e !== d) expect(usage.get(k)).toBe(before[e]); }); // other days are untouched
        for (const v of usage.values()) expect(v).toBeLessThanOrEqual(cap);
        if (ok) accepted[d] += micro; else refused[d].push(micro);
      }

      DAYS.forEach((k, d) => {
        const final = usage.get(k) ?? 0;
        expect(final).toBe((starts[d] ?? 0) + accepted[d]);
        expect(final).toBeLessThanOrEqual(cap);
        // spent only grows, so each refused reservation still does not fit at the end, whatever the order.
        for (const micro of refused[d]) expect(final + micro).toBeGreaterThan(cap);
      });
    }), { numRuns: 1000 });
  });
});
