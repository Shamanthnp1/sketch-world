// GET /api/gallery (Requirements 10.7, 10.13): `worlds` is the 24 latest Listed worlds with safe = 1, newest first;
// `samples` is the SAMPLE_WORLD_IDS worlds (comma-separated) in that order, each only if it exists and is safe.
// Listed means listed = 1 (the operator's approve command, README) or an id in SAMPLE_WORLD_IDS, whatever its listed
// column says. A world that isn't listed still opens by link (getWorld).
import type { GalleryReply, GalleryWorld } from "../../shared/saved";
import { WORLD_ID } from "../crypto";
import { assetUrl } from "./worlds";

const MAX_WORLDS = 24;
type Row = { id: string; title: string; created_at: number };
const item = (r: Row): GalleryWorld => ({ id: r.id, title: r.title, thumb: assetUrl(r.id, "thumb.jpg"), createdAt: r.created_at });

export async function gallery(_req: Request, env: Env): Promise<Response> {
  const sampleIds = [...new Set(env.SAMPLE_WORLD_IDS.split(",").map((s) => s.trim()).filter((s) => WORLD_ID.test(s)))];
  const [listed, samples] = await env.DB.batch<Row>([
    // One range of index worlds_gallery (safe, listed, created_at DESC), already in order: at most 24 rows read.
    env.DB.prepare("SELECT id, title, created_at FROM worlds WHERE safe = 1 AND listed = 1 ORDER BY created_at DESC LIMIT ?1").bind(MAX_WORLDS),
    env.DB.prepare("SELECT id, title, created_at FROM worlds WHERE safe = 1 AND id IN (SELECT value FROM json_each(?1))")
      .bind(JSON.stringify(sampleIds)),
  ]);
  // The samples count as listed, so they join the newest list; a sample with listed = 1 is in both, and is kept once.
  const byId = new Map([...listed!.results, ...samples!.results].map((r) => [r.id, r]));
  const newest = [...byId.values()].sort((a, b) => b.created_at - a.created_at).slice(0, MAX_WORLDS);
  const found = new Map(samples!.results.map((r) => [r.id, r]));
  const reply: GalleryReply = {
    worlds: newest.map(item),
    samples: sampleIds.flatMap((id) => { const r = found.get(id); return r ? [item(r)] : []; }),
  };
  return Response.json(reply);
}
