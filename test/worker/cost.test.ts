// The daily cost cap (Requirements 3.6, 11.5, 11.6, 11.7): reserve on local D1, and the 503 on every model route
// through the router, with the outbound Meta calls mocked (no live API calls).
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import image from "../fixtures/meta/smoke-image.json";              // Muse Image's real reply (1×1 PNG)
import boxes from "../fixtures/meta/point-line-drawing.json";      // hand-built Spark box reply
import sam from "../fixtures/meta/smoke-sam.json";                  // SAM's real reply for "house"
import scene from "../fixtures/meta/understand-line-drawing.json";  // Spark's real scene reply
import { CAP_REACHED, capMicro, COST_MICRO, reserve, reserveCall, utcDay, type CostKind } from "../../worker/cost";
import { png } from "./helpers";

// Every test here runs on its own UTC day in 2001, so its usage row is not the one other tests reserve on.
const CAP = capMicro(env.DAILY_COST_CAP_USD);
const noon = (day: string) => Date.parse(`${day}T12:00:00Z`);
const onDay = (day: string) => vi.spyOn(Date, "now").mockReturnValue(noon(day));
const seed = (day: string, micro: number) => env.DB.prepare("INSERT INTO usage (day, spent_micro) VALUES (?1, ?2)").bind(day, micro).run();
const spent = (day: string) => env.DB.prepare("SELECT spent_micro FROM usage WHERE day = ?1").bind(day).first<number>("spent_micro");

// Trailing bytes give this file's understand calls their own checks row (the hash differs from understand.test.ts's).
const drawing = () => new File([new Uint8Array([...png, 0x63, 0x6f, 0x73, 0x74])], "drawing.png");
const multipart = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};
const post = (path: string, body: BodyInit) => exports.default.fetch(new Request(`https://example.com${path}`, { method: "POST", body }));

// Each model route, the estimate it reserves, a valid request and the Meta reply that makes it succeed.
const ROUTES: [string, CostKind, () => BodyInit, unknown][] = [
  ["/api/understand", "spark", () => multipart({ image: drawing() }), scene],
  ["/api/point", "spark", () => multipart({ image: drawing(), objects: JSON.stringify([{ type: "house", noun: "house", count: 1 }]) }), boxes],
  ["/api/segment", "sam", () => multipart({ image: drawing(), noun: "house" }), sam],
  ["/api/backdrop", "image", () => JSON.stringify({ title: "House tree and sun", style: "sketch" }), image],
];

let consoleSpies: MockInstance[] = [];
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM usage WHERE day LIKE '2001-%'").run();
  consoleSpies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn")].map((s) => s.mockImplementation(() => {}));
});
afterEach(() => vi.restoreAllMocks());

it("uses DAILY_COST_CAP_USD × 10⁶ µ$ as the cap, and the fixed estimates from design.md", () => {
  expect(CAP).toBe(5_000_000);    // wrangler.jsonc: "5", raised from "2" for judging week
  expect(COST_MICRO).toEqual({ spark: 10_000, sam: 2_500, image: 10_000 });
});

it.each(ROUTES.map(([path, kind, body, reply], i) => [path, kind, body, reply, `2001-01-0${i + 1}`] as const))(
  "%s reserves its %s estimate before the call and is accepted up to exactly the cap",
  async (path, kind, body, reply, day) => {
    onDay(day);
    await seed(day, CAP - COST_MICRO[kind]);
    // Replies are built inside the mock so their bodies belong to the handler's request context.
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(reply));

    const res = await post(path, body());

    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await spent(day)).toBe(CAP);
  },
);

it.each(ROUTES.map(([path, kind, body], i) => [path, kind, body, `2001-02-0${i + 1}`] as const))(
  "%s replies 503 {mode: 'sample'} with no Meta call when its %s estimate would pass the cap by 1 µ$",
  async (path, kind, body, day) => {
    onDay(day);
    await seed(day, CAP - COST_MICRO[kind] + 1);
    const fetch = vi.spyOn(globalThis, "fetch");

    const res = await post(path, body());

    expect(res.status).toBe(503);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(await res.json()).toEqual({ mode: "sample", error: CAP_REACHED });
    expect(fetch).not.toHaveBeenCalled();
    expect(await spent(day)).toBe(CAP - COST_MICRO[kind] + 1);    // the refused reservation added nothing
  },
);

it("keeps the reservation when the model call fails (Requirement 11.5)", async () => {
  onDay("2001-03-01");
  vi.spyOn(Math, "random").mockReturnValue(0);    // zero backoff jitter keeps metaFetch's retries instant
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("upstream error", { status: 500 }));

  const res = await post("/api/segment", multipart({ image: drawing(), noun: "house" }));

  expect(res.status).toBe(502);
  expect(fetch).toHaveBeenCalledTimes(3);    // metaFetch's own retries are one model call and one reservation
  expect(await spent("2001-03-01")).toBe(COST_MICRO.sam);
});

it("refuses a reservation that would pass the cap and leaves spent_micro unchanged", async () => {
  const day = "2001-04-01";
  await seed(day, 95);

  expect(await reserve(env.DB, day, 10, 100)).toBe(false);
  expect(await spent(day)).toBe(95);
  expect(await reserve(env.DB, day, 5, 100)).toBe(true);    // exactly the cap is allowed
  expect(await spent(day)).toBe(100);
  expect(await reserve(env.DB, day, 1, 100)).toBe(false);
  expect(await spent(day)).toBe(100);
});

it("creates the day's row on its first reservation", async () => {
  expect(await reserve(env.DB, "2001-04-02", 2_500, CAP)).toBe(true);
  expect(await spent("2001-04-02")).toBe(2_500);
});

it("starts a new row at the UTC day boundary", async () => {
  const lastMs = Date.parse("2001-05-01T23:59:59.999Z"), nextMs = lastMs + 1;
  expect([utcDay(lastMs), utcDay(nextMs)]).toEqual(["2001-05-01", "2001-05-02"]);
  await seed("2001-05-01", CAP);

  const refused = await reserveCall(env, "spark", lastMs);
  expect(refused?.status).toBe(503);
  expect(await reserveCall(env, "spark", nextMs)).toBeNull();

  expect(await spent("2001-05-01")).toBe(CAP);
  expect(await spent("2001-05-02")).toBe(COST_MICRO.spark);
});

it.each<[string, string, number]>([
  ["a whole number", "5", 5_000_000],
  ["a decimal", "0.25", 250_000],
  ["micro-dollar precision", "1.000001", 1_000_001],
  ["zero, which refuses every call", "0", 0],
])("reads %s as the cap (%s → %i µ$)", (_, usd, micro) => {
  expect(capMicro(usd)).toBe(micro);
  expect(consoleSpies[1]).not.toHaveBeenCalled();
});

it.each<[string, string | undefined]>([
  ["missing", undefined],
  ["empty", ""],
  ["not a number", "five"],
  ["negative", "-1"],
  ["in exponent form", "1e3"],
  ["with a unit", "5$"],
])("falls back to the $5 default with a warning when DAILY_COST_CAP_USD is %s", (_, usd) => {
  expect(capMicro(usd)).toBe(5_000_000);
  expect(consoleSpies[1]).toHaveBeenCalledTimes(1);
});

it("refuses every call when the cap is 0", async () => {
  expect(await reserveCall({ DB: env.DB, DAILY_COST_CAP_USD: "0" }, "sam", noon("2001-06-01"))).not.toBeNull();
  expect(await spent("2001-06-01")).toBe(0);
});
