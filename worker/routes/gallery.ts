// GET /api/gallery (Requirement 10.7): the 24 latest safe worlds, newest first (index worlds_gallery), and the sample
// worlds named in SAMPLE_WORLD_IDS (comma-separated), in that order, each only if it exists and is safe.
import type { GalleryReply, GalleryWorld } from "../../shared/saved";
import { WORLD_ID } from "../crypto";
import { assetUrl } from "./worlds";

type Row = { id: string; title: string; created_at: number };
const item = (r: Row): GalleryWorld => ({ id: r.id, title: r.title, thumb: assetUrl(r.id, "thumb.jpg"), createdAt: r.created_at });

export async function gallery(_req: Request, env: Env): Promise<Response> {
  const sampleIds = [...new Set(env.SAMPLE_WORLD_IDS.split(",").map((s) => s.trim()).filter((s) => WORLD_ID.test(s)))];
  const [latest, samples] = await env.DB.batch<Row>([
    env.DB.prepare("SELECT id, title, created_at FROM worlds WHERE safe = 1 ORDER BY created_at DESC LIMIT 24"),
    env.DB.prepare("SELECT id, title, created_at FROM worlds WHERE safe = 1 AND id IN (SELECT value FROM json_each(?1))")
      .bind(JSON.stringify(sampleIds)),
  ]);
  const found = new Map(samples!.results.map((r) => [r.id, r]));
  const reply: GalleryReply = {
    worlds: latest!.results.map(item),
    samples: sampleIds.flatMap((id) => { const r = found.get(id); return r ? [item(r)] : []; }),
  };
  return Response.json(reply);
}
