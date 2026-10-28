// The HUD over the World_View (design.md "Visual Design", "placeDrag"; Requirements 14.9, 15.12–15.15, 16.6, 17.9,
// 17.10): a paper strip with the world title, Objects, Pause motion, Reset positions, Help and Save & share; the Objects
// panel lists every Card by label, highlights the selected one and nudges it 0.25 through world.place; a controls help
// dialog opens on the first visit. For saved worlds (task 9.5) it also has the share dialog, Save positions for owners
// and an error slip. No three.js here: everything 3D goes through World. User strings via textContent.
import type { Moves } from "../../shared/saved";
import { ApiError } from "../api";
import type { Card, World } from "../world/build";
import type { Placed } from "../world/layout";
import type { Vec3 } from "../world/space";
import { walkDelta, type Intent } from "../world/walk";
import "./hud.css";

export const NUDGE = 0.25;
export type Nudge = "left" | "right" | "up" | "down" | "raise" | "lower";
const ON_GROUND = new Map<Nudge, Intent>([["left", "left"], ["right", "right"], ["up", "forward"], ["down", "back"]]);

/**
 * One nudge step of 0.25, relative to the camera's yaw: ←/→ sideways and ↑/↓ away/closer on the ground; for sky Cards
 * ↑/↓ go up/down (elevation; placeDrag puts the point back on the sky sphere); raise/lower change a float Card's height.
 */
export function nudgeDelta(kind: Placed["kind"], dir: Nudge, yaw: number): Vec3 {
  const vertical = dir === "raise" || dir === "lower" || (kind === "sky" && (dir === "up" || dir === "down"));
  if (vertical) return { x: 0, y: dir === "raise" || dir === "up" ? NUDGE : -NUDGE, z: 0 };
  const d = walkDelta(new Set([ON_GROUND.get(dir)!]), yaw, NUDGE);
  return { x: d.x, y: 0, z: d.z };
}

const KEYS = new Map<string, Nudge>([
  ["ArrowLeft", "left"], ["ArrowRight", "right"], ["ArrowUp", "up"], ["ArrowDown", "down"], ["PageUp", "raise"], ["PageDown", "lower"],
]);
const word = (kind: Placed["kind"], d: Nudge) =>
  d === "up" ? (kind === "sky" ? "up" : "away") : d === "down" ? (kind === "sky" ? "down" : "closer")
    : d === "raise" ? "up" : d === "lower" ? "down" : d;

const HELP_KEY = "sketch-world:help-seen";
const HELP_KEYS = [
  "W and S or ↑\u00a0and\u00a0↓ walk, A and D step sideways, ←\u00a0and\u00a0→ turn.",
  "Drag empty space to look around.",
  "Drag an object to move it.",
  "Click an object to see its name.",
  "Objects lists everything: pick one, then move it with the arrow buttons or the arrow keys.",
];
const HELP_TOUCH = [
  "Hold ↑\u00a0or\u00a0↓ to walk, ↺\u00a0or\u00a0↻ to turn.",
  "Drag with one finger to look around.",
  "Press and hold an object, then drag it to move it.",
  "Tap an object to see its name.",
  "Objects lists everything: pick one, then move it with the arrow buttons.",
];

export interface HudOptions { title: string; onSave?: () => void } // without onSave, Save & share is disabled: "This world can't be saved"
export interface Hud {
  bar: HTMLElement;                    // the strip, for page controls such as Close
  save: HTMLButtonElement;             // Save & share: the page sets its label and busy state
  showError(text: string): void;       // a paper slip under the strip (role="alert") with Dismiss; replaces the previous one
  /** The share dialog for `url`; `open` adds an Open link to `path`, `owner` the note that this device can delete the world. */
  share(url: string, opts?: { open?: string; owner?: boolean }): void;
  /**
   * Save positions (Requirement 16.6), for a saved world this device owns: enabled while the Cards' moves differ from
   * `saved`; a click sends world.moves() through `send`, whose rejection message shows in the error slip.
   */
  offerSavePositions(saved: Moves, send: (moves: Moves) => Promise<void>): void;
  dispose(): void;
}

