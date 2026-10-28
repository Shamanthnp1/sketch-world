// Gate probe behind ?probe (task 3.2; Requirements 3.1, 4.1): one drawing → POST /api/understand → one noun
// POST /api/segment per object → per object its masks, cut-outs and SAM latency, plus the run's time and estimated
// cost. "Save replies" writes one fixture file per drawing (test/fixtures/meta/gate/); Replay reads it back with no
// calls. Pure helpers are exported for test/unit/probe.test.ts. Nouns and titles go into the DOM via textContent only.
import { z } from "zod";
import { group, SparkScene, type ObjType } from "../../shared/scene";
import { ApiError, understand } from "../api";
import { buildInstances, type ChainIO } from "../cut/chain";
import { pixels, workImage } from "../image/encode";
import { SamClient, SegmentError } from "../sam/client";
import { cutout } from "../sam/cutout";
import { placeMask } from "../sam/masks";
import { parseSamOutput, type MaskRaster } from "../sam/parse";
import { openWorld } from "../world/open";
import { attachWalk } from "../world/walk";
import "./probe.css";

type Mode = "live" | "replay" | "skip";
type SceneObject = SparkScene["objects"][number];

// design.md fixed estimates in µ$, and the Day-1 gate limits per drawing.
export const SPARK_MICRO = 10_000;
export const SAM_MICRO = 2_500;
export const GATE = { ms: 40_000, costMicro: 50_000, listed: 0.8, clean: 0.7 };

export const costMicro = (understandCalls: number, segmentCalls: number) =>
  understandCalls * SPARK_MICRO + segmentCalls * SAM_MICRO;

const pct = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
const pct1 = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });    // mask fills near 5%
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
export const dollars = (micro: number) => usd.format(micro / 1e6);
export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Share of the mask's own box that is set (SAM's raster is exactly that box). */
export const maskFill = (m: MaskRaster) => (m.data.length ? m.data.reduce((n, v) => n + v, 0) / m.data.length : 0);

/**
 * Why Requirement 4.3 rejects this noun mask, or null if it is accepted: area ≥ 5% of its own box, and the box
 * covers ≤ 60% of the w × h Work_Image (≤ 90% for flat and terrain types).
 * shortcut: no IoU de-duplication (4.5); task 5.5's assign() replaces this check.
 */
export function rejectReason(m: MaskRaster, type: ObjType, w: number, h: number): string | null {
  const fill = maskFill(m), share = (m.width * m.height) / (w * h);
  const max = group(type) === "flat" || group(type) === "terrain" ? 0.9 : 0.6;
  if (fill < 0.05) return `fills only ${pct1.format(fill)} of its box`;
  if (share > max) return `box covers ${pct.format(share)} of the image`;
  return null;
}

/** Indices of the set pixels of a w × h mask that touch an unset 4-neighbour or the image edge: its outline. */
export function edgePixels(mask: Uint8Array, w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i] && (x === 0 || y === 0 || x === w - 1 || y === h - 1
        || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w])) out.push(i);
    }
  }
  return out;
}

// One file per drawing: the Worker's SparkScene and each noun's raw SAM outputText. No headers, no key.
const Fixture = z.object({
  image: z.object({ name: z.string().min(1), w: z.number().int().min(1), h: z.number().int().min(1) }),
  understand: SparkScene,
  segments: z.record(z.string(), z.string()),
});
export type ProbeFixture = z.output<typeof Fixture>;

export function parseFixture(json: unknown): ProbeFixture | null {
  const r = Fixture.safeParse(json);
  return r.success ? r.data : null;
}

/** "cat.photo.png" → "cat.photo.json": the replies file for that drawing. */
export const fixtureName = (imageName: string) => `${imageName.replace(/\.[^.]*$/, "") || "drawing"}.json`;

/** One object row's ticks. `accepted` is how many of its SAM masks passed rejectReason. */
export type Tick = { count: number; accepted: number; listed: boolean; clean: boolean };

