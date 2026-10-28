// Site pages inside the static shell of index.html (header, footer, toasts). Home is src/ui/home.ts and the Gallery
// src/ui/gallery.ts; Create (src/ui/create.ts) and the /w/:id Viewer (src/ui/viewer.ts) load with import(), so Home's
// entry chunk stays small and three.js stays out of it. Templates are static markup; user strings go into the DOM only
// via textContent (Requirement 17.18).
import { match, type Route } from "../router";
import { mountGallery } from "./gallery";
import { mountHome } from "./home";

const PAGES: Record<Route["page"], { title: string; html: string }> = {
  home: { title: "", html: "" },               // src/ui/home.ts renders it
  create: { title: "Make a world", html: "" }, // src/ui/create.ts renders it
  gallery: { title: "Gallery", html: "" },     // src/ui/gallery.ts renders it
  world: { title: "World", html: "" },         // src/ui/viewer.ts renders it, and sets the world's title
  missing: { title: "Page not found", html: `
    <div class="stack">
      <h1>This page is not in the book</h1>
      <p class="lede">The link may be mistyped, or the world it pointed to was deleted.</p>
      <div class="actions"><a class="btn primary" href="/">Go to the home page</a><a class="btn" href="/create">Make a world</a></div>
    </div>` },
};

let leave: (() => void) | undefined; // the shown page's clean-up (Create and the Viewer dispose their world)
let visit = 0;

const failed = () => Object.assign(document.createElement("p"), { className: "error", textContent: "This page couldn’t load. Reload to try again." });

export function showPage(main: HTMLElement, route: Route, first: boolean): void {
  leave?.();
  leave = undefined;
  const page = PAGES[route.page], me = ++visit;
  document.title = page.title ? `${page.title} · Sketch World` : "Sketch World";
  main.innerHTML = page.html;
  if (route.page === "home") mountHome(main);
  if (route.page === "gallery") leave = mountGallery(main);
  if (route.page === "create") {
    import("./create").then((m) => { if (me === visit) leave = m.mountCreate(main); }).catch(() => { if (me === visit) main.replaceChildren(failed()); });
  }
  if (route.page === "world") {
    const { id } = route;
    import("./viewer").then((m) => { if (me === visit) leave = m.mountViewer(main, id); }).catch(() => { if (me === visit) main.replaceChildren(failed()); });
  }
  for (const a of document.querySelectorAll<HTMLAnchorElement>(".nav a")) {
    if (match(a.pathname).page === route.page) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
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
