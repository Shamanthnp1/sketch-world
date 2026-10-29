// The Create page at /create (tasks 7.5, 10.5; Requirements 1.6, 2.5, 3.7, 3.10, 5.9, 7.8, 11.3, 11.8, 12.1, 17.7, 17.8): two choices,
// "Photo of a drawing" (corners → flatten → autoLevel) and "Draw here" (the pad PNG as is), then the Work_Image →
// POST /api/understand → the cut-out chain → the World_View with walking and the HUD, behind staged progress.
// shell.ts loads this module with import(), so Home's entry chunk stays small; three.js stays behind openWorld.
// The raw photo never leaves the browser: only the Work_Image JPEG is sent. User strings via textContent only.
import type { SparkScene } from "../../shared/scene";
import { ApiError, backdrop, getGallery, saveMoves, understand } from "../api";
import { buildInstances, type WorkPixels } from "../cut/chain";
import { chainIO } from "../cut/io";
import { thresholdMask } from "../cut/threshold";
import type { Instance } from "../cut/types";
import { pixels, workImage } from "../image/encode";
import { createPad, type Pad } from "../pad/pad";
import { autoLevel, flatten } from "../paper/flatten";
import { SegmentError } from "../sam/client";
import { saveWorld, type Saved } from "../share/save";
import type { World } from "../world/build";
import { groundColour } from "../world/ground";
import { openWorld } from "../world/open";
import { attachWalk, type Walk } from "../world/walk";
import { pickCorners } from "./corners";
import { mountHud, shareUrl, type Hud } from "./hud";
import { askPrivacy } from "./privacy";
import { toast } from "./shell";
import "./create.css";

/** Σcount: the cut-outs the scene asks for (≤ 30 after capInstances). */
export const objectCount = (scene: Pick<SparkScene, "objects">) => scene.objects.reduce((n, o) => n + o.count, 0);

/** The three progress step names; `n` (Σcount) is known once Spark has replied. */
export function stepNames(n?: number): [string, string, string] {
  const cut = n === undefined ? "Cutting out the objects" : `Cutting out ${n} ${n === 1 ? "object" : "objects"}`;
  return ["Reading your drawing", cut, "Popping up your world"];
}

const GENERIC = "Something went wrong while making your world. Please try again.";

/** What to tell the user about a failed run: the Worker's own words for 422 (Requirement 3.10), else a short reason. */
export function errorText(e: unknown): string {
  if (!(e instanceof ApiError)) return GENERIC;
  switch (e.status) {
    case 422: return e.message;
    // 429: rate limited (Requirement 11.3). A 503 without {mode: "sample"} (isSampleMode) is a busy server, not the cap.
    case 429: case 503: return "Lots of worlds are being made right now. Please try again in a minute.";
    case 413: return "That picture is too large to send. Try a smaller one.";
    case 415: return "That picture’s format can’t be read. Try a JPEG or PNG.";
    case 400: return "That picture couldn’t be sent. Try another one.";
    default: return GENERIC;
  }
}

/** Whether sending the same Work_Image again can work: not after 422 (not a drawing) or 400/413/415 (bad input). */
export const canResend = (e: unknown) => !(e instanceof ApiError && [400, 413, 415, 422].includes(e.status));

/** The daily cost cap's reply, 503 {mode: "sample"} (Requirement 11.7), from any route: the page goes to Sample_Mode. */
export const isSampleMode = (e: unknown) =>
  (e instanceof ApiError || e instanceof SegmentError) && e.status === 503 && e.mode === "sample";

export const SAMPLE_TEXT = "Today’s free budget for making worlds is used up. Please come back tomorrow to make yours. Until then, you can walk a sample world or see the worlds people made.";
export const VISITOR_TEXT = "You’ve made a lot of worlds today. Please come back tomorrow, or walk the sample worlds.";

/** The Sample_Mode card's text: this visitor's own daily budget ({reason: "visitor"}), else the whole day's cap. */
export const sampleText = (e: unknown) =>
  (e instanceof ApiError || e instanceof SegmentError) && e.reason === "visitor" ? VISITOR_TEXT : SAMPLE_TEXT;

/** Why a chosen file couldn't be decoded: it isn't a picture at all, or the browser can't read this one. */
export const openError = (type: string) => type && !type.startsWith("image/")
  ? "That file isn’t a picture. Choose a JPEG or PNG photo of your drawing."
  : "That photo couldn’t be opened. It may be too large, or in a format this browser can’t read. Try a JPEG or PNG.";

