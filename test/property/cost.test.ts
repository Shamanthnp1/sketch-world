import fc from "fast-check";
import { describe, expect, it } from "vitest";

// A model of reserve (worker/cost.ts). That file is not imported here: it names the workerd types D1Database and
// Env, which the browser tsconfig does not have, so `npm run typecheck` fails on it. test/worker/cost-concurrency.test.ts
// checks the same property on reserve's real SQL in local D1.

/** COST_MICRO's spark, sam and image estimates in µ$ (test/worker/cost.test.ts pins them in worker/cost.ts). */
const COSTS = [10_000, 2_500, 10_000];
const DAYS = ["2026-10-27", "2026-10-28", "2026-10-29"];
const CLIENTS = ["203.0.113.7", "2001:db8:1:2::/64", "no-ip"];
type Result = "ok" | "daily" | "visitor";

/**
 * reserve's batch, one atomic step, on a model of the `usage` (day → µ$) and `usage_ip` ("day client" → µ$) tables:
 * INSERT OR IGNORE both rows at 0; UPDATE usage_ip when the client's total + micro ≤ clientCap and the day's
 * total + micro ≤ cap; UPDATE usage when that UPDATE changed its row (changes() = 1) and the day's total + micro ≤ cap.
 */
function reserveModel(usage: Map<string, number>, usageIp: Map<string, number>, day: string, client: string, micro: number, cap: number, clientCap: number): Result {
  const key = `${day} ${client}`, total = usage.get(day) ?? 0, mine = usageIp.get(key) ?? 0;
  const changed = mine + micro <= clientCap && total + micro <= cap;
  usageIp.set(key, changed ? mine + micro : mine);
  const counted = changed && total + micro <= cap;
  usage.set(day, counted ? total + micro : total);
  if (changed && counted) return "ok";
  return total + micro > cap ? "daily" : "visitor";
}

// A cap of 0 (refuses everything), an exact multiple of the 2 500 µ$ SAM estimate (so estimates can fill it exactly),
// any cap up to $0.20, or the $5 default. noBias keeps the uniform picks from crowding at the edges, which mostly
// gives runs where every reservation is refused. The Daily_Cap and the Client_Cap are drawn on their own, so either
// one can be the one that binds.
const capArb = fc.oneof(
  { arbitrary: fc.constant(0), weight: 1 }, { arbitrary: fc.integer({ min: 1, max: 40 }).map((k) => k * 2_500), weight: 4 },
  { arbitrary: fc.noBias(fc.integer({ min: 0, max: 200_000 })), weight: 4 }, { arbitrary: fc.constant(5_000_000), weight: 1 },
);
const costArb = fc.oneof(fc.constantFrom(...COSTS), fc.integer({ min: 1, max: 20_000 }));
// A starting spent_micro: no row yet (null), anything up to the cap, the cap itself, or a few estimates short of it.
const startArb = (cap: number) => fc.oneof(
  { arbitrary: fc.constant(null), weight: 2 }, { arbitrary: fc.noBias(fc.integer({ min: 0, max: cap })), weight: 4 },
  { arbitrary: fc.constant(cap), weight: 1 }, { arbitrary: fc.integer({ min: 1, max: 8 }).map((k) => Math.max(0, cap - k * 2_500)), weight: 2 },
);

// Requests by up to 3 clients on up to 3 days that arrive at once. D1 runs each request's batch atomically, so any
// run of them is some order of whole batches: `order` is a random permutation of the requests.
const scenarioArb = fc.tuple(capArb, capArb).chain(([cap, clientCap]) => fc.record({
  cap: fc.constant(cap),
  clientCap: fc.constant(clientCap),
  starts: fc.tuple(...DAYS.map(() => startArb(cap))),
  clientStarts: fc.tuple(...DAYS.flatMap(() => CLIENTS.map(() => startArb(clientCap)))),    // day d, client c at 3d + c
  requests: fc.array(fc.record({ day: fc.nat(DAYS.length - 1), client: fc.nat(CLIENTS.length - 1), micro: costArb }), { minLength: 1, maxLength: 60 }),
})).chain((s) => fc.record({
  s: fc.constant(s),
  order: fc.shuffledSubarray(s.requests.map((_, i) => i), { minLength: s.requests.length, maxLength: s.requests.length }),
}));

