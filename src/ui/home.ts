// Home page at / (Requirement 17.6): a paper pop-up book hero, the draw → photo → walk explainer and the gallery
// strip, filled from GET /api/gallery. Static markup and the app's own SVG drawings only (17.5); dynamic text goes in
// via textContent (17.18). Nothing here imports three.js (17.14). No inline style attributes (the CSP of 12.7).
import type { GalleryReply } from "../../shared/saved";
import { getGallery } from "../api";
import "./home.css";

/** One saved world as a gallery card shows it: a GalleryWorld without createdAt. */
export type GalleryItem = { id: string; title: string; thumb: string };

export const STRIP_MAX = 6;
/** The Home strip: the sample worlds first, then the newest, each world once, at most `max`. */
export function stripItems({ samples, worlds }: GalleryReply, max = STRIP_MAX): GalleryItem[] {
  const seen = new Set<string>();
  return [...samples, ...worlds].filter((w) => !seen.has(w.id) && !!seen.add(w.id)).slice(0, max)
    .map(({ id, title, thumb }) => ({ id, title, thumb }));
}

// Line art of the drawing, shared by the hero and the explainer. Paths carry no fill or stroke, so each <use> styles
// them: .cut draws the white paper edge of a cut-out, .ink the pen lines on top.
const ART = `
<svg class="vh" aria-hidden="true" focusable="false"><defs>
  <filter id="hp-shadow" x="-10%" y="-10%" width="130%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#342816" flood-opacity="0.25"/></filter>
  <g id="a-house"><path d="M14 62 70 14l56 48"/><path d="M26 56v64h88V56"/><path d="M60 120V90h20v30"/><path d="M90 70h14v14H90z"/><path d="M96 37V20h12v27"/></g>
  <g id="a-tree"><path d="M52 12C70 10 84 24 82 40 96 46 96 70 80 76 76 92 58 94 52 88 44 96 24 92 22 76 8 70 8 48 22 42 20 24 34 12 52 12z"/><path d="M44 146V89M60 146V89M60 110l12-10"/></g>
  <g id="a-sun"><path d="M72 50A22 22 0 1 1 28 50 22 22 0 1 1 72 50z"/><path d="M80 50h10M20 50H10M50 20V10M50 80v10M71.2 28.8l7.1-7.1M28.8 28.8l-7.1-7.1M28.8 71.2l-7.1 7.1M71.2 71.2l7.1 7.1M43 45v3M57 45v3M42 56c4 4 12 4 16 0"/></g>
  <g id="a-cloud"><path d="M30 70C10 70 8 46 28 44 26 26 48 18 60 30 66 12 100 12 106 30 122 20 144 34 138 50 156 52 154 72 134 70z"/></g>
  <g id="a-bird"><path d="M6 20C14 8 22 8 28 18 34 8 42 8 50 20"/></g>
  <g id="a-person"><path d="M26 13A8 8 0 1 1 10 13 8 8 0 1 1 26 13z"/><path d="M18 21v31M6 34l12-6 12 6M18 52 9 80M18 52l9 28"/></g>
  <g id="a-flower"><path d="M15 64V28"/><path d="M15 50C8 48 5 42 6 38c5 2 9 6 9 12z"/><circle cx="15" cy="8" r="5"/><circle cx="24.5" cy="15" r="5"/><circle cx="21" cy="26" r="5"/><circle cx="9" cy="26" r="5"/><circle cx="5.5" cy="15" r="5"/><circle cx="15" cy="17.5" r="4"/></g>
  <g id="a-hill"><path d="M0 120C40 70 90 44 150 64 200 28 280 16 330 54 380 34 460 52 520 120z"/><path d="M118 104l-3-9M124 104V93M130 104l3-9M378 98l-3-9M384 98V87M390 98l3-9"/></g>
</defs></svg>`;

// One cut-out card: the white paper edge, then the pen lines.
const cut = (id: string, extra = "") => `<use class="cut" href="#${id}"/>${extra}<use class="ink" href="#${id}"/>`;
const SUN_DISC = `<circle class="sun" cx="50" cy="50" r="22"/>`;
const DRAWING = `<g class="ink thin">
  <use href="#a-cloud" transform="translate(58 46) scale(.4)"/><use href="#a-sun" transform="translate(206 38) scale(.48)"/>
  <use href="#a-tree" transform="translate(72 92) scale(.62)"/><use href="#a-house" transform="translate(138 106) scale(.66)"/>
  <use href="#a-flower" transform="translate(240 150) scale(.62)"/></g>`;
