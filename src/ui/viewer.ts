// The Viewer at /w/:id (task 9.5; Requirements 10.6, 10.9, 12.4, 16.4, 16.6, 16.12, 17.12): GET /api/worlds/:id, then
// the World page layout with the saved world. The Viewer has no Work_Image or masks, only the saved cut-out PNGs, so it
// rebuilds them: each PNG is drawn at its bbox crop's size, its alpha (≥ 128) becomes the mask, and its pixels go into
// a blank Work_Image of the saved size. buildWorld then runs unchanged, so layout() places every Card exactly as in the
// original world, and the saved moves go on top. Owners (owner:<id> in localStorage) get Save positions and Delete
// world; everyone else can move things locally and gets only Share link. shell.ts loads this module with import();
// three.js stays behind openWorld. User strings via textContent only.
import type { Moves, SavedInstance, WorldReply } from "../../shared/saved";
import type { PxBox } from "../../shared/scene";
import { ApiError, deleteWorld, getWorld, saveMoves } from "../api";
import type { WorkPixels } from "../cut/chain";
import { cropRgba } from "../cut/threshold";
import type { Instance } from "../cut/types";
import { forgetOwner, ownerToken } from "../share/save";
import type { Card, World } from "../world/build";
import { openWorld } from "../world/open";
import { attachWalk, type Walk } from "../world/walk";
import { mountHud, shareUrl, type Hud } from "./hud";
import { toast } from "./shell";
import "./viewer.css";

/**
 * Writes one cut-out, drawn at the size of its bbox crop `rect`, into the Work_Image and returns its rect-sized mask:
 * 1 where alpha ≥ 128. Only masked pixels are written, opaque, so overlapping bboxes don't cover each other's picture.
 */
export function pasteCut(work: WorkPixels, rect: PxBox, cut: Uint8ClampedArray): Uint8Array {
  const mask = new Uint8Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const k = y * rect.w + x;
      if (cut[4 * k + 3]! < 128) continue;
      const i = 4 * ((rect.y + y) * work.width + rect.x + x);
      mask[k] = 1;
      work.data.set(cut.subarray(4 * k, 4 * k + 3), i);
      work.data[i + 3] = 255;
    }
  }
  return mask;
}

/** The saved moves on top of the layout (Requirement 16.4): each moved Card's home, by instance id. */
export function applyMoves(cards: readonly Pick<Card, "id" | "pos">[], moves: Moves = {}): void {
  for (const c of cards) {
    const m = moves[String(c.id)];
    if (m) c.pos = { x: m.x, y: m.y, z: m.z };
  }
}

async function bitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(res.status, `A picture of this world is missing (${res.status}).`);
  return createImageBitmap(await res.blob());
}