describe("Feature: sketch-world, Property 7: Cost accounting never exceeds the daily cap", () => {
  // **Validates: Requirements 11.5, 11.6**
  it("accepts a reservation exactly when it fits under both the Daily_Cap and the Client_Cap, in any interleaving, and keeps every total at most its cap", () => {
    fc.assert(fc.property(scenarioArb, ({ s: { cap, clientCap, starts, clientStarts, requests }, order }) => {
      const usage = new Map<string, number>(), usageIp = new Map<string, number>();
      const ipKey = (d: number, c: number) => `${DAYS[d]} ${CLIENTS[c]}`;
      starts.forEach((start, d) => { if (start !== null) usage.set(DAYS[d], start); });
      clientStarts.forEach((start, k) => { if (start !== null) usageIp.set(ipKey(Math.floor(k / 3), k % 3), start); });
      const startOf = (d: number, c: number) => clientStarts[3 * d + c] ?? 0;
      const accepted = DAYS.map(() => 0), acceptedBy = DAYS.map(() => CLIENTS.map(() => 0));
      const refused: { d: number; c: number; micro: number; result: Result }[] = [];

      for (const i of order) {
        const { day: d, client: c, micro } = requests[i];
        const before = new Map(usage), beforeIp = new Map(usageIp);
        const total = usage.get(DAYS[d]) ?? 0, mine = usageIp.get(ipKey(d, c)) ?? 0; // no row yet: 0
        const result = reserveModel(usage, usageIp, DAYS[d], CLIENTS[c], micro, cap, clientCap);
        const ok = result === "ok";
        expect(ok).toBe(total + micro <= cap && mine + micro <= clientCap);
        if (!ok) expect(result).toBe(total + micro > cap ? "daily" : "visitor"); // the Daily_Cap is named first
        // Both totals grow by micro together, or a refused reservation changes neither.
        expect(usage.get(DAYS[d])).toBe(ok ? total + micro : total);
        expect(usageIp.get(ipKey(d, c))).toBe(ok ? mine + micro : mine);
        for (const [k, v] of before) if (k !== DAYS[d]) expect(usage.get(k)).toBe(v); // other days are untouched
        for (const [k, v] of beforeIp) if (k !== ipKey(d, c)) expect(usageIp.get(k)).toBe(v); // and other clients
        for (const v of usage.values()) expect(v).toBeLessThanOrEqual(cap);
        for (const v of usageIp.values()) expect(v).toBeLessThanOrEqual(clientCap);
        if (ok) { accepted[d] += micro; acceptedBy[d][c] += micro; } else refused.push({ d, c, micro, result });
      }

      DAYS.forEach((day, d) => {
        const final = usage.get(day) ?? 0;
        expect(final).toBe((starts[d] ?? 0) + accepted[d]);
        expect(final).toBeLessThanOrEqual(cap);
        CLIENTS.forEach((_, c) => {
          const mine = usageIp.get(ipKey(d, c)) ?? 0;
          expect(mine).toBe(startOf(d, c) + acceptedBy[d][c]);
          expect(mine).toBeLessThanOrEqual(clientCap);
        });
      });
      // Totals only grow, so each refused reservation still does not fit at the end under the cap that refused it.
      for (const { d, c, micro, result } of refused) {
        if (result === "daily") expect((usage.get(DAYS[d]) ?? 0) + micro).toBeGreaterThan(cap);
        else expect((usageIp.get(ipKey(d, c)) ?? 0) + micro).toBeGreaterThan(clientCap);
      }
    }), { numRuns: 1000 });
  });
});
