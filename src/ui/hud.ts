// The HUD over the World_View (design.md "Visual Design", "placeDrag"; Requirements 14.9, 15.12–15.15, 17.9, 17.10):
// a paper strip with the world title, Objects, Pause motion, Reset positions, Help and Save & share; the Objects panel
// lists every Card by label, highlights the selected one and nudges it 0.25 through world.place; a controls help
// dialog opens on the first visit. No three.js here: everything 3D goes through World. User strings via textContent.
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

export interface HudOptions { title: string; onSave?: () => void } // onSave: task 9.5; without it Save & share is a disabled placeholder
export interface Hud { bar: HTMLElement; dispose(): void }           // bar: the strip, for page controls such as Close

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
  const help = button("Help"), save = button("Save & share", "primary"), saveWhy = el("span", "", "Saving is coming soon");
  objects.setAttribute("aria-expanded", "false");
  objects.setAttribute("aria-controls", "hud-objects");
  pause.setAttribute("aria-pressed", "false");
  pause.hidden = world.reducedMotion; // nothing moves with reduced motion
  saveWhy.id = "hud-save-why";
  saveWhy.hidden = true;
  if (opts.onSave) save.addEventListener("click", opts.onSave);
  else { // aria-disabled, not disabled: it stays focusable, so keyboard and screen reader users hear why
    save.title = "Coming soon";
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
    if (c.kind === "terrain") return say(`${c.label} can't be moved`);
    const k = nudgeDelta(c.kind, d, world.camera.rotation.y); // walk keeps the camera's yaw in rotation.y
    const moved = world.place(c, { x: c.pos.x + k.x, y: c.pos.y + k.y, z: c.pos.z + k.z });
    say(`${c.label} ${moved ? "moved" : "can't move"} ${word(c.kind, d)}`);
  }

  for (const c of world.cards) {
    const b = button(c.label), li = el("li");
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => select(sel === c ? null : c));
    b.addEventListener("keydown", (e) => {
      const d = KEYS.get(e.key);
      if (!d || e.altKey || e.ctrlKey || e.metaKey || ((d === "raise" || d === "lower") && c.kind !== "float")) return;
      e.preventDefault(); // walk skips keys a control already used, and the page doesn't scroll
      if (sel !== c) select(c);
      nudge(d);
    });
    li.append(b);
    list.append(li);
    rows.set(c, b);
  }
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
  reset.addEventListener("click", () => { world.reset(); say("Positions reset"); });

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

  return {
    bar,
    dispose() {
      world.select(null);
      layer.remove();
    },
  };
}
