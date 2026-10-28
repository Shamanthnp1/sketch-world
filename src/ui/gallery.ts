// The Gallery at /gallery (task 9.5; Requirements 10.7, 11.8, 17.11): GET /api/gallery as a card grid, one thumbnail per
// world (Home's world cards), the sample worlds first, then the newest. Loading, empty and failed states. No three.js.
// User strings via textContent only (worldCards).
import type { GalleryReply, GalleryWorld } from "../../shared/saved";
import { ApiError, getGallery } from "../api";
import { worldCards } from "./home";
import "./gallery.css";

/** The Gallery's two groups: the samples, and the newest worlds without the samples (so no world shows twice). */
export function galleryGroups({ samples, worlds }: GalleryReply): { samples: GalleryWorld[]; newest: GalleryWorld[] } {
  const ids = new Set(samples.map((w) => w.id));
  return { samples, newest: worlds.filter((w) => !ids.has(w.id)) };
}

const HEAD = `
  <div class="stack">
    <h1>Gallery</h1>
    <p class="lede">Worlds people have made and shared, newest first.</p>
  </div>`;
const EMPTY = `
  <section class="card gallery-empty" aria-labelledby="gallery-empty">
    <h2 id="gallery-empty">No shared worlds yet</h2>
    <p>Save a world and it appears here as a card.</p>
    <div class="actions"><a class="btn primary" href="/create">Make a world</a></div>
  </section>`;

function group(title: string, id: string, items: readonly GalleryWorld[]): HTMLElement {
  const s = Object.assign(document.createElement("section"), { className: "gallery-group" });
  const h = Object.assign(document.createElement("h2"), { id, textContent: title });
  s.setAttribute("aria-labelledby", id);
  s.append(h, worldCards(items));
  return s;
}

/** Fills `main` with the Gallery. Returns the clean-up for leaving the page, so a late reply doesn't fill the next page. */
export function mountGallery(main: HTMLElement): () => void {
  let left = false;
  async function load(): Promise<void> {
    main.innerHTML = `${HEAD}<p class="meta" role="status">Loading the gallery…</p>`;
    let reply: GalleryReply;
    try {
      reply = await getGallery();
    } catch (e) {
      if (left) return;
      main.innerHTML = `${HEAD}<div class="stack"><p class="error" role="alert"></p><button type="button" class="primary">Try again</button></div>`;
      main.querySelector(".error")!.textContent = e instanceof ApiError && e.status === 0 ? e.message : "The gallery couldn’t load. Try again.";
      main.querySelector("button")!.addEventListener("click", () => { void load(); main.focus(); }); // the button is gone: keep focus in main
      return;
    }
    if (left) return;
    const { samples, newest } = galleryGroups(reply);
    main.innerHTML = HEAD;
    if (samples.length) main.append(group("Sample worlds", "gallery-samples", samples));
    if (newest.length) main.append(samples.length ? group("Newest worlds", "gallery-newest", newest) : worldCards(newest));
    if (!samples.length && !newest.length) main.insertAdjacentHTML("beforeend", EMPTY);
  }
  void load();
  return () => { left = true; };
}
