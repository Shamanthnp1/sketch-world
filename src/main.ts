// Browser entry: ?probe on any path mounts the gate probe (loaded only then) with its own look; every other URL
// goes through the client-side router into the site shell.
import "./ui/app.css";
import { startRouter } from "./router";
import { showPage } from "./ui/shell";

// zod's JIT probes for eval with new Function, which the CSP (script-src falls back to 'self') reports as a violation;
// jitless skips the probe. This is the object z.config() writes, set here so Home doesn't load zod (it loads with import()).
((globalThis as { __zod_globalConfig?: { jitless?: boolean } }).__zod_globalConfig ??= {}).jitless = true;

const main = document.getElementById("app")!;
if (new URLSearchParams(location.search).has("probe")) {
  // The dev tool keeps its pre-redesign look (Requirement 17.13): no site chrome, and tool.css instead of app.css.
  for (const el of document.querySelectorAll("[data-site]")) el.remove();
  const siteSheets = [...document.styleSheets];
  await import("./ui/tool.css");
  for (const s of siteSheets) s.disabled = true;
  (await import("./ui/probe")).mountProbe(main);
} else {
  startRouter((route, first) => showPage(main, route, first));
}
