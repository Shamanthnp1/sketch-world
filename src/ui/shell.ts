// Site pages inside the static shell of index.html (header, footer, toasts). Home is src/ui/home.ts; Create is
// src/ui/create.ts, loaded with import() so Home's entry chunk stays small; Gallery and the /w/:id Viewer are
// placeholders until 9.5. Templates are static markup; user strings (the world id) go into the DOM only via
// textContent (Requirement 17.18).
import { match, type Route } from "../router";
import { mountHome } from "./home";
import "./shell.css";

const PAGES: Record<Route["page"], { title: string; html: string }> = {
  home: { title: "", html: "" }, // src/ui/home.ts renders it
  create: { title: "Make a world", html: "" }, // src/ui/create.ts renders it
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

let leave: (() => void) | undefined; // the shown page's clean-up (Create disposes its world)
let visit = 0;

export function showPage(main: HTMLElement, route: Route, first: boolean): void {
  leave?.();
  leave = undefined;
  const page = PAGES[route.page], me = ++visit;
  document.title = page.title ? `${page.title} · Sketch World` : "Sketch World";
  main.innerHTML = page.html;
  if (route.page === "home") mountHome(main);
  if (route.page === "create") {
    import("./create").then((m) => { if (me === visit) leave = m.mountCreate(main); }).catch(() => {
      if (me === visit) main.replaceChildren(Object.assign(document.createElement("p"), { className: "error", textContent: "This page couldn’t load. Reload to try again." }));
    });
  }
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
