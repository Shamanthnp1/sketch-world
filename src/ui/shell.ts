// Site pages inside the static shell of index.html (header, footer, toasts). Home is src/ui/home.ts; the others are
// placeholders until their task builds them: Create 7.5, Gallery and the /w/:id Viewer 9.5. Templates are static markup; user
// strings (the world id) go into the DOM only via textContent (Requirement 17.18).
import { match, type Route } from "../router";
import { mountHome } from "./home";
import "./shell.css";

const PAGES: Record<Route["page"], { title: string; html: string }> = {
  home: { title: "", html: "" }, // src/ui/home.ts renders it
  create: { title: "Make a world", html: `
    <div class="stack">
      <h1>Make a world</h1>
      <p class="lede">Start from a drawing on paper, or draw one here.</p>
      <p class="meta" id="create-soon">Both ways open in the next build.</p>
    </div>
    <div class="grid">
      <section class="card" aria-labelledby="create-photo">
        <h2 id="create-photo">Photo of a drawing</h2>
        <p>Take a photo of your drawing, then mark its four corners so the paper lies flat.</p>
        <div class="actions"><button type="button" class="primary" disabled aria-describedby="create-soon">Choose a photo</button></div>
      </section>
      <section class="card" aria-labelledby="create-draw">
        <h2 id="create-draw">Draw here</h2>
        <p>Draw in black on white with a mouse, a pen or your finger.</p>
        <div class="actions"><button type="button" disabled aria-describedby="create-soon">Start drawing</button></div>
      </section>
      <section class="card" aria-labelledby="create-steps">
        <h2 id="create-steps">While your world is made</h2>
        <ol class="steps">
          <li class="done">Reading your drawing<span class="vh"> (done)</span></li>
          <li aria-current="step">Cutting out the objects</li>
          <li>Popping up your world</li>
        </ol>
      </section>
    </div>` },
  gallery: { title: "Gallery", html: `
    <div class="stack">
      <h1>Gallery</h1>
      <p class="lede">Worlds people have made and shared, newest first.</p>
    </div>
    <div class="grid">
      <section class="card" aria-labelledby="gallery-empty">
        <h2 id="gallery-empty">No shared worlds yet</h2>
        <p>Save a world and it appears here as a card.</p>
        <div class="actions"><a class="btn primary" href="/create">Make a world</a></div>
      </section>
    </div>` },
  world: { title: "World", html: `
    <div class="stage">
      <div class="hud">
        <h1 class="hud-title"></h1>
        <button type="button" disabled>Objects</button>
        <button type="button" disabled>Reset positions</button>
        <button type="button" class="hud-pause" aria-pressed="false">Pause motion</button>
        <button type="button" class="primary hud-save">Save &amp; share</button>
      </div>
      <p class="stage-note">The walkable world opens here.</p>
    </div>` },
  missing: { title: "Page not found", html: `
    <div class="stack">
      <h1>This page is not in the book</h1>
      <p class="lede">The link may be mistyped, or the world it pointed to was deleted.</p>
      <div class="actions"><a class="btn primary" href="/">Go to the home page</a><a class="btn" href="/create">Make a world</a></div>
    </div>` },
};

export function showPage(main: HTMLElement, route: Route, first: boolean): void {
  const page = PAGES[route.page];
  document.title = page.title ? `${page.title} · Sketch World` : "Sketch World";
  main.innerHTML = page.html;
  if (route.page === "home") mountHome(main);
  for (const a of document.querySelectorAll<HTMLAnchorElement>(".nav a")) {
    if (match(a.pathname).page === route.page) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  if (route.page === "world") {
    main.querySelector(".hud-title")!.textContent = `World ${route.id}`;
    const pause = main.querySelector<HTMLButtonElement>(".hud-pause")!;
    pause.addEventListener("click", () => { pause.ariaPressed = String(pause.ariaPressed !== "true"); });
    main.querySelector(".hud-save")!.addEventListener("click", () => toast("Saving and sharing open in a later build."));
  }
  if (!first) {
    scrollTo(0, 0);
    main.focus();
  }
}

/** Shows a short message in the page's polite live region for 4 s. */
export function toast(text: string): void {
  const t = Object.assign(document.createElement("p"), { className: "toast", textContent: text });
  document.querySelector(".toasts")!.append(t);
  setTimeout(() => t.remove(), 4000);
}
