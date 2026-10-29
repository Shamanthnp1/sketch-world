// The daily cost caps (Requirements 3.6, 11.5, 11.6, 11.7): reserve on local D1, and the 503 on every model route
// through the router, with the outbound Meta calls mocked (no live API calls).
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import image from "../fixtures/meta/smoke-image.json";              // Muse Image's real reply (1×1 PNG)
import boxes from "../fixtures/meta/point-line-drawing.json";      // hand-built Spark box reply
import sam from "../fixtures/meta/smoke-sam.json";                  // SAM's real reply for "house"
import scene from "../fixtures/meta/understand-line-drawing.json";  // Spark's real scene reply
import {
  CAP_REACHED, capMicro, CLIENT_CAP_REACHED, clientCapMicro, COST_MICRO, reserve, reserveCall, utcDay, type CostKind,
} from "../../worker/cost";
import { sha256Hex } from "../../worker/crypto";
import { png } from "./helpers";

// Every test here runs on its own UTC day in 2001, so its usage rows are not the ones other tests reserve on.
const CAP = capMicro(env.DAILY_COST_CAP_USD), CLIENT_CAP = clientCapMicro(env.PER_IP_DAILY_USD);
const IP = "203.0.113.9";    // the CF-Connecting-IP of every route request here, so its Client_Key
const noon = (day: string) => Date.parse(`${day}T12:00:00Z`);
const onDay = (day: string) => vi.spyOn(Date, "now").mockReturnValue(noon(day));
const seed = (day: string, micro: number) => env.DB.prepare("INSERT INTO usage (day, spent_micro) VALUES (?1, ?2)").bind(day, micro).run();
const spent = (day: string) => env.DB.prepare("SELECT spent_micro FROM usage WHERE day = ?1").bind(day).first<number>("spent_micro");
const seedClient = (day: string, client: string, micro: number) =>
  env.DB.prepare("INSERT INTO usage_ip (day, client, spent_micro) VALUES (?1, ?2, ?3)").bind(day, client, micro).run();
const spentBy = (day: string, client: string) =>
  env.DB.prepare("SELECT spent_micro FROM usage_ip WHERE day = ?1 AND client = ?2").bind(day, client).first<number>("spent_micro");
const visitor = (ip?: string) => new Request("https://example.com/api/segment", { method: "POST", headers: ip ? { "CF-Connecting-IP": ip } : {} });
/** reserveCall's env with these vars changed. */
const vars = (over: { DAILY_COST_CAP_USD?: string; PER_IP_DAILY_USD?: string } = {}) =>
  ({ DB: env.DB, DAILY_COST_CAP_USD: env.DAILY_COST_CAP_USD, PER_IP_DAILY_USD: env.PER_IP_DAILY_USD, ...over });

// Trailing bytes give this file's understand calls their own checks row (the hash differs from understand.test.ts's).
const drawingBytes = new Uint8Array([...png, 0x63, 0x6f, 0x73, 0x74]);
const drawing = () => new File([drawingBytes], "drawing.png");
const multipart = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};
const post = (path: string, body: BodyInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, { method: "POST", body, headers: { "CF-Connecting-IP": IP } }));

// Each model route, the estimate it reserves, a valid request and the Meta reply that makes it succeed.
const ROUTES: [string, CostKind, () => BodyInit, unknown][] = [
  ["/api/understand", "spark", () => multipart({ image: drawing() }), scene],
  ["/api/point", "spark", () => multipart({ image: drawing(), objects: JSON.stringify([{ type: "house", noun: "house", count: 1 }]) }), boxes],
  ["/api/segment", "sam", () => multipart({ image: drawing(), noun: "house" }), sam],
  ["/api/backdrop", "image", () => JSON.stringify({ title: "House tree and sun", style: "sketch" }), image],
];
/** ROUTES with a day of `month` in 2001 each. */
const onDays = (month: string) => ROUTES.map(([path, kind, body, reply], i) => [path, kind, body, reply, `2001-${month}-0${i + 1}`] as const);
const timeout = () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); };