/**
 * Gate shares for one drawing with `drawn` objects (each copy counts, like Spark's count): a row ticked
 * "listed correctly" counts its Spark count; a row ticked "clean cut-out" counts its accepted masks, up to its count.
 * Null until `drawn` is a whole number ≥ 1. Both shares are capped at 100%.
 */
export function gateScore(rows: readonly Tick[], drawn: number): { listed: number; clean: number } | null {
  if (!Number.isInteger(drawn) || drawn < 1) return null;
  const sum = (f: (r: Tick) => number) => rows.reduce((n, r) => n + f(r), 0);
  return {
    listed: Math.min(1, sum((r) => (r.listed ? r.count : 0)) / drawn),
    clean: Math.min(1, sum((r) => (r.clean ? Math.min(r.count, r.accepted) : 0)) / drawn),
  };
}

/** One docs/gate.md row: | File | Objects drawn | Listed | Clean | Time | Cost |. A missing value is "—". */
export function markdownRow(r: { file: string; drawn: number | null; score: { listed: number; clean: number } | null;
  ms: number | null; costMicro: number }): string {
  const cells = [r.file.replace(/\|/g, "\\|"), r.drawn === null ? "—" : String(r.drawn),
    r.score ? pct.format(r.score.listed) : "—", r.score ? pct.format(r.score.clean) : "—",
    r.ms === null ? "—" : seconds(r.ms), dollars(r.costMicro)];
  return `| ${cells.join(" | ")} |`;
}

const WORKER_HINT = "Run the Worker with npx wrangler dev; Vite alone doesn't serve /api.";

/** Plain text for a failed /api/understand call. Never a stack trace. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.status) {
      case 422: return `${e.message}. Pick another image.`;
      case 429: return "Too many requests. Try again in a minute.";
      case 502: return "The model failed or gave an invalid reply. Try again.";
      case 503: return "Today's model budget is used up (sample mode). Try again tomorrow.";
      case 404: return `No API at this address (404). ${WORKER_HINT}`;
      default: return `${e.message}. Try again or pick another image.`;    // 400/413/415 carry the Worker's reason
    }
  }
  if (e instanceof SyntaxError) return `The reply wasn't JSON. ${WORKER_HINT}`;
  if (e instanceof TypeError) return "Couldn't reach the Worker. Check that npx wrangler dev is running, then try again.";
  return "Something went wrong. Try again.";
}

/** Plain text for a failed /api/segment call, shown on the object's row. */
export function segmentNote(e: unknown): string {
  if (e instanceof SegmentError) {
    if (e.status === 429) return "Rate limited (429), still after 3 retries";
    if (e.status === 503) return "Today's model budget is used up (503)";
    return `Request failed (${e.status})`;
  }
  if (e instanceof TypeError) return "Network error";
  return "Unreadable reply";
}

// Object hues for outlines, labels and swatches: data, not chrome. Each keeps white label text ≥ 4.5:1.
const HUES = ["#0b6bcb", "#c62828", "#1d7a3a", "#a84f00", "#00727d", "#ad1457", "#6d4c41", "#6b6100"];

type Outline = { colour: string; label: string; edges: number[]; left: number; top: number };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") =>
  Object.assign(document.createElement(tag), { className: cls, textContent: text });

function setTag(tag: HTMLElement, pass: boolean | null, ok: string, bad: string): void {
  tag.hidden = pass === null;
  tag.className = `tag ${pass ? "ok" : "warn"}`;
  tag.textContent = pass ? ok : bad;
}

class ObjectRow {
  readonly el = el("article", "card pr-obj");
  accepted = 0;
  private readonly facts = el("p", "meta", "Waiting for SAM…");
  private readonly thumbs = el("div", "pr-thumbs");
  private readonly listed: HTMLInputElement;
  private readonly clean: HTMLInputElement;

