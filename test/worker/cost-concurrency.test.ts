// Property 7 on reserve's real SQL: concurrent reservations by 2–3 clients on local D1, against the Daily_Cap and
// the Client_Cap. test/property/cost.test.ts runs the model.
import { env } from "cloudflare:workers";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { COST_MICRO, reserve, utcDay } from "../../worker/cost";

// Every run, shrinking included, reserves on its own UTC day counted up from 1900-01-01, years no other test uses.
const DAY0 = Date.UTC(1900, 0, 1), DAY_MS = 86_400_000;
let runs = 0;
const freshDay = () => utcDay(DAY0 + runs++ * DAY_MS);
const CLIENTS = ["203.0.113.7", "2001:db8:1:2::/64", "no-ip"];

// The generators of test/property/cost.test.ts: caps of 0, multiples of 2 500 µ$, up to $0.20 or $5; costs from
// COST_MICRO or 1–20 000 µ$. Each cap is drawn on its own, so either one can be the one that binds.
const capArb = fc.oneof(
  { arbitrary: fc.constant(0), weight: 1 }, { arbitrary: fc.integer({ min: 1, max: 40 }).map((k) => k * 2_500), weight: 4 },
  { arbitrary: fc.noBias(fc.integer({ min: 0, max: 200_000 })), weight: 4 }, { arbitrary: fc.constant(5_000_000), weight: 1 },
);
const costArb = fc.oneof(fc.constantFrom(...Object.values(COST_MICRO)), fc.integer({ min: 1, max: 20_000 }));
// null: no row yet, so the concurrent INSERT OR IGNOREs create it. Otherwise a seeded spent_micro ≤ cap.
const startArb = (cap: number) => fc.oneof(
  { arbitrary: fc.constant(null), weight: 2 }, { arbitrary: fc.noBias(fc.integer({ min: 0, max: cap })), weight: 4 },
  { arbitrary: fc.constant(cap), weight: 1 }, { arbitrary: fc.integer({ min: 1, max: 8 }).map((k) => Math.max(0, cap - k * 2_500)), weight: 2 },
);
const caseArb = fc.tuple(capArb, capArb, fc.integer({ min: 2, max: 3 })).chain(([cap, clientCap, n]) => fc.record({
  cap: fc.constant(cap),
  clientCap: fc.constant(clientCap),
  start: startArb(cap),
  clientStarts: fc.tuple(...CLIENTS.slice(0, n).map(() => startArb(clientCap))),
  calls: fc.array(fc.record({ client: fc.nat(n - 1), micro: costArb }), { minLength: 2, maxLength: 40 }),
}));

const spentOf = async (day: string) => ({
  all: await env.DB.prepare("SELECT spent_micro FROM usage WHERE day = ?1").bind(day).first<number>("spent_micro"),
  by: await Promise.all(CLIENTS.map((c) => env.DB.prepare("SELECT spent_micro FROM usage_ip WHERE day = ?1 AND client = ?2").bind(day, c).first<number>("spent_micro"))),
});

beforeAll(async () => {
  await env.DB.batch([env.DB.prepare("DELETE FROM usage WHERE day < '2000'"), env.DB.prepare("DELETE FROM usage_ip WHERE day < '2000'")]);
});

describe("Feature: sketch-world, Property 7: Cost accounting never exceeds the daily cap", () => {
  // **Validates: Requirements 11.5, 11.6**
  it("keeps the day's total at most the Daily_Cap and each client's at most the Client_Cap when 2–40 reservations by 2–3 clients run at once, and refuses only those that do not fit", async () => {
    await fc.assert(fc.asyncProperty(caseArb, async ({ cap, clientCap, start, clientStarts, calls }) => {
      const day = freshDay();
      if (start !== null) await env.DB.prepare("INSERT INTO usage (day, spent_micro) VALUES (?1, ?2)").bind(day, start).run();
      for (const [c, s] of clientStarts.entries()) {
        if (s !== null) await env.DB.prepare("INSERT INTO usage_ip (day, client, spent_micro) VALUES (?1, ?2, ?3)").bind(day, CLIENTS[c], s).run();
      }

      const results = await Promise.all(calls.map(({ client, micro }) => reserve(env.DB, day, CLIENTS[client]!, micro, cap, clientCap)));

      const { all, by } = await spentOf(day);
      const ok = results.map((r) => r === "ok");
      const accepted = (c?: number) => calls.reduce((sum, call, i) => (ok[i] && (c === undefined || call.client === c) ? sum + call.micro : sum), 0);
      // Both invariants: each total = its start + the accepted reservations, and each total ≤ its cap.
      expect(all).toBe((start ?? 0) + accepted());
      expect(all!).toBeLessThanOrEqual(cap);
      clientStarts.forEach((s, c) => {
        expect(by[c] ?? 0).toBe((s ?? 0) + accepted(c));    // no row: a client with no start and no call
        expect(by[c] ?? 0).toBeLessThanOrEqual(clientCap);
      });
      // D1 ran the batches in some order we cannot see. Totals only grow, so in every order a refused call still
      // does not fit at the end under the cap that refused it.
      calls.forEach(({ client, micro }, i) => {
        if (results[i] === "daily") expect(all! + micro).toBeGreaterThan(cap);
        if (results[i] === "visitor") expect(by[client]! + micro).toBeGreaterThan(clientCap);
      });
    }), { numRuns: 100 });
  }, 60_000);
});