/** The photo decoded, but flattening or encoding it ran out of memory or wouldn't fit 400 KB. */
export const PHOTO_TOO_LARGE = "That photo is too large to work with on this device. Try a smaller photo, or a screenshot of it.";

/** The nouns of the scene objects the chain found nothing for (Requirement 5.9), in scene order, each once. */
export const missingNouns = (scene: Pick<SparkScene, "objects">, notFound: readonly number[]) =>
  [...new Set(notFound.map((i) => scene.objects[i].noun))];

/** Minimal_Scene (Requirement 3.7): shown after a 502 from understand. safe false: its safety is unknown, so no saving. */
export const MINIMAL_SCENE: SparkScene = {
  title: "Your drawing", view: "side", isDrawing: true, safe: false,
  objects: [{ type: "hill", noun: "your drawing", count: 1, sky: false }],
};

/** Width of the Minimal_Scene's layout page in multiples of the drawing's longer side (see minimalWorld). */
export const MINIMAL_PAGE = 3;

/**
 * The Minimal_Scene's one Card: the whole Work_Image as a threshold cut-out, trimmed to its opaque pixels. The Card
 * is a hill (layout: 1.5 × size at Z_BACK − 2); at the Work_Image's own scale a full drawing stands taller and wider
 * than the view from the spawn point. So the trimmed drawing goes on a white layout page MINIMAL_PAGE × its longer
 * side wide: the Card's longer side is 1.5 · W / 3 = 12 units and the whole drawing is in view, on phones too.
 * The page is only this world's layout and texture source; a Minimal_Scene world is never saved.
 */
export function minimalWorld(work: WorkPixels): { work: WorkPixels; instances: Instance[] } {
  const { width: w, height: h } = work, src = Uint8ClampedArray.from(work.data);
  // A corner tapped just outside the paper leaves a dark line along the photo's edge; as a closed frame it would keep
  // the whole page opaque. So a 1% margin turns white first.
  const m = Math.max(2, Math.round(0.01 * Math.min(w, h)));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < m || y < m || x >= w - m || y >= h - m) src.fill(255, 4 * (y * w + x), 4 * (y * w + x) + 3);
  const all = thresholdMask(src, w, h);
  if (!all.includes(1)) all.fill(1); // a blank page: keep the whole page (as Requirement 5.7 does for a box)
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let i = 0; i < all.length; i++) {
    if (!all[i]) continue;
    const x = i % w, y = (i - x) / w;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = y;
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, pw = MINIMAL_PAGE * Math.max(bw, bh), left = (pw - bw) >> 1;
  const data = new Uint8ClampedArray(4 * pw * bh).fill(255), mask = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    const row = (y0 + y) * w + x0;
    mask.set(all.subarray(row, row + bw), y * bw);
    data.set(src.subarray(4 * row, 4 * (row + bw)), 4 * (y * pw + left));
  }
  const o = MINIMAL_SCENE.objects[0], bbox = { x: left, y: 0, w: bw, h: bh };
  return { work: { data, width: pw, height: bh }, instances: [{ id: 0, objIndex: 0, type: o.type, noun: o.noun, sky: o.sky, bbox, mask, source: "threshold" }] };
}