const SHEET = `<rect class="page" x="44" y="30" width="232" height="174" rx="3" filter="url(#hp-shadow)"/>`;
const tag = (x: number, y: number, w: number, text: string) =>
  `<g class="tag"><rect x="${x}" y="${y}" width="${w}" height="24" rx="3"/><text x="${x + w / 2}" y="${y + 17}">${text}</text></g>`;

// "Walk a sample world" opens /gallery until the gallery reply names a sample world; mountHome then links its /w/<id>.
const HTML = `<div class="home">${ART}
<section class="hero" aria-labelledby="home-h">
  <div class="wrap">
    <div class="hero-text">
      <h1 class="display" id="home-h"><span class="line"><span>Walk into</span></span> <span class="line"><span>your drawing</span></span></h1>
      <p class="lede">Draw a scene on paper or right here. <span translate="no">Sketch&nbsp;World</span> cuts out every object and stands it up as a paper
        pop-up world you can walk through.</p>
      <div class="actions"><a class="btn primary" href="/create">Make a world</a><a class="btn hero-sample" href="/gallery">Walk a sample world</a></div>
    </div>
    <div class="hero-art">
      <div class="book-scene" role="img" aria-label="An open pop-up book: a house, a tree, flowers and a person stand up from its pages under the sun, a cloud and a bird">
        <svg class="book" viewBox="0 0 640 480" focusable="false">
          <path class="cover" d="M14 276Q320 254 626 276L640 448Q320 432 0 448Z"/>
          <path class="edge" d="M18 434C118 422 228 420 318 430V440C228 430 118 432 18 444ZM622 434C522 422 412 420 322 430V440C412 430 522 432 622 444Z"/>
          <path class="page" d="M318 262C228 258 118 262 34 278L18 434C118 422 228 420 318 430ZM322 262C412 258 522 262 606 278L622 434C522 422 412 420 322 430Z"/>
          <path class="gutter" d="M322 262C328 262 334 262 338 263L336 430C332 430 326 430 322 430Z"/>
        </svg>
        <div class="pop p-sun"><svg class="glow" viewBox="0 0 100 200" focusable="false"><rect class="tab" x="46" y="70" width="8" height="130"/>${cut("a-sun", SUN_DISC)}</svg></div>
        <div class="pop p-hill"><svg viewBox="-10 10 540 120" focusable="false"><use class="cut" href="#a-hill"/><use class="ink hill" href="#a-hill"/></svg></div>
        <div class="pop p-house"><svg viewBox="0 0 140 134" focusable="false">${cut("a-house")}</svg></div>
        <div class="pop p-tree"><svg class="sway" viewBox="0 0 104 156" focusable="false">${cut("a-tree")}</svg></div>
        <div class="pop p-flower-a"><svg class="sway" viewBox="-9 -6 48 80" focusable="false">${cut("a-flower")}</svg></div>
        <div class="pop p-person"><svg class="wander" viewBox="-4 -4 44 94" focusable="false">${cut("a-person")}</svg></div>
        <div class="pop p-flower-b"><svg class="sway" viewBox="-9 -6 48 80" focusable="false">${cut("a-flower")}</svg></div>
        <div class="pop p-cloud"><svg class="drift" viewBox="-2 4 166 78" focusable="false">${cut("a-cloud")}</svg></div>
        <div class="pop p-bird"><svg class="fly" viewBox="-4 0 64 30" focusable="false">${cut("a-bird")}</svg></div>
      </div>
      <div class="hero-controls"><button type="button" class="pause-btn" aria-pressed="false">Pause motion</button><button type="button" class="fold-btn">Fold it flat</button></div>
    </div>
  </div>
</section>
<section class="how" aria-labelledby="how-h">
  <div class="wrap">
    <h2 id="how-h">Draw, photo, walk</h2>
    <ol>
      <li class="f-draw reveal">
        <h3>First, draw a scene</h3>
        <p>Use paper and a dark pen, or draw on the pad here. Houses, trees, animals, water, hills and the sky all work.</p>
        <svg class="how-pic" viewBox="0 0 320 240" aria-hidden="true" focusable="false">
          <g transform="rotate(-3 160 120)">${SHEET}${DRAWING}</g>
          <g transform="rotate(-36 250 200)"><rect class="sun" x="196" y="194" width="92" height="12" rx="2"/><path class="nib" d="M196 194 180 200l16 6z"/></g>
        </svg>
      </li>
      <li class="f-photo reveal">
        <h3>Then take a photo</h3>
        <p>Tap the paper’s four corners. <span translate="no">Muse&nbsp;Spark</span> names each thing you drew, and <span translate="no">SAM&nbsp;3.1</span> cuts every one out.</p>
        <svg class="how-pic" viewBox="0 0 320 240" aria-hidden="true" focusable="false">
          <rect class="desk" x="8" y="8" width="304" height="224" rx="3"/>
          <g transform="translate(160 120) rotate(4) skewX(-6) translate(-160 -120)">${SHEET}${DRAWING}
            <g class="corner"><circle cx="44" cy="30" r="8"/><circle cx="276" cy="30" r="8"/><circle cx="276" cy="204" r="8"/><circle cx="44" cy="204" r="8"/></g>
          </g>
          ${tag(134, 44, 54, "cloud")}${tag(222, 86, 42, "sun")}${tag(22, 120, 46, "tree")}${tag(150, 196, 56, "house")}
        </svg>
      </li>
      <li class="f-walk reveal">
        <h3>Now walk in</h3>
        <p>Each cut-out stands up as you come near, under a sky painted by <span translate="no">Muse&nbsp;Image</span>. Pick things up and move them.</p>
        <svg class="how-pic" viewBox="0 0 320 240" aria-hidden="true" focusable="false">
          <path class="island" d="M8 206C40 176 280 176 312 206 280 236 40 236 8 206Z"/>
          <g filter="url(#hp-shadow)">
            <g transform="translate(236 14) scale(.56)">${cut("a-sun", SUN_DISC)}</g>
            <g transform="translate(18 22) scale(.5)">${cut("a-cloud")}</g>
            <g transform="translate(40 74) scale(.8)">${cut("a-tree")}</g>
            <g transform="translate(136 96) scale(.78)">${cut("a-house")}</g>
            <g transform="translate(252 128) scale(.8)">${cut("a-person")}</g>
          </g>
        </svg>
      </li>
    </ol>
  </div>
</section>
<section class="gal" aria-labelledby="gal-h">
  <div class="wrap reveal">
    <div class="gal-head"><h2 id="gal-h">Worlds people made</h2><a href="/gallery">See the gallery</a></div>
    <div class="gal-strip"></div>
  </div>
</section>
</div>`;

