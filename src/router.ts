// Client-side router (History API) for the site pages. Wrangler's SPA fallback serves index.html for every path.
// Same-origin <a href> clicks are handled here; links with a query (?probe), a hash, a target or a download, and
// /api/ or /a/ paths load normally.

export type Route =
  | { page: "home" }
  | { page: "create" }
  | { page: "gallery" }
  | { page: "world"; id: string }
  | { page: "missing" };

const WORLD = /^\/w\/([0-9A-Za-z]{10})$/; // world ids are 10 base62 chars (design.md)

export function match(path: string): Route {
  const p = path.replace(/(.)\/+$/, "$1"); // "/create/" is "/create"
  if (p === "/") return { page: "home" };
  if (p === "/create") return { page: "create" };
  if (p === "/gallery") return { page: "gallery" };
  const w = WORLD.exec(p);
  return w ? { page: "world", id: w[1] } : { page: "missing" };
}

/** Calls show for the current URL now and after every in-app navigation or back/forward step. */
export function startRouter(show: (route: Route, first: boolean) => void): void {
  let shown = location.pathname;
  const go = () => {
    shown = location.pathname;
    show(match(shown), false);
  };
  document.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[href]");
    if (!(a instanceof HTMLAnchorElement) || e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target || a.hasAttribute("download")) return;
    const url = new URL(a.href);
    if (url.origin !== location.origin || url.search || url.hash || /^\/(api|a)\//.test(url.pathname)) return;
    e.preventDefault();
    if (url.pathname === shown) return;
    history.pushState(null, "", url.pathname);
    go();
  });
  // Hash jumps (the skip link) also fire popstate; only a path change is a new page.
  addEventListener("popstate", () => { if (location.pathname !== shown) go(); });
  show(match(shown), true);
}