/** The note under the HUD strip: why a Minimal_Scene can't be saved, and the nouns not found; "" for neither. */
export function noteText(c: Pick<CreatedWorld, "saveable" | "notFound">): string {
  return [
    c.saveable ? "" : "Sketch World couldn’t tell the things in your drawing apart, so your drawing stands as one card. You can’t save this world.",
    c.notFound.length ? `Not found in your drawing: ${c.notFound.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
}

/** Everything a made world keeps, for Save & share (9.4, 9.5). Lives in mountCreate's `created` while the world is open. */
export interface CreatedWorld {
  scene: SparkScene;       // Spark's reply, or MINIMAL_SCENE after a 502
  work: WorkPixels;        // the pixels the masks refer to (the Work_Image; minimalWorld's page); its size is the layout size
  jpeg: Blob;              // the exact bytes sent to /api/understand (source.jpg: the Checks_Row holds its SHA-256)
  instances: Instance[];
  notFound: string[];      // nouns of the scene objects with no cut-out
  saveable: boolean;       // false for the Minimal_Scene
  ground: string;          // groundColour(work, instances): the ground, and the gradient sky's horizon (Requirements 9.6, 9.7)
  backdrop: Blob | null;   // Muse Image's sky once it shows; null while it paints, after a failure and for the Minimal_Scene
  world: World;
}

type Work = { canvas: OffscreenCanvas; jpeg: Blob };
type View = "choices" | "pad" | "corners" | "progress" | "fail" | "sample" | "world";

const TEMPLATE = `
  <div class="stack create-intro">
    <h1>Make a world</h1>
    <p class="lede" data-for="choices">Start from a drawing on paper, or draw one here.</p>
  </div>
  <div class="create-choices" data-view="choices">
    <section class="card create-choice" aria-labelledby="cc-photo">
      <h2 id="cc-photo">Photo of a drawing</h2>
      <p>Take a photo of your drawing, then mark its 4 corners so the paper lies flat.</p>
      <div class="actions">
        <button type="button" class="primary" data-a="choose">Choose a photo</button>
        <button type="button" class="create-take" data-a="take">Take a photo</button>
      </div>
      <input type="file" accept="image/*" data-in="choose" hidden>
      <input type="file" accept="image/*" capture="environment" data-in="take" hidden>
    </section>
    <section class="card create-choice" aria-labelledby="cc-draw">
      <h2 id="cc-draw">Draw here</h2>
      <p>Draw in black on white with a mouse, a pen or your finger.</p>
      <div class="actions"><button type="button" data-a="draw">Start drawing</button></div>
    </section>
    <p class="meta create-privacy">Only your drawing is sent to Meta’s AI models. A photo of it stays on this device.</p>
  </div>
  <section class="create-pad" data-view="pad" aria-labelledby="cd-h" hidden>
    <h2 id="cd-h" tabindex="-1">Draw here</h2>
    <p class="meta">Draw a few things, like a house, a tree and the sun. Each one becomes a paper cut-out.</p>
    <div class="create-pad-host"></div>
    <p class="error" role="alert" hidden></p>
    <div class="actions">
      <button type="button" class="primary" data-a="make">Make my world</button>
      <button type="button" data-a="back">Back</button>
    </div>
  </section>
  <div class="create-corners" data-view="corners" hidden></div>
  <section class="card create-progress" data-view="progress" aria-labelledby="cg-h" hidden>
    <h2 id="cg-h" tabindex="-1">Making your world…</h2>
    <ol class="steps"><li></li><li></li><li></li></ol>
    <p class="meta">This takes up to a minute.</p>
  </section>
  <section class="card create-fail" data-view="fail" aria-labelledby="cf-h" hidden>
    <h2 id="cf-h" tabindex="-1">Your world couldn’t be made</h2>
    <p class="error" role="alert"></p>
    <div class="actions">
      <button type="button" class="primary" data-a="again" hidden>Try again</button>
      <button type="button" class="primary" data-a="retry"></button>
    </div>
  </section>
  <section class="card create-sample" data-view="sample" aria-labelledby="cs-h" hidden>
    <h2 id="cs-h" tabindex="-1">No more new worlds today</h2>
    <p class="create-sample-text"></p>
    <div class="actions">
      <a class="btn primary" href="/gallery" data-sample>Walk a sample world</a>
      <a class="btn" href="/gallery">See the gallery</a>
      <button type="button" data-a="sample-back"></button>
    </div>
  </section>
  <p class="vh" role="status" data-live></p>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), { className: cls, textContent: text });
}