let consoleSpies: MockInstance[] = [];
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM usage WHERE day LIKE '2001-%'"),
    env.DB.prepare("DELETE FROM usage_ip WHERE day LIKE '2001-%'"),
  ]);
  // The safe Checks_Row /api/understand writes for the drawing, so point and segment pass their safe gate (12.9).
  await env.DB.prepare("INSERT OR REPLACE INTO checks (sha256, safe, created_at) VALUES (?1, 1, ?2)").bind(await sha256Hex(drawingBytes), Date.now()).run();
  consoleSpies = [vi.spyOn(console, "log"), vi.spyOn(console, "warn")].map((s) => s.mockImplementation(() => {}));
});
afterEach(() => vi.restoreAllMocks());

it("uses DAILY_COST_CAP_USD and PER_IP_DAILY_USD × 10⁶ µ$ as the caps, and the fixed estimates from design.md", () => {
  expect(CAP).toBe(5_000_000);           // wrangler.jsonc: "5", raised from "2" for judging week
  expect(CLIENT_CAP).toBe(500_000);      // wrangler.jsonc: "0.5"
  expect(COST_MICRO).toEqual({ spark: 10_000, sam: 2_500, image: 10_000 });
});

it.each(onDays("01"))(
  "%s reserves its %s estimate before the call and is accepted up to exactly both caps",
  async (path, kind, body, reply, day) => {
    onDay(day);
    await seed(day, CAP - COST_MICRO[kind]);
    await seedClient(day, IP, CLIENT_CAP - COST_MICRO[kind]);
    // Replies are built inside the mock so their bodies belong to the handler's request context.
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(reply));

    const res = await post(path, body());

    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await spent(day)).toBe(CAP);
    expect(await spentBy(day, IP)).toBe(CLIENT_CAP);
  },
);

it.each(onDays("02"))(
  "%s replies 503 {mode: 'sample', reason: 'daily'} with no Meta call when its %s estimate would pass the Daily_Cap by 1 µ$",
  async (path, kind, body, _, day) => {
    onDay(day);
    await seed(day, CAP - COST_MICRO[kind] + 1);
    await seedClient(day, IP, 40_000);
    const fetch = vi.spyOn(globalThis, "fetch");

    const res = await post(path, body());

    expect(res.status).toBe(503);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(await res.json()).toEqual({ mode: "sample", reason: "daily", error: CAP_REACHED });
    expect(fetch).not.toHaveBeenCalled();
    expect(await spent(day)).toBe(CAP - COST_MICRO[kind] + 1);    // the refused reservation added nothing
    expect(await spentBy(day, IP)).toBe(40_000);                   // to either total
  },
);

it.each(onDays("07"))(
  "%s replies 503 {mode: 'sample', reason: 'visitor'} with no Meta call when its %s estimate would pass the Client_Cap by 1 µ$",
  async (path, kind, body, _, day) => {
    onDay(day);
    await seed(day, 1_000_000);
    await seedClient(day, IP, CLIENT_CAP - COST_MICRO[kind] + 1);
    const fetch = vi.spyOn(globalThis, "fetch");

    const res = await post(path, body());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ mode: "sample", reason: "visitor", error: CLIENT_CAP_REACHED });
    expect(fetch).not.toHaveBeenCalled();
    expect(await spent(day)).toBe(1_000_000);
    expect(await spentBy(day, IP)).toBe(CLIENT_CAP - COST_MICRO[kind] + 1);
  },
);

it("keeps the reservation when the model call fails (Requirement 11.5)", async () => {
  onDay("2001-03-01");
  vi.spyOn(Math, "random").mockReturnValue(0);    // zero backoff jitter keeps metaFetch's retries instant
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("upstream error", { status: 500 }));

  const res = await post("/api/segment", multipart({ image: drawing(), noun: "house" }));

  expect(res.status).toBe(502);
  expect(fetch).toHaveBeenCalledTimes(3);    // 5xx retries are one model call and one reservation
  expect(await spent("2001-03-01")).toBe(COST_MICRO.sam);
  expect(await spentBy("2001-03-01", IP)).toBe(COST_MICRO.sam);
});

