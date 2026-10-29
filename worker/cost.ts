// The daily cost caps (Requirements 3.6, 11.5, 11.6, 11.7). Before every model call the Worker reserves a fixed
// estimate against the current UTC day's rows in D1: `usage` (every client, the Daily_Cap) and `usage_ip` (the
// request's Client_Key, the Client_Cap). A refused reservation means no model call and a 503 {mode: "sample", reason}.
// A reservation is kept even if the model call then fails.
import { clientKey } from "./limits/client";

/** Fixed estimates per model call in micro-dollars (µ$), from design.md "foldAmount and reserve". */
export const COST_MICRO = { spark: 10_000, sam: 2_500, image: 10_000 } as const;
export type CostKind = keyof typeof COST_MICRO;

/** The Daily_Cap default (Requirements glossary), used when DAILY_COST_CAP_USD is missing or not a number. */
export const DEFAULT_CAP_USD = 5;
/** The Client_Cap default (Requirements glossary), used when PER_IP_DAILY_USD is missing or not a number. */
export const DEFAULT_CLIENT_CAP_USD = 0.5;
export const CAP_REACHED = "Today's budget for new worlds is used up. Sample worlds and the gallery still work; please come back tomorrow.";
export const CLIENT_CAP_REACHED = "You've made a lot of worlds today. Please come back tomorrow, or walk the sample worlds.";

/** Which cap refused a reservation: the Daily_Cap ("daily", also when both would pass) or only the Client_Cap. */
export type Refusal = "daily" | "visitor";

/**
 * Adds `micro` to `day`'s total and to `client`'s total for `day`, only if the day's total stays at most `capMicro`
 * and the client's at most `clientCapMicro`. Returns "ok", or the cap that refused.
 *
 * The batch is one transaction, and D1 runs one at a time, so concurrent reservations cannot pass on a stale total.
 * The client UPDATE checks both caps. The day's UPDATE runs only if the client UPDATE changed its row (changes() is
 * the row count of the statement before it) and checks the Daily_Cap again, so the two totals grow together or not
 * at all, and the Daily_Cap holds even without changes().
 */
export async function reserve(db: D1Database, day: string, client: string, micro: number, capMicro: number, clientCapMicro: number): Promise<"ok" | Refusal> {
  const [, , mine, all, after] = await db.batch<{ spent_micro: number }>([
    db.prepare("INSERT OR IGNORE INTO usage (day, spent_micro) VALUES (?1, 0)").bind(day),
    db.prepare("INSERT OR IGNORE INTO usage_ip (day, client, spent_micro) VALUES (?1, ?2, 0)").bind(day, client),
    db.prepare("UPDATE usage_ip SET spent_micro = spent_micro + ?3 WHERE day = ?1 AND client = ?2 AND spent_micro + ?3 <= ?4"
      + " AND (SELECT spent_micro FROM usage WHERE day = ?1) + ?3 <= ?5").bind(day, client, micro, clientCapMicro, capMicro),
    db.prepare("UPDATE usage SET spent_micro = spent_micro + ?2 WHERE day = ?1 AND changes() = 1 AND spent_micro + ?2 <= ?3").bind(day, micro, capMicro),
    db.prepare("SELECT spent_micro FROM usage WHERE day = ?1").bind(day),
  ]);
  const counted = [mine!.meta.changes, all!.meta.changes];
  if (counted[0] === 1 && counted[1] === 1) return "ok";
  // Cannot happen while changes() works as above; refusing keeps the extra count on the safe side of both caps.
  if (counted[0] !== counted[1]) console.warn(JSON.stringify({ cost: "reserve counted one total only", day, counted }));
  return after!.results[0]!.spent_micro + micro > capMicro ? "daily" : "visitor";
}

/** The UTC day of `now` (ms since the epoch) as YYYY-MM-DD, the key of the `usage` and `usage_ip` rows. */
export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

/**
 * `usd` (DAILY_COST_CAP_USD by default) × 10⁶ in µ$. "0" refuses every model call. Missing, empty or anything other
 * than a plain non-negative decimal (such as "-1", "1e3" or "5$") falls back to `fallbackUsd`, with a warning.
 */
export function capMicro(usd: string | undefined, name = "DAILY_COST_CAP_USD", fallbackUsd = DEFAULT_CAP_USD): number {
  const text = usd?.trim() ?? "";
  // At most 9 integer and 6 decimal digits, so the µ$ value is an exact safe integer.
  if (/^\d{1,9}(\.\d{1,6})?$/.test(text)) return Math.round(Number(text) * 1e6);
  console.warn(JSON.stringify({ cost: `${name} is not a non-negative number; using the default`, capUsd: fallbackUsd }));
  return Math.round(fallbackUsd * 1e6);
}

/** The Client_Cap: PER_IP_DAILY_USD × 10⁶ in µ$, read like capMicro, with the $0.50 default. */
export const clientCapMicro = (usd: string | undefined): number => capMicro(usd, "PER_IP_DAILY_USD", DEFAULT_CLIENT_CAP_USD);

/**
 * Reserves the fixed estimate for one `kind` model call by `req`'s Client_Key on the UTC day of `now`.
 * Returns null when reserved, or the 503 {mode: "sample", reason, error} to send instead of making the call.
 */
export async function reserveCall(
  env: Pick<Env, "DB" | "DAILY_COST_CAP_USD" | "PER_IP_DAILY_USD">, kind: CostKind, req: Request, now = Date.now(),
): Promise<Response | null> {
  const day = utcDay(now);
  const result = await reserve(env.DB, day, clientKey(req), COST_MICRO[kind], capMicro(env.DAILY_COST_CAP_USD), clientCapMicro(env.PER_IP_DAILY_USD));
  if (result === "ok") return null;
  console.log(JSON.stringify({ cost: "refused", kind, day, reason: result }));    // never the Client_Key: it is the IP
  return Response.json({ mode: "sample", reason: result, error: result === "daily" ? CAP_REACHED : CLIENT_CAP_REACHED }, { status: 503 });
}
