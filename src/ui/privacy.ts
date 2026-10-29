// Privacy notice (Requirement 12.1; design.md "Security"): a modal dialog before the first upload, saying where the
// drawing goes, that saved worlds are public and that the saving device can delete them. Accepting is remembered in
// localStorage; Not now, Escape or closing it sends nothing. Text via textContent only.
import "./privacy.css";

export const PRIVACY_KEY = "sketch-world:privacy-v2"; // a new notice text gets a new key, so it shows again

export const PRIVACY_TITLE = "Before your drawing is sent";
export const PRIVACY_POINTS = [
  "Your drawing is sent to Meta’s AI models, which find the things in it and cut them out. For a photo, only the flattened drawing is sent; the photo itself stays on this device.",
  "A world you save is public: anyone with its link can open it, and it may be shown in the Gallery.",
  "The device that saved a world can delete it later.",
] as const;

type Store = Pick<Storage, "getItem" | "setItem">;
const local = (): Store | null => { try { return localStorage; } catch { return null; } };

/** Whether the notice was accepted on this device. Storage off or throwing counts as not yet. */
export function privacyAccepted(store: Store | null = local()): boolean {
  try { return store?.getItem(PRIVACY_KEY) === "1"; } catch { return false; }
}

/** Remembers the acceptance; with storage off it is kept for this page load only (see askPrivacy). */
export function rememberPrivacy(store: Store | null = local()): void {
  try { store?.setItem(PRIVACY_KEY, "1"); } catch { /* private mode: asked again on the next visit */ }
}

let acceptedNow = false; // this page load, for when storage is off

/**
 * Resolves true at once if the notice was accepted before; otherwise shows it as a modal dialog in `host` and
 * resolves true on "Send my drawing", false on "Not now" or Escape. showModal makes the page behind it inert and
 * returns focus to the button that opened it when it closes; Tab and Shift+Tab cycle between the two buttons.
 */
export function askPrivacy(host: HTMLElement): Promise<boolean> {
  if (acceptedNow || privacyAccepted()) return Promise.resolve(true);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") =>
    Object.assign(document.createElement(tag), { className: cls, textContent: text });
  const d = el("dialog", "privacy"), h = el("h2", "", PRIVACY_TITLE), list = el("ul"), acts = el("div", "actions");
  const ok = el("button", "primary", "Send my drawing"), no = el("button", "", "Not now");
  ok.type = no.type = "button";
  h.id = "privacy-h";
  list.id = "privacy-d";
  d.setAttribute("aria-labelledby", h.id);
  d.setAttribute("aria-describedby", list.id);
  for (const t of PRIVACY_POINTS) list.append(el("li", "", t));
  acts.append(ok, no);
  d.append(h, list, acts);
  ok.addEventListener("click", () => {
    acceptedNow = true;
    rememberPrivacy();
    d.close("ok");
  });
  no.addEventListener("click", () => d.close());
  // showModal lets Tab leave for the browser's own toolbar after the last button; keep it cycling between the two.
  d.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const [edge, next] = e.shiftKey ? [ok, no] : [no, ok];
    if (document.activeElement === edge) { e.preventDefault(); next.focus(); }
  });
  host.append(d);
  d.showModal();
  return new Promise((resolve) => {
    d.addEventListener("close", () => { // Escape: cancel, then close with no returnValue
      d.remove();
      resolve(d.returnValue === "ok");
    }, { once: true });
  });
}