it.each(onDays("08"))(
  "%s reserves its %s estimate again before retrying a timed-out call (a timeout, then success: 2 reservations)",
  async (path, kind, body, reply, day) => {
    onDay(day);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => timeout()).mockImplementation(async () => Response.json(reply));

    const res = await post(path, body());

    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await spent(day)).toBe(2 * COST_MICRO[kind]);
    expect(await spentBy(day, IP)).toBe(2 * COST_MICRO[kind]);
  },
);

it.each(onDays("09"))(
  "%s replies 503 {mode: 'sample'} with no second Meta call when the re-reservation after a timeout is refused",
  async (path, kind, body, _, day) => {
    onDay(day);
    vi.spyOn(Math, "random").mockReturnValue(0);
    await seedClient(day, IP, CLIENT_CAP - COST_MICRO[kind]);    // room for the first attempt only
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => timeout());

    const res = await post(path, body());

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ mode: "sample", reason: "visitor", error: CLIENT_CAP_REACHED });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await spent(day)).toBe(COST_MICRO[kind]);
    expect(await spentBy(day, IP)).toBe(CLIENT_CAP);
  },
);

it("keeps one reservation when a 503 reply is retried (a 503, then success)", async () => {
  onDay("2001-03-02");
  vi.spyOn(Math, "random").mockReturnValue(0);
  const fetch = vi.spyOn(globalThis, "fetch")
    .mockImplementationOnce(async () => new Response("busy", { status: 503 })).mockImplementation(async () => Response.json(sam));

  const res = await post("/api/segment", multipart({ image: drawing(), noun: "house" }));

  expect(res.status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(await spent("2001-03-02")).toBe(COST_MICRO.sam);
});

it("refuses a reservation that would pass the Daily_Cap and leaves both totals unchanged", async () => {
  const day = "2001-04-01";
  await seed(day, 95);

  expect(await reserve(env.DB, day, "a", 10, 100, 1_000)).toBe("daily");
  expect([await spent(day), await spentBy(day, "a")]).toEqual([95, 0]);
  expect(await reserve(env.DB, day, "a", 5, 100, 1_000)).toBe("ok");    // exactly the cap is allowed
  expect([await spent(day), await spentBy(day, "a")]).toEqual([100, 5]);
  expect(await reserve(env.DB, day, "b", 1, 100, 1_000)).toBe("daily");
  expect([await spent(day), await spentBy(day, "b")]).toEqual([100, 0]);
});

it("refuses a reservation that would pass the Client_Cap and leaves both totals unchanged; other clients are independent", async () => {
  const day = "2001-04-03";
  await seedClient(day, "a", 45);

  expect(await reserve(env.DB, day, "a", 10, 1_000, 50)).toBe("visitor");
  expect([await spent(day), await spentBy(day, "a")]).toEqual([0, 45]);
  expect(await reserve(env.DB, day, "a", 5, 1_000, 50)).toBe("ok");    // exactly the Client_Cap is allowed
  expect(await reserve(env.DB, day, "b", 50, 1_000, 50)).toBe("ok");   // b has its own budget
  expect(await reserve(env.DB, day, "a", 1, 1_000, 50)).toBe("visitor");
  expect([await spent(day), await spentBy(day, "a"), await spentBy(day, "b")]).toEqual([55, 50, 50]);
});

it("names the Daily_Cap when both caps would be passed", async () => {
  const day = "2001-04-04";
  await seed(day, 100);
  await seedClient(day, "a", 50);
  expect(await reserve(env.DB, day, "a", 1, 100, 50)).toBe("daily");
});

it("creates the day's rows on its first reservation", async () => {
  expect(await reserve(env.DB, "2001-04-02", "a", 2_500, CAP, CLIENT_CAP)).toBe("ok");
  expect([await spent("2001-04-02"), await spentBy("2001-04-02", "a")]).toEqual([2_500, 2_500]);
});

it("counts an IPv4 client by its address and a request without CF-Connecting-IP as no-ip", async () => {
  const day = "2001-04-05", now = noon(day);
  expect(await reserveCall(env, "sam", visitor("198.51.100.4"), now)).toBeNull();
  expect(await reserveCall(env, "sam", visitor(), now)).toBeNull();
  const { results } = await env.DB.prepare("SELECT client, spent_micro FROM usage_ip WHERE day = ?1 ORDER BY client").bind(day).all();
  expect(results).toEqual([{ client: "198.51.100.4", spent_micro: 2_500 }, { client: "no-ip", spent_micro: 2_500 }]);
});

it("gives two IPv6 addresses in one /64 one budget, and another /64 its own", async () => {
  const day = "2001-04-06", now = noon(day), small = vars({ PER_IP_DAILY_USD: "0.01" });    // one Spark call
  expect(await reserveCall(small, "spark", visitor("2001:db8:1:2::1"), now)).toBeNull();
  const refused = await reserveCall(small, "spark", visitor("2001:DB8:1:2:ffff::2"), now);
  expect(refused?.status).toBe(503);
  expect(await refused?.json()).toMatchObject({ reason: "visitor" });
  expect(await reserveCall(small, "spark", visitor("2001:db8:1:3::1"), now)).toBeNull();
  expect([await spentBy(day, "2001:db8:1:2::/64"), await spentBy(day, "2001:db8:1:3::/64"), await spent(day)]).toEqual([10_000, 10_000, 20_000]);
});

it("starts new rows at the UTC day boundary", async () => {
  const lastMs = Date.parse("2001-05-01T23:59:59.999Z"), nextMs = lastMs + 1;
  expect([utcDay(lastMs), utcDay(nextMs)]).toEqual(["2001-05-01", "2001-05-02"]);
  await seed("2001-05-01", CAP);

  const refused = await reserveCall(env, "spark", visitor(IP), lastMs);
  expect(refused?.status).toBe(503);
  expect(await reserveCall(env, "spark", visitor(IP), nextMs)).toBeNull();

  expect(await spent("2001-05-01")).toBe(CAP);
  expect(await spent("2001-05-02")).toBe(COST_MICRO.spark);
  expect([await spentBy("2001-05-01", IP), await spentBy("2001-05-02", IP)]).toEqual([0, COST_MICRO.spark]);
});

it.each<[string, string, number]>([
  ["a whole number", "5", 5_000_000],
  ["a decimal", "0.25", 250_000],
  ["micro-dollar precision", "1.000001", 1_000_001],
  ["zero, which refuses every call", "0", 0],
])("reads %s as the cap (%s → %i µ$)", (_, usd, micro) => {
  expect(capMicro(usd)).toBe(micro);
  expect(clientCapMicro(usd)).toBe(micro);
  expect(consoleSpies[1]).not.toHaveBeenCalled();
});

it.each<[string, string | undefined]>([
  ["missing", undefined],
  ["empty", ""],
  ["not a number", "five"],
  ["negative", "-1"],
  ["in exponent form", "1e3"],
  ["with a unit", "5$"],
])("falls back to the $5 and $0.50 defaults with a warning when the cap var is %s", (_, usd) => {
  expect(capMicro(usd)).toBe(5_000_000);
  expect(clientCapMicro(usd)).toBe(500_000);
  expect(consoleSpies[1]).toHaveBeenCalledTimes(2);
  expect(String(consoleSpies[1]!.mock.calls[1]![0])).toContain("PER_IP_DAILY_USD");
});

it("refuses every call when either cap is 0", async () => {
  expect(await reserveCall(vars({ DAILY_COST_CAP_USD: "0" }), "sam", visitor(IP), noon("2001-06-01"))).not.toBeNull();
  expect(await reserveCall(vars({ PER_IP_DAILY_USD: "0" }), "sam", visitor(IP), noon("2001-06-01"))).not.toBeNull();
  expect([await spent("2001-06-01"), await spentBy("2001-06-01", IP)]).toEqual([0, 0]);
});