let io: IntersectionObserver | undefined;

/** Renders the Home page into main. */
export function mountHome(main: HTMLElement): void {
  main.innerHTML = HTML;
  const scene = main.querySelector(".book-scene")!;
  const fold = main.querySelector<HTMLButtonElement>(".fold-btn")!;
  fold.addEventListener("click", () => {
    fold.textContent = scene.classList.toggle("flat") ? "Pop it up" : "Fold it flat";
  });
  const pause = main.querySelector<HTMLButtonElement>(".pause-btn")!; // the idle loops run longer than 5 s (WCAG 2.2.2)
  pause.addEventListener("click", () => { pause.ariaPressed = String(scene.classList.toggle("paused")); });
  const strip = main.querySelector(".gal-strip")!, sample = main.querySelector<HTMLAnchorElement>(".hero-sample")!;
  renderGalleryStrip(strip, []);
  // A failed request keeps the empty state. After leaving Home this fills the detached old elements, which is harmless.
  getGallery().then((g) => {
    renderGalleryStrip(strip, stripItems(g));
    if (g.samples[0]) sample.href = `/w/${encodeURIComponent(g.samples[0].id)}`;
  }, () => {});
  reveal(main);
}

/** Fills host with one paper card per world (title via textContent), or the empty state when there are none. */
export function renderGalleryStrip(host: Element, items: GalleryItem[]): void {
  if (!items.length) {
    host.innerHTML = `<div class="strip-empty"><div class="strip-slots" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
      <p>No worlds here yet. Worlds you save are shared by link, and pop up here once approved.</p></div>`;
    return;
  }
  host.replaceChildren(worldCards(items));
}

/** A ul.strip of a.world-card prints, one per world: a lazy 4:3 thumbnail and the title via textContent. Home and Gallery share it. */
export function worldCards(items: readonly GalleryItem[]): HTMLUListElement {
  const list = Object.assign(document.createElement("ul"), { className: "strip" });
  for (const item of items) {
    const card = Object.assign(document.createElement("a"), { className: "world-card", href: `/w/${encodeURIComponent(item.id)}` });
    const img = Object.assign(document.createElement("img"), { src: item.thumb, alt: "", width: 640, height: 480, loading: "lazy", decoding: "async" });
    const title = Object.assign(document.createElement("span"), { className: "world-card-title", textContent: item.title });
    card.append(img, title);
    const li = document.createElement("li");
    li.append(card);
    list.append(li);
  }
  return list;
}

// Each .reveal block's parts rise in once as it enters the screen; with reduced motion nothing is hidden.
function reveal(root: HTMLElement): void {
  io?.disconnect();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
  io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.remove("pending"); io!.unobserve(e.target); }
  }, { rootMargin: "0px 0px -12% 0px" });
  for (const el of root.querySelectorAll(".reveal")) { el.classList.add("pending"); io.observe(el); }
}