/** The link that opens saved world `id`. */
export const shareUrl = (origin: string, id: string) => `${origin}/w/${id}`;

/** True if two Moves maps differ in any id or coordinate (exact compare: saved moves round-trip through JSON unchanged). */
export function movesDiffer(a: Moves, b: Moves): boolean {
  const ka = Object.keys(a);
  return ka.length !== Object.keys(b).length || ka.some((k) => {
    const p = a[k]!, q = b[k];
    return !q || p.x !== q.x || p.y !== q.y || p.z !== q.z;
  });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}
const button = (text: string, cls = "") => Object.assign(el("button", cls, text), { type: "button" as const });
const stored = () => { try { return localStorage.getItem(HELP_KEY) === "1"; } catch { return false; } };
const store = () => { try { localStorage.setItem(HELP_KEY, "1"); } catch { /* private mode: show it again next time */ } };

/** Mounts the HUD over an open world in `host` (the World_View's host). Task 7.5 mounts the same world + walk + HUD. */
export function mountHud(host: HTMLElement, world: World, opts: HudOptions): Hud {
  const layer = el("div", "hud-layer"), bar = el("div", "hud");
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", "World controls");
  const objects = button("Objects"), pause = button("Pause motion"), reset = button("Reset positions");
  const help = button("Help"), save = button("Save & share", "primary"), saveWhy = el("span", "", "This world can’t be saved");
  objects.setAttribute("aria-expanded", "false");
  objects.setAttribute("aria-controls", "hud-objects");
  pause.setAttribute("aria-pressed", "false");
  pause.hidden = world.reducedMotion; // nothing moves with reduced motion
  saveWhy.id = "hud-save-why";
  saveWhy.hidden = true;
  const onSave = opts.onSave;
  // The page marks Save & share aria-disabled while it saves; clicks then do nothing.
  if (onSave) save.addEventListener("click", () => { if (save.getAttribute("aria-disabled") !== "true") onSave(); });
  else { // aria-disabled, not disabled: it stays focusable, so keyboard and screen reader users hear why
    save.title = saveWhy.textContent!;
    save.setAttribute("aria-disabled", "true");
    save.setAttribute("aria-describedby", saveWhy.id);
  }
  bar.append(el("h1", "hud-title", opts.title), objects, pause, reset, help, save, saveWhy);

  // Objects panel: one toggle row per Card; the selected row's Card is highlighted and takes the nudges.
  const panel = el("section", "hud-panel"), heading = el("h2", "", "Objects");
  panel.id = "hud-objects";
  panel.hidden = true;
  heading.id = "hud-objects-h";
  panel.setAttribute("aria-labelledby", heading.id);
  const list = el("ul", "hud-list"), rows = new Map<Card, HTMLButtonElement>(), nudges = new Map<Nudge, HTMLButtonElement>();
  const pad = el("div", "hud-nudge"), heights = el("div", "hud-heights");
  const still = el("p", "hud-hint", "Hills and mountains stay where they are, so they have no arrows.");
  const live = el("p", "hud-live");
  live.setAttribute("role", "status");
  const say = (text: string) => { live.textContent = text; };
  let sel: Card | null = null;

  function select(c: Card | null): void {
    sel = c;
    world.select(c);
    for (const [k, b] of rows) b.setAttribute("aria-pressed", String(k === c));
    if (c) rows.get(c)!.scrollIntoView({ block: "nearest" }); // the list scrolls inside a short panel on phones
    pad.hidden = !c || c.kind === "terrain";
    heights.hidden = c?.kind !== "float";
    still.hidden = c?.kind !== "terrain";
    if (!c) return;
    pad.setAttribute("aria-label", `Move ${c.label}`);
    heights.setAttribute("aria-label", `Height of ${c.label}`);
    nudges.get("up")!.setAttribute("aria-label", c.kind === "sky" ? "Move up" : "Move away");
    nudges.get("down")!.setAttribute("aria-label", c.kind === "sky" ? "Move down" : "Move closer");
  }
  function nudge(d: Nudge): void {
    const c = sel;
    if (!c) return;
    if (c.kind === "terrain") return say(`${c.label} can’t be moved`);
    const k = nudgeDelta(c.kind, d, world.camera.rotation.y); // walk keeps the camera's yaw in rotation.y
    const moved = world.place(c, { x: c.pos.x + k.x, y: c.pos.y + k.y, z: c.pos.z + k.z });
    say(`${c.label} ${moved ? "moved" : "can’t move"} ${word(c.kind, d)}`);
  }

  for (const c of world.cards) {
    const b = button(c.label), li = el("li");
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => select(sel === c ? null : c));
    li.append(b);
    list.append(li);
    rows.set(c, b);
  }
  // Arrow keys anywhere in the panel nudge the selected Card; on a row they first select that row's Card.
  panel.addEventListener("keydown", (e) => {
    const d = KEYS.get(e.key), c = [...rows].find(([, b]) => b === e.target)?.[0] ?? sel;
    if (!d || !c || e.altKey || e.ctrlKey || e.metaKey || ((d === "raise" || d === "lower") && c.kind !== "float")) return;
    e.preventDefault(); // walk skips keys a control already used, and the page doesn't scroll
    if (sel !== c) select(c);
    nudge(d);
  });
  for (const [d, glyph, name] of [["up", "↑", ""], ["left", "←", "Move left"], ["down", "↓", ""], ["right", "→", "Move right"]] as const) {
    const b = button(glyph, `hud-${d}`);
    if (name) b.setAttribute("aria-label", name);
    b.addEventListener("click", () => nudge(d));
    nudges.set(d, b);
    pad.append(b);
  }
  for (const [d, text] of [["raise", "Raise"], ["lower", "Lower"]] as const) {
    const b = button(text);
    b.addEventListener("click", () => nudge(d));
    heights.append(b);
  }
  pad.setAttribute("role", "group");
  heights.setAttribute("role", "group");
  const hint = world.cards.length ? "Pick one, then move it with the arrows or the arrow keys." : "This world has no objects to move.";
  panel.append(heading, el("p", "hud-hint", hint), list, pad, heights, still);
  select(null);

  objects.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    objects.setAttribute("aria-expanded", String(open));
    if (open) ((sel && rows.get(sel)) || list.querySelector("button"))?.focus();
    else select(null);
  });
  pause.addEventListener("click", () => {
    const on = pause.getAttribute("aria-pressed") !== "true";
    pause.setAttribute("aria-pressed", String(on));
    world.setPaused(on);
  });
  // Reset positions can be undone: the button says "Undo reset" until something moves again.
  let undo: Vec3[] | null = null;
  const setUndo = (u: Vec3[] | null) => { undo = u; reset.textContent = u ? "Undo reset" : "Reset positions"; };
  reset.addEventListener("click", () => {
    if (undo) {
      world.cards.forEach((c, i) => { c.pos = undo![i]; });
      setUndo(null);
      return say("Positions put back");
    }
    if (!Object.keys(world.moves()).length) return say("Nothing has been moved yet");
    const before = world.cards.map((c) => c.pos);
    world.reset();
    setUndo(before);
    say("Positions reset. Undo reset puts them back.");
  });
  const offFrame = world.onFrame(() => { if (undo && Object.keys(world.moves()).length) setUndo(null); });

  // Controls help: a modal dialog on the first visit, again from Help.
  const dialog = el("dialog", "hud-help"), dh = el("h2", "", "Controls"), steps = el("ul"), ok = button("Got it", "primary");
  dh.id = "hud-help-h";
  dialog.setAttribute("aria-labelledby", dh.id);
  for (const t of matchMedia("(pointer: coarse)").matches ? HELP_TOUCH : HELP_KEYS) steps.append(el("li", "", t));
  dialog.append(dh, steps, ok);
  ok.addEventListener("click", () => dialog.close());
  // Keys stay in the dialog: nothing walks behind it, and Escape closes only the dialog (its own cancel), not the page.
  dialog.addEventListener("keydown", (e) => e.stopPropagation());
  dialog.addEventListener("close", store);
  help.addEventListener("click", () => dialog.showModal());

  layer.append(bar, panel, live, dialog);
  host.append(layer);
  if (!stored()) dialog.showModal();

  let slip: HTMLElement | null = null;
  function showError(text: string): void {
    slip?.remove();
    const s = (slip = el("div", "hud-note")), p = el("p"), ok = button("Dismiss");
    p.setAttribute("role", "alert");
    ok.addEventListener("click", () => { s.remove(); host.focus(); });
    s.append(p, ok);
    bar.after(s);
    p.textContent = text; // after it is in the page, so the alert is announced
  }

  function share(url: string, o: { open?: string; owner?: boolean } = {}): void {
    const d = el("dialog", "hud-help hud-share"), h = el("h2", "", "Share this world"), link = el("input");
    const copy = button("Copy link", "primary"), close = button("Close"), acts = el("div", "actions"), said = el("p", "hud-hint");
    h.id = "hud-share-h";
    d.setAttribute("aria-labelledby", h.id);
    link.id = "hud-share-link";
    Object.assign(link, { type: "url", readOnly: true, value: url, spellcheck: false });
    link.addEventListener("focus", () => link.select());
    const label = Object.assign(el("label", "", "Link"), { htmlFor: link.id });
    said.setAttribute("role", "status");
    acts.append(copy);
    if (o.open) acts.append(Object.assign(el("a", "btn", "Open"), { href: o.open }));
    acts.append(close);
    d.append(h, el("p", "", "Anyone with this link can open the world, and it’s listed in the Gallery."), label, link, said);
    if (o.owner) d.append(el("p", "hud-hint", "This device can delete the world later: open the link here and choose Delete world."));
    d.append(acts);
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(url);
        said.textContent = "Link copied.";
      } catch { // no Clipboard API (or no permission): select the text so the browser's own Copy takes it
        link.focus();
        link.select();
        said.textContent = "The link is selected. Copy it with your browser’s Copy.";
      }
    });
    close.addEventListener("click", () => d.close());
    d.addEventListener("keydown", (e) => e.stopPropagation()); // keys stay in the dialog: nothing walks behind it
    d.addEventListener("close", () => d.remove());
    layer.append(d);
    d.showModal();
  }

  let offPositions = () => {};
  function offerSavePositions(saved: Moves, send: (moves: Moves) => Promise<void>): void {
    if (bar.querySelector(".hud-positions")) return;
    const b = button("Save positions", "hud-positions"), why = el("span", "", "Nothing has moved since the last save");
    why.id = "hud-positions-why";
    why.hidden = true;
    let last = saved, busy = false;
    const sync = () => {
      const off = busy || !movesDiffer(world.moves(), last);
      if ((b.getAttribute("aria-disabled") === "true") === off) return;
      b.setAttribute("aria-disabled", String(off));
      if (off && !busy) b.setAttribute("aria-describedby", why.id);
      else b.removeAttribute("aria-describedby");
    };
    b.addEventListener("click", async () => {
      if (b.getAttribute("aria-disabled") === "true") return;
      const moves = world.moves();
      busy = true;
      b.textContent = "Saving positions…";
      sync();
      try {
        await send(moves);
        last = moves;
      } catch (e) {
        showError(e instanceof ApiError ? e.message : "The positions couldn’t be saved. Try again.");
      } finally {
        busy = false;
        b.textContent = "Save positions";
        b.removeAttribute("aria-disabled");
        sync();
      }
    });
    save.before(b, why);
    offPositions = world.onFrame(sync);
    sync();
  }

  return {
    bar, save, showError, share, offerSavePositions,
    dispose() {
      offFrame();
      offPositions();
      world.select(null);
      layer.remove();
    },
  };
}
