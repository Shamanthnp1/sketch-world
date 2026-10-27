// Browser entry: the gate probe when the URL has ?probe (loaded only then), else a placeholder until task 7.5.
import "./ui/app.css";

const main = document.getElementById("app")!;
if (new URLSearchParams(location.search).has("probe")) (await import("./ui/probe")).mountProbe(main);
else {
  main.innerHTML = `
    <div class="stack">
      <h1>Sketch World is coming soon</h1>
      <p class="lede">Draw a scene and walk through it in 3D. Until then, the
        <a href="?probe">gate probe</a> checks how a drawing is read and cut out.</p>
    </div>`;
}