  constructor(readonly obj: SceneObject, readonly colour: string, samUsed: boolean, onTick: () => void) {
    const head = el("div", "pr-head"), swatch = el("span", "swatch");
    swatch.style.background = colour;
    swatch.setAttribute("aria-hidden", "true");
    head.append(swatch, el("h3", "", obj.noun),
      el("span", "meta", `Type ${obj.type} · count ${obj.count} · ${obj.sky ? "in the sky" : "on the ground"}`));
    const ticks = el("div", "pr-ticks");
    const box = (text: string, name: string) => {
      const label = el("label", "choice"), input = el("input");
      Object.assign(input, { type: "checkbox", name });
      input.addEventListener("change", onTick);
      label.append(input, text);
      ticks.append(label);
      return input;
    };
    this.listed = box("Listed correctly", "listed");
    this.clean = box("Clean cut-out", "clean");
    this.clean.disabled = !samUsed;
    if (!samUsed) this.facts.textContent = "SAM skipped";
    this.el.append(head, this.facts, this.thumbs, ticks);
  }

  setFacts(text: string): void { this.facts.textContent = text; }

  addThumb(url: string | null, label: string, fill: number, reason: string | null): void {
    const fig = el("figure", "pr-cut"), well = el("div", "pr-well"), cap = el("figcaption");
    if (url) well.append(Object.assign(el("img"), { src: url, alt: `Cut-out of ${label}`, width: 128, height: 128 }));
    else well.append(el("span", "meta", "Empty mask"));
    cap.append(el("span", "", `${label} · fills ${pct1.format(fill)} of its box`), " ",
      el("span", reason ? "tag warn" : "tag ok", reason ? "Rejected" : "Accepted"));
    if (reason) cap.append(el("span", "pr-why", reason));
    fig.append(well, cap);
    this.thumbs.append(fig);
  }

  tick(): Tick {
    return { count: this.obj.count, accepted: this.accepted, listed: this.listed.checked, clean: this.clean.checked };
  }
}

/** The Work_Image with every accepted mask outlined in its object's hue and labelled "noun n". */
function paint(view: HTMLCanvasElement, work: OffscreenCanvas, outlines: readonly Outline[]): void {
  const ctx = view.getContext("2d")!, w = work.width;
  ctx.drawImage(work, 0, 0);
  const fs = Math.max(14, Math.round(Math.max(w, work.height) / 45)), pad = Math.round(fs * 0.3);
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  ctx.textBaseline = "top";
  for (const o of outlines) {
    const path = new Path2D();
    for (const i of o.edges) path.rect((i % w) - 1, Math.floor(i / w) - 1, 3, 3);    // 3 px line
    ctx.fillStyle = o.colour;
    ctx.fill(path);
    const bw = ctx.measureText(o.label).width + 2 * pad, bh = fs + 2 * pad;
    const x = Math.max(0, Math.min(o.left, w - bw)), y = o.top >= bh ? o.top - bh : o.top;
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = "#fff";
    ctx.fillText(o.label, x + pad, y + pad);
  }
}

type Replay = { scene: SparkScene; fixture: ProbeFixture; work: ImageData };

/**
 * "Open world" (replay only, task 6.7): the saved noun replies through the real chain (point and box calls reply
 * empty), then the World_View with walking in a full-window overlay. Resolves with a note for the status line.
 */