/** The cut-out PNG at `url` drawn at w × h, as RGBA. */
async function cutPixels(url: string, w: number, h: number): Promise<Uint8ClampedArray> {
  const bmp = await bitmap(url), c = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

/** The Work_Image and Instances that buildWorld needs, from the saved scene and cut-outs. */
async function rebuild({ scene, assets }: WorldReply): Promise<{ work: WorkPixels; instances: Instance[] }> {
  const work: WorkPixels = { data: new Uint8ClampedArray(4 * scene.img.w * scene.img.h), width: scene.img.w, height: scene.img.h };
  // The crop cardArt takes (cropRgba with no padding) is the size the mask must have.
  const parts = await Promise.all(scene.instances.map(async (o: SavedInstance) => {
    const rect = cropRgba(work, o.bbox, 0).rect;
    return { o, rect, px: await cutPixels(assets.cuts[String(o.id)]!, rect.w, rect.h) };
  }));
  return { work, instances: parts.map(({ o, rect, px }) => ({ ...o, mask: pasteCut(work, rect, px) })) };
}

const LOADING = `
  <section class="card viewer-msg" aria-labelledby="v-h">
    <h1 id="v-h">Opening this world…</h1>
    <p class="meta" role="status">Fetching its paper cut-outs.</p>
  </section>`;
const NOT_FOUND = `
  <div class="stack">
    <h1 tabindex="-1">This world isn’t here</h1>
    <p class="lede">It may have been deleted, or the link is mistyped.</p>
    <div class="actions"><a class="btn primary" href="/gallery">See the gallery</a><a class="btn" href="/create">Make a world</a></div>
  </div>`;
const FAILED = `
  <section class="card viewer-msg" aria-labelledby="vf-h">
    <h1 id="vf-h" tabindex="-1">This world couldn’t open</h1>
    <p class="error" role="alert"></p>
    <div class="actions"><button type="button" class="primary">Try again</button><a class="btn" href="/gallery">See the gallery</a></div>
  </section>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), { className: cls, textContent: text });
}

/** Fills `main` with saved world `id`. Returns the clean-up for leaving the page (shell.ts calls it on navigation). */
export function mountViewer(main: HTMLElement, id: string): () => void {
  const chrome = document.querySelectorAll<HTMLElement>(".skip, .bar, .foot"); // hidden under the world, as on Create
  let left = false, close: (() => void) | null = null;

  async function load(): Promise<void> {
    main.innerHTML = LOADING;
    let reply: WorldReply, parts: Awaited<ReturnType<typeof rebuild>>, sky: ImageBitmap | undefined;
    try {
      reply = await getWorld(id);
      // The sky is not worth failing for: without it the gradient shows (Requirement 9.6).
      const painted = reply.assets.backdrop ? bitmap(reply.assets.backdrop).catch(() => undefined) : undefined;
      [parts, sky] = await Promise.all([rebuild(reply), painted]);
      if (left) return sky?.close();
      // Inside the try: without WebGL (or past the browser's context limit) three.js throws here, and the page would
      // otherwise stay on "Opening this world…".
      await open(reply, parts, sky);
    } catch (e) {
      close?.();    // a world that half opened goes, and the site header and footer come back
      if (left) return;
      if (e instanceof ApiError && e.status === 404) {
        document.title = "World not found · Sketch World";
        main.innerHTML = NOT_FOUND;
      } else {
        main.innerHTML = FAILED;
        main.querySelector(".error")!.textContent = e instanceof ApiError && e.status === 0 ? e.message : "Something went wrong while opening this world. Try again.";
        main.querySelector("button")!.addEventListener("click", () => { void load(); main.focus(); }); // the button is gone: keep focus in main
      }
      main.querySelector<HTMLElement>("h1")!.focus();
    }
  }

  async function open(reply: WorldReply, { work, instances }: Awaited<ReturnType<typeof rebuild>>, sky?: ImageBitmap): Promise<void> {
    const { scene } = reply, host = el("div", "viewer-world");
    host.setAttribute("role", "region");
    host.setAttribute("aria-label", "Saved world");
    const world: World = await openWorld(host, {
      instances, work, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, ground: scene.ground, sky,
    });
    applyMoves(world.cards, scene.moves);
    let walk: Walk | undefined, hud: Hud | undefined;
    close = () => {
      hud?.dispose();
      walk?.dispose();
      world.dispose();
      world.renderer.forceContextLoss(); // frees the WebGL context now instead of at garbage collection
      host.remove();
      for (const e of chrome) e.hidden = false;
      close = null;
    };
    if (left) return close(); // left the page while three.js loaded
    document.title = `${reply.title} · Sketch World`;
    main.replaceChildren(host);
    for (const e of chrome) e.hidden = true;
    walk = attachWalk(world, host);
    host.focus(); // before the HUD, whose help dialog may take focus on a first visit
    // Save & share is Share link here: the world is already saved. Non-owners get only this, and move things locally.
    const token = ownerToken(id);
    const h = (hud = mountHud(host, world, { title: reply.title, onSave: () => hud!.share(shareUrl(location.origin, id), { owner: !!token }) }));
    h.save.textContent = "Share link";
    if (token) {
      h.offerSavePositions(scene.moves ?? {}, async (moves) => {
        await saveMoves(id, token, moves);
        toast("Positions saved");
      });
      h.bar.append(deleteControl(h, token));
    }
    h.bar.append(Object.assign(el("a", "btn", "Make your own"), { href: "/create" }));
  }

  /** Delete world (Requirement 10.9): asks first, in a dialog styled like Controls help; 204 → the Gallery. */
  function deleteControl(h: Hud, token: string): HTMLButtonElement {
    const del = el("button", "", "Delete world"), ask = el("dialog", "hud-help viewer-ask"), askH = el("h2", "", "Delete this world?");
    const acts = el("div", "actions"), go = el("button", "primary", "Delete world"), keep = el("button", "", "Keep it");
    del.type = go.type = keep.type = "button";
    keep.autofocus = true; // the dialog opens on the safe choice
    askH.id = "viewer-ask-h";
    ask.setAttribute("aria-labelledby", askH.id);
    acts.append(go, keep);
    ask.append(askH, el("p", "", "It leaves the Gallery and its link stops working. This can’t be undone."), acts);
    ask.addEventListener("keydown", (e) => e.stopPropagation()); // keys stay in the dialog: nothing walks behind it
    del.addEventListener("click", () => ask.showModal());
    keep.addEventListener("click", () => ask.close());
    go.addEventListener("click", async () => {
      if (go.getAttribute("aria-disabled") === "true") return;
      go.setAttribute("aria-disabled", "true");
      go.textContent = "Deleting…";
      try {
        await deleteWorld(id, token);
      } catch (e) {
        ask.close();
        h.showError(e instanceof ApiError ? e.message : "This world couldn’t be deleted. Try again.");
        return;
      } finally {
        go.removeAttribute("aria-disabled");
        go.textContent = "Delete world";
      }
      forgetOwner(id);
      toast("World deleted");
      // replaceState, so Back doesn't return to the deleted world; the router shows the new path on popstate.
      history.replaceState(null, "", "/gallery");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    h.bar.parentElement!.append(ask); // the HUD layer, whose button and dialog rules style it
    return del;
  }

  void load();
  return () => {
    left = true;
    close?.();
  };
}
