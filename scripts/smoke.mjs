// npm run smoke: one live call each to muse-spark-1.3, sam-3.1 (noun prompt) and muse-image-1.0 (about $0.02).
// Prints model, status and latency per call, the API's error code/param/message on failure, and a few
// non-secret facts: the echoed `store`, SAM masks with their fill of the box, the image's pixel size.
// Saves each 2xx reply body as test/fixtures/meta/smoke-<spark|sam|image>.json; the image base64 becomes a 1×1 PNG.
import { readFileSync, writeFileSync } from "node:fs";
import { decodeMaskToRaster, parseImageStream, recordsOfKind } from "@meta-sam/parser";

const BASE_URL = "https://api.meta.ai/v1";
const root = new URL("../", import.meta.url);

// The key is read here at runtime only; it is never printed or written anywhere.
const key = readFileSync(new URL(".dev.vars", root), "utf8")
  .split(/\r?\n/)
  .map((line) => line.match(/^\s*MODEL_API_KEY\s*=\s*(.*?)\s*$/)?.[1])
  .find((value) => value !== undefined)
  ?.replace(/^(["'])(.*)\1$/, "$2");
if (!key) {
  console.error("MODEL_API_KEY is missing or empty in .dev.vars");
  process.exit(1);
}

const png = readFileSync(new URL("test/fixtures/images/line-drawing.png", root));
const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const pngSize = (buf) =>
  buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null;

// Replays the non-streaming SAM text as the live stream events, as in src/sam/parse.ts.
const lane = { item_id: "msg_0", output_index: 0, content_index: 0 };
async function* events(text) {
  yield { type: "response.output_text.delta", ...lane, delta: text };
  yield { type: "response.content_part.done", ...lane, part: { type: "output_text", text } };
  yield { type: "response.completed" };
}

async function samFacts(reply) {
  const text = reply.output.filter((o) => o.type === "message").flatMap((o) => o.content)
    .filter((c) => c.type === "output_text").map((c) => c.text).join("");
  const { records } = await parseImageStream(events(text)).finalResult;
  // The raster is H × W of the box, so its mean is the set-pixel fraction of the box.
  return { masks: recordsOfKind(records, "mask").map(({ mask, bounds }) => {
    const raster = decodeMaskToRaster(mask);
    return { bounds, fill: Number((raster.reduce((a, b) => a + b, 0) / raster.length).toFixed(3)) };
  }) };
}

function imageFacts(reply) {
  const item = reply.output.find((o) => o.type === "image_generation_call");
  if (typeof item?.result !== "string") return { image: "missing" };
  const bytes = Buffer.from(item.result, "base64");
  item.result = TINY_PNG;   // keep the fixture small
  return { bytes: bytes.length, png: pngSize(bytes) ?? "not a PNG" };
}

const calls = [
  { fixture: "smoke-spark.json",
    body: { model: "muse-spark-1.3", store: false, reasoning: { effort: "low" }, input: "Reply with exactly one word: ok" } },
  { fixture: "smoke-sam.json", facts: samFacts,
    body: { model: "sam-3.1", store: false, input: [{ type: "message", role: "user", content: [
      { type: "input_text", text: "house" },
      { type: "input_image", image_url: `data:image/png;base64,${png.toString("base64")}` },
    ] }] } },
  { fixture: "smoke-image.json", facts: imageFacts, timeoutMs: 120_000,
    body: { model: "muse-image-1.0", store: false,
      input: "a simple black and white pencil sketch of a sky with two clouds",
      tools: [{ type: "image_generation", output_format: "png", reasoning_strength: "low",
        // The Responses tool rejects "1536x864" ("unknown value"); 1536x1024 is the documented example.
        enable_web_search: false, enable_image_search: false, enable_shell: false, size: "1536x1024" }] } },
];

async function post(body, timeoutMs) {
  const started = Date.now();
  const res = await fetch(`${BASE_URL}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  console.log(JSON.stringify({ model: body.model, status: res.status, latencyMs: Date.now() - started, sentStore: body.store ?? null }));
  if (text.includes(key) || /bearer/i.test(text)) throw new Error(`${body.model}: reply contains auth data, not saved or printed`);
  let error;
  if (!res.ok) {
    try { error = JSON.parse(text).error; } catch { /* not JSON */ }
    console.log(JSON.stringify({ code: error?.code, param: error?.param, message: error?.message }));
  }
  return { status: res.status, ok: res.ok, text, error };
}

let allOk = true;
for (const { fixture, body, facts, timeoutMs = 30_000 } of calls) {
  let r = await post(body, timeoutMs);
  // Only a 400 that names `store` earns one retry without it.
  if (r.status === 400 && /\bstore\b/i.test(JSON.stringify(r.error ?? {}))) {
    const { store, ...rest } = body;
    r = await post(rest, timeoutMs);
  }
  if ([401, 402, 403].includes(r.status)) {
    console.log("auth or billing refused, stopping before any further call");
    process.exit(1);
  }
  if (!r.ok) { allOk = false; continue; }
  const reply = JSON.parse(r.text);
  console.log(JSON.stringify({ model: body.model, storeEcho: reply.store, ...(facts ? await facts(reply) : {}) }));
  writeFileSync(new URL(`test/fixtures/meta/${fixture}`, root), JSON.stringify(reply, null, 2) + "\n");
}
process.exitCode = allOk ? 0 : 1;