async function openReplayWorld(page: HTMLElement, r: Replay, onClose: () => void): Promise<string> {
  const segs = r.fixture.segments;
  const io: ChainIO = {
    segment: async (p) => (p.noun !== undefined && Object.hasOwn(segs, p.noun) ? parseSamOutput(segs[p.noun]) : []),
    point: async () => ({ boxes: [] }),
  };
  const { instances, notFound } = await buildInstances(r.scene, r.work, io);
  const host = el("div");
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-modal", "true");
  host.setAttribute("aria-label", "Replayed world");
  Object.assign(host.style, { position: "fixed", inset: "0", zIndex: "10", background: "var(--bg)" }); // CSSOM, allowed by the CSP
  document.body.append(host);
  page.inert = true;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const world = await openWorld(host, { instances, work: r.work, reducedMotion }).catch((e: unknown) => {
    host.remove();
    page.inert = false;
    throw e;
  });
  const walk = attachWalk(world, host), close = el("button", "", "Close");
  Object.assign(close.style, { position: "absolute", top: "12px", right: "12px" });
  host.append(close);
  const done = () => { walk.dispose(); world.dispose(); host.remove(); page.inert = false; onClose(); };
  close.addEventListener("click", done);
  host.addEventListener("keydown", (e) => { if (e.key === "Escape") done(); });
  host.focus();
  const missing = notFound.map((i) => r.scene.objects[i].noun);
  return `World: ${world.cards.length === 1 ? "1 Card" : `${world.cards.length} Cards`}.`
    + (missing.length ? ` Not found without saved point replies: ${missing.join(", ")}.` : "");
}

const TEMPLATE = `
  <div class="stack">
    <h1>Gate probe</h1>
    <p class="lede">Check one drawing at a time: what Spark lists, how cleanly SAM cuts each object out, and what the
      run takes in time and money.</p>
  </div>
  <section class="card stack" aria-labelledby="pr-in-h">
    <h2 id="pr-in-h">Drawing</h2>
    <fieldset>
      <legend>Model calls</legend>
      <label class="choice"><input type="radio" name="mode" value="live" checked> Live: real calls, costs money
        (≈ $0.01 + $0.0025 per object)</label>
      <label class="choice"><input type="radio" name="mode" value="replay"> Replay saved replies, no calls</label>
      <div class="fx">
        <label for="pr-fx">Saved replies (one .json per drawing)</label>
        <input type="file" id="pr-fx" name="replies" accept="application/json,.json" multiple aria-describedby="pr-fx-st">
        <p class="meta" id="pr-fx-st" aria-live="polite">None loaded.</p>
      </div>
      <label class="choice"><input type="radio" name="mode" value="skip"> Skip SAM: live understand only (≈ $0.01)</label>
    </fieldset>
    <label for="pr-img">Drawing image</label>
    <input type="file" id="pr-img" name="image" accept="image/png,image/jpeg" aria-describedby="pr-img-hint">
    <p class="hint" id="pr-img-hint">PNG or JPEG. Resized to at most 1024&nbsp;px on the long side and sent as a JPEG
      of at most 400&nbsp;KB; not flattened.</p>
    <div class="actions"><button type="button" class="primary pr-run">Analyze drawing</button></div>
    <p class="error" role="alert" hidden></p>
  </section>
  <section class="stack pr-result" aria-labelledby="pr-res-h" hidden>
    <h2 id="pr-res-h">Result</h2>
    <p class="status" aria-live="polite"></p>
    <dl class="pr-sum">
      <div><dt>Total time</dt><dd><span class="pr-time">—</span><span class="tag" hidden></span></dd></div>
      <div><dt>Calls</dt><dd class="pr-calls">—</dd></div>
      <div><dt>Estimated cost</dt><dd><span class="pr-cost">—</span><span class="tag" hidden></span></dd></div>
    </dl>
    <p class="hint pr-sum-hint"></p>
    <div class="actions pr-open-row" hidden><button type="button" class="pr-open">Open world</button></div>
    <figure class="pr-fig">
      <canvas role="img" aria-label="The drawing with the accepted masks outlined"></canvas>
      <figcaption class="meta"></figcaption>
    </figure>
    <p class="pr-scene"></p>
    <div class="pr-objs"></div>
  </section>
  <section class="card stack pr-gate" aria-labelledby="pr-gate-h" hidden>
    <h2 id="pr-gate-h">Gate result</h2>
    <p class="hint">Tick each object above, then enter how many objects the drawing has (each copy counts). A ticked
      row counts its Spark count for Listed, and its accepted masks, up to that count, for Clean.</p>
    <div class="pr-drawn">
      <label for="pr-drawn">Objects drawn</label>
      <input type="number" id="pr-drawn" name="drawn" min="1" max="99" step="1" inputmode="numeric" autocomplete="off">
    </div>
    <dl class="pr-sum">
      <div><dt>Listed</dt><dd><span class="pr-listed">—</span><span class="tag" hidden></span></dd></div>
      <div><dt>Clean cut-outs</dt><dd><span class="pr-clean">—</span><span class="tag" hidden></span></dd></div>
    </dl>
    <p class="meta">Row for docs/gate.md (File | Objects drawn | Listed | Clean | Time | Cost):</p>
    <code class="pr-md" translate="no"></code>
    <div class="actions">
      <button type="button" class="pr-copy">Copy results as Markdown</button>
      <button type="button" class="pr-save">Save replies</button>
    </div>
    <p class="meta pr-msg" aria-live="polite"></p>
  </section>`;

