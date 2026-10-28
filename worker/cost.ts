// The daily cost cap (Requirements 3.6, 11.5, 11.6, 11.7). Before every model call the Worker reserves a fixed
// estimate against the current UTC day's row in the D1 `usage` table. A refused reservation means no model call
// and a 503 {mode: "sample"}. A reservation is kept even if the model call then fails.

/** Fixed estimates per model call in micro-dollars (µ$), from design.md "foldAmount and reserve". */
export const COST_MICRO = { spark: 10_000, sam: 2_500, image: 10_000 } as const;
export type CostKind = keyof typeof COST_MICRO;

/** The Daily_Cap default (Requirements glossary), used when DAILY_COST_CAP_USD is missing or not a number. */
export const DEFAULT_CAP_USD = 5;
export const CAP_REACHED = "Today's budget for new worlds is used up. Sample worlds and the gallery still work; please come back tomorrow.";

/**
 * Adds `micro` to `day`'s total only if the total stays at most `capMicro`. Returns whether it was added.
 * The batch is one transaction, and the cap check and the add are one UPDATE, so concurrent reservations
 * cannot both pass on a stale total.
 */
export async function reserve(db: D1Database, day: string, micro: number, capMicro: number): Promise<boolean> {
  const [, upd] = await db.batch([
    db.prepare("INSERT OR IGNORE INTO usage (day, spent_micro) VALUES (?1, 0)").bind(day),
    db.prepare("UPDATE usage SET spent_micro = spent_micro + ?1 WHERE day = ?2 AND spent_micro + ?1 <= ?3").bind(micro, day, capMicro),
  ]);
  return upd?.meta.changes === 1;
}

/** The UTC day of `now` (ms since the epoch) as YYYY-MM-DD, the key of the `usage` row. */
export const utcDay = (now: number): string => new Date(now).toISOString().slice(0, 10);

/**
 * DAILY_COST_CAP_USD × 10⁶ in µ$. "0" refuses every model call. Missing, empty or anything other than a plain
 * non-negative decimal (such as "-1", "1e3" or "5$") falls back to the documented $5 default, with a warning.
 */
export function capMicro(usd: string | undefined): number {
  const text = usd?.trim() ?? "";
  // At most 9 integer and 6 decimal digits, so the µ$ value is an exact safe integer.
  if (/^\d{1,9}(\.\d{1,6})?$/.test(text)) return Math.round(Number(text) * 1e6);
  console.warn(JSON.stringify({ cost: "DAILY_COST_CAP_USD is not a non-negative number; using the default", capUsd: DEFAULT_CAP_USD }));
  return DEFAULT_CAP_USD * 1e6;
}

/**
 * Reserves the fixed estimate for one `kind` model call on the UTC day of `now`.
 * Returns null when reserved, or the 503 {mode: "sample", error} to send instead of making the call.
 */
export async function reserveCall(env: Pick<Env, "DB" | "DAILY_COST_CAP_USD">, kind: CostKind, now = Date.now()): Promise<Response | null> {
  const day = utcDay(now);
  if (await reserve(env.DB, day, COST_MICRO[kind], capMicro(env.DAILY_COST_CAP_USD))) return null;
  console.log(JSON.stringify({ cost: "refused", kind, day }));
  return Response.json({ mode: "sample", error: CAP_REACHED }, { status: 503 });
}