/** Fills `main` with the Create page. Returns the clean-up for leaving the page (shell.ts calls it on navigation). */
export function mountCreate(main: HTMLElement): () => void {
  main.innerHTML = TEMPLATE;
  const $ = <T extends HTMLElement>(sel: string) => main.querySelector<T>(sel)!;
  const btn = (a: string) => $<HTMLButtonElement>(`[data-a="${a}"]`);
  const views = main.querySelectorAll<HTMLElement>("[data-view]"), lede = $(".lede"), live = $("[data-live]");
  const padHost = $(".create-pad-host"), padErr = $<HTMLParagraphElement>(".create-pad .error");
  const steps = [...main.querySelectorAll<HTMLLIElement>(".steps li")], failText = $(".create-fail .error");
  const retry = btn("retry"), again = btn("again"), sampleLink = $<HTMLAnchorElement>("[data-sample]");
  const chrome = document.querySelectorAll<HTMLElement>(".skip, .bar, .foot"); // the site header and footer, hidden under a world

  let pad: Pad | null = null;
  let from: "photo" | "pad" = "photo";
  let run = 0;                                // bumped by every new run and on leaving: a stale run drops its result
  let created: CreatedWorld | null = null;    // the open world's data; 9.5's onSave reads it
  let closeWorld: (() => void) | null = null;
  let sentLast: Work | null = null;           // what Try again resends after a failure that isn't the picture's fault

  function show(view: View, focus?: HTMLElement): void {
    for (const v of views) v.hidden = v.dataset.view !== view;
    lede.hidden = view !== "choices";
    $(".create-intro").hidden = view === "world";
    (focus ?? main.querySelector<HTMLElement>(`[data-view="${view}"] h2[tabindex]`))?.focus({ preventScroll: true });
  }

  function stage(i: number, n?: number): void {
    const names = stepNames(n);
    steps.forEach((li, k) => {
      li.textContent = names[k];
      li.classList.toggle("done", k < i);
      if (k < i) li.append(el("span", "vh", " (done)"));
      if (k === i) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    live.textContent = `${names[i]}…`;
  }

  /** `resend`: the Work_Image that Try again sends once more; null when only another picture can help. */
  function fail(text: string, resend: Work | null = null): void {
    closeWorld?.();
    sentLast = resend;
    again.hidden = !resend;
    retry.classList.toggle("primary", !resend); // one primary per screen
    retry.textContent = from === "pad" ? "Back to my drawing" : "Try another picture";
    show("fail");
    failText.textContent = text; // after unhiding, so the alert is announced
    live.textContent = "";
  }

  /**
   * Sample_Mode (Requirements 11.7, 11.8): the daily cap, or this visitor's own, is reached (`e` is the 503 that said
   * which). The pad keeps the drawing; the samples and Gallery need no model.
   */
  function sampleMode(e: unknown): void {
    $(".create-sample-text").textContent = sampleText(e);
    btn("sample-back").textContent = from === "pad" ? "Back to my drawing" : "Try another picture";
    show("sample");
    live.textContent = "";
    // Walk a sample world opens the Gallery until the reply names a sample (as on Home). A late reply is harmless.
    void getGallery().then((g) => {
      if (g.samples[0]) sampleLink.href = `/w/${encodeURIComponent(g.samples[0].id)}`;
    }, () => {});
  }

  /** Work_Image → understand → chain → world. `me` is this run's number. */
  async function make(me: number, work: () => Promise<Work>): Promise<void> {
    stage(0);
    show("progress");
    let sent: Work | null = null;
    try {
      const { canvas, jpeg } = (sent = await work());
      const scene = await understand(jpeg).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 502) return null; // Spark failed twice: Minimal_Scene (Requirement 3.7)
        throw e;
      });
      if (me !== run) return;
      const px = pixels(canvas); // the JPEG's own size, so SAM masks line up
      if (!scene) {
        stage(2);
        const m = minimalWorld(px); // no title from Spark, so no backdrop is asked for: the gradient sky
        return await open(me, { scene: MINIMAL_SCENE, work: m.work, jpeg, instances: m.instances, notFound: [], saveable: false }, null);
      }
      const n = objectCount(scene);
      stage(1, n);
      // Muse Image paints the sky while the chain runs (Requirement 9.1). Any failure (422 refused, 502, 429, 503, no
      // network) keeps the gradient (9.6), so it is dropped without a word.
      const sky: { png?: Blob | null } = {};
      const painted = backdrop(scene.title).catch(() => null).then((png) => (sky.png = png));
      // A failed segment or point call is a miss for its stage (the chain catches it); this only notes the daily cap.
      let capped: unknown = null; // the first 503 {mode: "sample"}
      const io = chainIO(jpeg, () => me === run), miss = (e: unknown): never => { if (isSampleMode(e)) capped ??= e; throw e; };
      const { instances, notFound } = await buildInstances(scene, px, {
        segment: (p) => io.segment(p).catch(miss), point: (o) => io.point(o).catch(miss),
      });
      if (me !== run) return;
      if (capped && !instances.length) return sampleMode(capped); // the cap, not the drawing, left nothing to stand up
      stage(2, n);
      await open(me, { scene, work: px, jpeg, instances, notFound: missingNouns(scene, notFound), saveable: true }, sky.png === undefined ? painted : sky.png);
    } catch (e) {
      if (me !== run) return;
      if (isSampleMode(e)) return sampleMode(e);
      if (!sent && from === "photo") return fail(PHOTO_TOO_LARGE); // work() failed: the photo decoded but is too big to flatten
      fail(errorText(e), canResend(e) ? sent : null);
    }
  }

  /** `sky`: the backdrop PNG if it is here (null: none), or the request still painting it. */
  async function open(me: number, c: Omit<CreatedWorld, "world" | "ground" | "backdrop">, sky: Blob | null | Promise<Blob | null>): Promise<void> {
    const host = el("div", "create-world");
    host.setAttribute("role", "region");
    host.setAttribute("aria-label", "Your world");
    const ground = groundColour(c.work, c.instances);
    // A backdrop that is already here is decoded first, so the world opens with it instead of swapping it in a frame later.
    const now = sky instanceof Blob ? await createImageBitmap(sky).catch(() => undefined) : undefined;
    const world = await openWorld(host, {
      instances: c.instances, work: c.work, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, ground, sky: now,
    });
    let walk: Walk | undefined, hud: Hud | undefined;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault(); // a reload or closed tab would lose the world
    closeWorld = () => {
      removeEventListener("beforeunload", warn);
      hud?.dispose();
      walk?.dispose();
      world.dispose();
      world.renderer.forceContextLoss(); // frees the WebGL context now instead of at garbage collection
      host.remove();
      for (const e of chrome) e.hidden = false;
      created = closeWorld = null;
    };
    if (me !== run) return closeWorld(); // left the page while three.js loaded
    main.append(host);
    addEventListener("beforeunload", warn);
    for (const e of chrome) e.hidden = true;
    show("world");
    walk = attachWalk(world, host);
    host.focus(); // before the HUD, whose help dialog may take focus on a first visit
    created = { ...c, ground, backdrop: now ? (sky as Blob) : null, world };
    // A later backdrop swaps in when it arrives, unless this world was left or replaced (Make another) meanwhile.
    if (sky instanceof Promise) {
      void sky.then(async (png) => {
        if (png && created?.world === world && (await world.setSky(png)) && created?.world === world) created.backdrop = png;
      });
    }
    // Save & share (Requirements 10.1, 10.5, 10.12, 16.5): the first click saves; once saved, the button is Share link and
    // shows the same link again (no second world), and Save positions sends later moves with PATCH (16.6). The URL stays
    // /create: history.replaceState would leave the router's current path at /create, so its links would go stale.
    let saved: Saved | null = null;
    const share = (s: Saved) => hud!.share(shareUrl(location.origin, s.id), { open: s.url, owner: true });
    async function save(h: Hud): Promise<void> {
      if (saved) return share(saved);
      h.save.textContent = "Saving…";
      h.save.setAttribute("aria-disabled", "true");
      live.textContent = "Saving your world…";
      const sent = world.moves(); // what saveWorld sends: it reads moves() before its first await
      try {
        saved = await saveWorld({
          title: c.scene.title, view: c.scene.view, ground, backdrop: created!.backdrop, instances: c.instances, work: c.work,
          sourceJpeg: c.jpeg, world,
        });
      } catch (e) { // the world stays open and playable (10.12)
        h.save.textContent = "Save & share";
        h.showError(e instanceof ApiError ? e.message : "This world couldn’t be saved. Try again.");
        return;
      } finally {
        h.save.removeAttribute("aria-disabled");
        live.textContent = "";
      }
      if (created?.world !== world) return; // left while it saved: it is saved, and this device owns it
      removeEventListener("beforeunload", warn); // it can be opened again from its link
      h.save.textContent = "Share link";
      const { id, ownerToken } = saved;
      h.offerSavePositions(sent, async (moves) => {
        await saveMoves(id, ownerToken, moves);
        toast("Positions saved");
      });
      share(saved);
    }
    hud = mountHud(host, world, { title: c.scene.title, onSave: c.saveable ? () => void save(hud!) : undefined });
    // Make another closes this world for good, so it asks first, in a dialog styled like the HUD's help.
    const another = el("button", "", "Make another"), ask = el("dialog", "hud-help create-ask");
    const askH = el("h2", "", "Make another world?"), acts = el("div", "actions");
    const go = el("button", "primary", "Make another"), stay = el("button", "", "Keep this world");
    another.type = go.type = stay.type = "button";
    stay.autofocus = true; // the dialog opens on the safe choice
    askH.id = "create-ask-h";
    ask.setAttribute("aria-labelledby", askH.id);
    acts.append(go, stay);
    ask.append(askH, el("p", "", "This world closes and can’t be opened again."), acts);
    ask.addEventListener("keydown", (e) => e.stopPropagation()); // keys stay in the dialog: nothing walks behind it
    another.addEventListener("click", () => ask.showModal());
    stay.addEventListener("click", () => ask.close());
    go.addEventListener("click", () => {
      closeWorld?.();
      pad?.clear(); // Undo on the pad still brings the drawing back
      show("choices", btn("choose"));
      scrollTo(0, 0);
    });
    hud.bar.append(another);
    hud.bar.parentElement!.append(ask); // the HUD layer, whose button and dialog rules style it
    // A paper slip, not a toast: it isn't a confirmation, and it must stay until read (DESIGN.md "Toast").
    const text = noteText(c);
    if (text) {
      const note = el("div", "create-note"), ok = el("button", "", "Dismiss");
      ok.type = "button";
      ok.addEventListener("click", () => { note.remove(); host.focus(); });
      note.append(el("p", "", text), ok);
      hud.bar.after(note);
    }
    live.textContent = `Your world “${c.scene.title}” is open.${text ? ` ${text}` : ""}`;
  }

  // Photo of a drawing: decode (EXIF orientation applied) → corners (Cancel returns here) → flatten → autoLevel.
  async function fromPhoto(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = ""; // picking the same file again fires change again
    if (!file) return;
    from = "photo";
    const me = ++run;
    let photo: ImageBitmap;
    try {
      photo = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      return fail(openError(file.type));
    }
    if (me !== run) return photo.close();
    // The privacy notice before the first upload (Requirement 12.1), before the corner taps so Not now loses no work.
    if (!(await askPrivacy(main)) || me !== run) {
      photo.close();
      if (me === run) show("choices", btn("choose"));
      return;
    }
    show("corners");
    const q = await pickCorners($(".create-corners"), photo).catch(() => null);
    if (me !== run) return photo.close();
    if (!q) {
      photo.close();
      return show("choices", btn("choose"));
    }
    await make(me, () => {
      const full = new OffscreenCanvas(photo.width, photo.height), ctx = full.getContext("2d")!;
      ctx.drawImage(photo, 0, 0);
      photo.close();
      const flat = autoLevel(flatten(ctx.getImageData(0, 0, full.width, full.height), q));
      return workImage(new ImageData(flat.data, flat.width, flat.height));
    });
  }

  // Draw here: the pad's PNG is the Work_Image as is (Requirement 2.5).
  async function fromPad(): Promise<void> {
    if (!pad || pad.isEmpty()) {
      padErr.hidden = false;
      padErr.textContent = "Draw something first, then choose Make my world.";
      return;
    }
    const p = pad, me = ++run;
    if (!(await askPrivacy(main)) || me !== run) return; // Not now: back on the pad, the drawing kept
    from = "pad";
    await make(me, async () => {
      const bmp = await createImageBitmap(await p.exportPng());
      try { return await workImage(bmp); } finally { bmp.close(); }
    });
  }

  for (const k of ["choose", "take"]) {
    const input = $<HTMLInputElement>(`[data-in="${k}"]`);
    btn(k).addEventListener("click", () => input.click());
    input.addEventListener("change", () => void fromPhoto(input));
  }
  btn("draw").addEventListener("click", () => {
    pad ??= createPad(padHost);
    show("pad");
    $(".create-pad").scrollIntoView({ block: "start" }); // the pad is sized to fit the screen from here
  });
  padHost.addEventListener("pointerdown", () => { padErr.hidden = true; });
  btn("make").addEventListener("click", () => void fromPad());
  btn("back").addEventListener("click", () => show("choices", btn("draw")));
  const back = () => (from === "pad" ? show("pad") : show("choices", btn("choose")));
  retry.addEventListener("click", back);
  btn("sample-back").addEventListener("click", back);
  again.addEventListener("click", () => {
    const w = sentLast;
    if (w) void make(++run, async () => w);
  });

  return () => {
    run++;
    closeWorld?.();
  };
}