export function mountProbe(main: HTMLElement): void {
  document.title = "Gate probe · Sketch World";
  main.classList.add("pr");
  main.innerHTML = TEMPLATE;
  const $ = <T extends Element = HTMLElement>(sel: string) => main.querySelector<T>(sel)!;
  const fxInput = $<HTMLInputElement>("#pr-fx"), fxStatus = $("#pr-fx-st"), imgInput = $<HTMLInputElement>("#pr-img");
  const runBtn = $<HTMLButtonElement>(".pr-run"), pickErr = $(".card .error");
  const result = $(".pr-result"), status = $(".pr-result .status"), sumHint = $(".pr-sum-hint");
  const view = $<HTMLCanvasElement>(".pr-fig canvas"), caption = $(".pr-fig figcaption");
  const sceneLine = $(".pr-scene"), objs = $(".pr-objs");
  const gate = $(".pr-gate"), drawnInput = $<HTMLInputElement>("#pr-drawn"), md = $(".pr-md"), msg = $(".pr-msg");
  const saveBtn = $<HTMLButtonElement>(".pr-save");
  const openRow = $(".pr-open-row"), openBtn = $<HTMLButtonElement>(".pr-open");
  let replay: Replay | null = null;
  const tagAfter = (sel: string) => $(sel).nextElementSibling as HTMLElement;

  const fixtures = new Map<string, ProbeFixture>();    // image name → saved replies
  let urls: string[] = [];                             // cut-out object URLs of the shown run
  let saveUrl = "";
  let rows: ObjectRow[] = [];
  let last: { file: string; w: number; h: number; scene: SparkScene; segments: Record<string, string>;
    ms: number | null; cost: number } | null = null;

  const fail = (text: string) => { pickErr.textContent = text; pickErr.hidden = false; };

  function updateGate(): void {
    if (!last) return;
    const drawn = drawnInput.valueAsNumber, score = gateScore(rows.map((r) => r.tick()), drawn);
    $(".pr-listed").textContent = score ? pct.format(score.listed) : "—";
    $(".pr-clean").textContent = score ? pct.format(score.clean) : "—";
    setTag(tagAfter(".pr-listed"), score && score.listed >= GATE.listed, "Pass (≥ 80%)", "Below 80%");
    setTag(tagAfter(".pr-clean"), score && score.clean >= GATE.clean, "Pass (≥ 70%)", "Below 70%");
    md.textContent = markdownRow({ file: last.file, drawn: score ? drawn : null, score, ms: last.ms, costMicro: last.cost });
  }

  async function analyze(file: File, mode: Mode): Promise<void> {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      return fail(`This browser can't read ${file.name}. Use a PNG or JPEG; HEIC photos from a phone aren't supported, `
        + "so export them as JPEG first.");
    }
    let work: Awaited<ReturnType<typeof workImage>>;
    try {
      work = await workImage(bitmap);
    } catch (e) {
      return fail(`${file.name} could not be encoded. ${e instanceof Error ? e.message : ""} Try a smaller image.`);
    } finally {
      bitmap.close();
    }
    const { canvas, jpeg } = work, w = canvas.width, h = canvas.height, img = pixels(canvas);

    let fixture: ProbeFixture | undefined;
    if (mode === "replay") {
      fixture = fixtures.get(file.name);
      if (!fixture) {
        return fail(fixtures.size ? `No saved replies for ${file.name}. Loaded: ${[...fixtures.keys()].join(", ")}.`
          : "Load a saved replies file first, or choose Live.");
      }
      if (fixture.image.w !== w || fixture.image.h !== h) {
        return fail(`The saved replies are for a ${fixture.image.w} × ${fixture.image.h} image; this one is ${w} × ${h}.`);
      }
    }

    const outlines: Outline[] = [];
    view.width = w;
    view.height = h;
    paint(view, canvas, outlines);
    caption.textContent = `Work_Image ${w} × ${h} px, JPEG ${int.format(jpeg.size / 1024)} KB. `
      + "Outlines show the accepted masks, labelled with the noun and the mask number.";
    status.textContent = mode === "replay" ? "Replaying the saved replies…" : "Asking Spark what the drawing shows…";
    result.hidden = false;

    const t0 = performance.now();
    let scene: SparkScene;
    if (fixture) scene = fixture.understand;
    else {
      try {
        scene = await understand(jpeg);
      } catch (e) {
        result.hidden = true;
        return fail(errorText(e));
      }
    }
    const sparkMs = performance.now() - t0;
    const total = scene.objects.reduce((n, o) => n + o.count, 0);
    sceneLine.textContent = `Spark: “${scene.title}”, ${scene.view} view, ${scene.objects.length} object types, `
      + `${total} objects in all` + (fixture ? "." : `, replied in ${seconds(sparkMs)}.`);

    const samUsed = mode !== "skip", sam = mode === "live" ? new SamClient() : null;
    const segments: Record<string, string> = {};
    rows = scene.objects.map((o, i) => new ObjectRow(o, HUES[i % HUES.length], samUsed, updateGate));
    objs.replaceChildren(...rows.map((r) => r.el));

    let done = 0;
    const progress = () => { status.textContent = `Cutting out objects… ${done} of ${rows.length} done`; };
    async function cut(row: ObjectRow): Promise<void> {
      const { noun, type } = row.obj;
      let masks: MaskRaster[], ms: number | undefined;
      try {
        if (sam) {
          const r = await sam.segment(jpeg, { noun });
          segments[noun] = r.outputText;
          ({ masks, ms } = r);
        } else {
          const text = fixture!.segments[noun];
          if (text === undefined) return row.setFacts("No saved reply");
          masks = await parseSamOutput(text);
        }
      } catch (e) {
        return row.setFacts(segmentNote(e));
      }
      for (const [i, m] of masks.entries()) {
        const label = `${noun} ${i + 1}`, reason = rejectReason(m, type, w, h), placed = placeMask(m, w, h);
        if (!reason) {
          row.accepted++;
          outlines.push({ colour: row.colour, label, edges: edgePixels(placed, w, h), left: m.left, top: m.top });
        }
        const url = await cutout(img, placed).then((b) => URL.createObjectURL(b), () => null);
        if (url) urls.push(url);
        row.addThumb(url, label, maskFill(m), reason);
      }
      row.setFacts(`${masks.length === 1 ? "1 mask" : `${masks.length} masks`}, ${row.accepted} accepted`
        + (ms === undefined ? "" : ` · SAM ${int.format(ms)} ms`));
    }
    if (samUsed && rows.length) {
      progress();
      await Promise.all(rows.map(async (row) => {
        await cut(row);
        done++;
        progress();
        paint(view, canvas, outlines);
      }));
    }

    const segCalls = samUsed ? rows.length : 0;
    last = { file: file.name, w, h, scene, segments, ms: fixture ? null : performance.now() - t0, cost: costMicro(1, segCalls) };
    status.textContent = rows.length ? "Done." : "Done. Spark listed no objects.";
    $(".pr-time").textContent = last.ms === null ? "—" : seconds(last.ms);
    setTag(tagAfter(".pr-time"), last.ms === null ? null : last.ms < GATE.ms, "Pass (< 40 s)", "Over 40 s");
    $(".pr-calls").textContent = String(1 + segCalls);
    $(".pr-cost").textContent = dollars(last.cost);
    setTag(tagAfter(".pr-cost"), last.cost < GATE.costMicro, "Pass (< $0.05)", "$0.05 or more");
    sumHint.textContent = (fixture ? "Replayed from the saved file: no requests were sent. Calls and cost are what a "
      + "live run makes. " : "Time runs from the understand request to the last cut-out. ")
      + "Spark $0.01 per understand call, SAM $0.0025 per segment call (design.md estimates); a schema retry inside "
      + "the Worker adds $0.01 that this page can't see.";
    saveBtn.disabled = !!fixture;
    replay = fixture ? { scene, fixture, work: img } : null;
    openRow.hidden = !replay;
    msg.textContent = "";
    gate.hidden = false;
    updateGate();
  }

  fxInput.addEventListener("change", async () => {
    fixtures.clear();
    const bad: string[] = [];
    for (const f of fxInput.files ?? []) {
      const fx = parseFixture(await f.text().then((t) => JSON.parse(t) as unknown, () => null));
      if (fx) fixtures.set(fx.image.name, fx);
      else bad.push(f.name);
    }
    fxStatus.textContent = (fixtures.size ? `Replies for ${[...fixtures.keys()].join(", ")}.` : "None loaded.")
      + (bad.length ? ` Not a replies file: ${bad.join(", ")}.` : "");
    if (fixtures.size) $<HTMLInputElement>('input[name="mode"][value="replay"]').checked = true;
  });

  runBtn.addEventListener("click", async () => {
    const file = imgInput.files?.[0];
    if (!file) return fail("Choose a drawing image first.");
    runBtn.disabled = true;
    pickErr.hidden = result.hidden = gate.hidden = true;
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
    rows = [];
    last = replay = null;
    openRow.hidden = true;
    objs.replaceChildren();
    sceneLine.textContent = "";
    try {
      await analyze(file, $<HTMLInputElement>('input[name="mode"]:checked').value as Mode);
    } catch {
      result.hidden = true;
      fail("Something went wrong while analyzing. Try again.");
    } finally {
      runBtn.disabled = false;
    }
  });

  drawnInput.addEventListener("input", updateGate);

  openBtn.addEventListener("click", async () => {
    if (!replay) return;
    openBtn.disabled = true;
    try {
      status.textContent = await openReplayWorld(main, replay, () => { openBtn.disabled = false; openBtn.focus(); });
    } catch {
      openBtn.disabled = false;
      status.textContent = "Couldn't open the world. This browser may have WebGL turned off.";
    }
  });

  $(".pr-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(md.textContent ?? "");
      msg.textContent = "Copied the row for docs/gate.md.";
    } catch {
      msg.textContent = "Copying isn't allowed here. Select the row above and copy it.";
    }
  });

  saveBtn.addEventListener("click", () => {
    if (!last) return;
    const fx: ProbeFixture = { image: { name: last.file, w: last.w, h: last.h }, understand: last.scene, segments: last.segments };
    if (saveUrl) URL.revokeObjectURL(saveUrl);
    saveUrl = URL.createObjectURL(new Blob([JSON.stringify(fx, null, 2) + "\n"], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: saveUrl, download: fixtureName(last.file) }).click();
    msg.textContent = `Saved ${fixtureName(last.file)}. Put it in test/fixtures/meta/gate/ to replay it later.`;
  });
}
