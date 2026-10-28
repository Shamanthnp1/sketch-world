// The Create page at /create (task 7.5; Requirements 1.6, 2.5, 3.7, 3.10, 5.9, 7.8, 17.7, 17.8): two choices,
// "Photo of a drawing" (corners → flatten → autoLevel) and "Draw here" (the pad PNG as is), then the Work_Image →
// POST /api/understand → the cut-out chain → the World_View with walking and the HUD, behind staged progress.
// shell.ts loads this module with import(), so Home's entry chunk stays small; three.js stays behind openWorld.
// The raw photo never leaves the browser: only the Work_Image JPEG is sent. User strings via textContent only.
import type { SparkScene } from "../../shared/scene";
import { ApiError, understand } from "../api";
import { buildInstances, type WorkPixels } from "../cut/chain";
import { chainIO } from "../cut/io";
import { thresholdMask } from "../cut/threshold";
import type { Instance } from "../cut/types";
import { pixels, workImage } from "../image/encode";
import { createPad, type Pad } from "../pad/pad";
import { autoLevel, flatten } from "../paper/flatten";
import type { World } from "../world/build";
import { openWorld } from "../world/open";
import { attachWalk, type Walk } from "../world/walk";
import { pickCorners } from "./corners";
import { mountHud, type Hud } from "./hud";
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
    case 429: case 503: return "Lots of worlds are being made right now. Please try again in a minute."; // 10.5 adds Sample_Mode for 503
    case 413: return "That picture is too large to send. Try a smaller one.";
    case 415: return "That picture’s format can’t be read. Try a JPEG or PNG.";
    case 400: return "That picture couldn’t be sent. Try another one.";
    default: return GENERIC;
  }
}

/** Whether sending the same Work_Image again can work: not after 422 (not a drawing) or 400/413/415 (bad input). */
export const canResend = (e: unknown) => !(e instanceof ApiError && [400, 413, 415, 422].includes(e.status));

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
  world: World;
}

type Work = { canvas: OffscreenCanvas; jpeg: Blob };
type View = "choices" | "pad" | "corners" | "progress" | "fail" | "world";

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
    <p class="meta create-privacy">Your photo stays on this device; only the flattened drawing is sent.</p>
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
  const retry = btn("retry"), again = btn("again");
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
        const m = minimalWorld(px);
        return await open(me, { scene: MINIMAL_SCENE, work: m.work, jpeg, instances: m.instances, notFound: [], saveable: false });
      }
      const n = objectCount(scene);
      stage(1, n);
      // 8.2 plugs in here: start POST /api/backdrop with scene.title now, so it runs in parallel with the chain,
      // then pass `ground` (groundColour(px, instances)) and the sky to openWorld in open().
      const { instances, notFound } = await buildInstances(scene, px, chainIO(jpeg));
      if (me !== run) return;
      stage(2, n);
      await open(me, { scene, work: px, jpeg, instances, notFound: missingNouns(scene, notFound), saveable: true });
    } catch (e) {
      if (me === run) fail(errorText(e), canResend(e) ? sent : null);
    }
  }

  async function open(me: number, c: Omit<CreatedWorld, "world">): Promise<void> {
    const host = el("div", "create-world");
    host.setAttribute("role", "region");
    host.setAttribute("aria-label", "Your world");
    const world = await openWorld(host, { instances: c.instances, work: c.work, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches });
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
    created = { ...c, world };
    hud = mountHud(host, world, { title: c.scene.title }); // 9.5: onSave: created.saveable ? () => save(created) : undefined
    // Make another closes this world for good, so it asks first, in a dialog styled like the HUD's help.
    const another = el("button", "", "Make another"), ask = el("dialog", "hud-help create-ask");
    const askH = el("h2", "", "Make another world?"), acts = el("div", "actions");
    const go = el("button", "primary", "Make another"), stay = el("button", "", "Keep this world");
    another.type = go.type = stay.type = "button";
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
      return fail("That file couldn’t be opened as a picture. Try a JPEG or PNG photo.");
    }
    if (me !== run) return photo.close();
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
    from = "pad";
    const p = pad;
    await make(++run, async () => {
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
  retry.addEventListener("click", () => (from === "pad" ? show("pad") : show("choices", btn("choose"))));
  again.addEventListener("click", () => {
    const w = sentLast;
    if (w) void make(++run, async () => w);
  });

  return () => {
    run++;
    closeWorld?.();
  };
}
