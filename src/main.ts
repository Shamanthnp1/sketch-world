// Browser entry: ?probe on any path mounts the gate probe (loaded only then) with its own look; every other URL
// goes through the client-side router into the site shell.
import "./ui/app.css";
import { startRouter } from "./router";
import { showPage } from "./ui/shell";

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
