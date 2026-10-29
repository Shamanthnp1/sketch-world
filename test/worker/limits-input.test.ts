import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES, readBox, readImage, readJsonField, readNoun, readText } from "../../worker/limits/input";

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const file = (head: number[], size = head.length) => {
  const bytes = new Uint8Array(size);
  bytes.set(head);
  return new File([bytes], "img");
};
const form = (entries: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};
const status = (r: unknown) => (r instanceof Response ? r.status : "ok");

describe("readImage", () => {
  it("accepts JPEG and PNG of exactly 400 KB", async () => {
    for (const head of [JPEG, PNG]) {
      const r = await readImage(form({ img: file(head, MAX_IMAGE_BYTES) }), "img");
      expect(r).toBeInstanceOf(File);
      expect((r as File).size).toBe(400 * 1024);
    }
  });
  it("returns 413 one byte over 400 KB", async () => {
    expect(status(await readImage(form({ img: file(JPEG, MAX_IMAGE_BYTES + 1) }), "img"))).toBe(413);
  });
  it("returns 415 for GIF, truncated JPEG and empty files", async () => {
    for (const head of [[0x47, 0x49, 0x46, 0x38], [0xff, 0xd8], []]) {
      const r = await readImage(form({ img: file(head) }), "img");
      expect(status(r)).toBe(415);
      expect(await (r as Response).json()).toEqual({ error: "img must be a JPEG or PNG image" });
    }
  });
  it("returns 400 when the field is missing or text", async () => {
    expect(status(await readImage(form({}), "img"))).toBe(400);
    expect(status(await readImage(form({ img: "\xff\xd8\xff" }), "img"))).toBe(400);
  });
});

describe("readText", () => {
  it("applies the 500-char global cap", () => {
    expect(readText(form({ t: "a".repeat(500) }), "t")).toBe("a".repeat(500));
    expect(status(readText(form({ t: "a".repeat(501) }), "t"))).toBe(400);
    expect(status(readText(form({ t: "a".repeat(501) }), "t", 1000))).toBe(400);
  });
  it("applies a tighter field cap", () => {
    expect(readText(form({ t: "a".repeat(40) }), "t", 40)).toBe("a".repeat(40));
    expect(status(readText(form({ t: "a".repeat(41) }), "t", 40))).toBe(400);
  });
  it("returns null when missing and 400 for a file", () => {
    expect(readText(form({}), "t")).toBeNull();
    expect(status(readText(form({ t: file(JPEG) }), "t"))).toBe(400);
  });
});

describe("readNoun", () => {
  it.each(["a", "tree", "fir tree", "t-rex", "a" + "b".repeat(39)])("accepts %j", (noun) => {
    expect(readNoun(form({ noun }))).toBe(noun);
  });
  it.each([
    ["41 chars", "a" + "b".repeat(40)],
    ["empty", ""],
    ["uppercase", "Tree"],
    ["a digit", "tree2"],
    ["a leading space", " tree"],
    ["a leading hyphen", "-tree"],
    ["a trailing newline", "tree\n"],
    ["a non-ASCII letter", "café"],
  ])("returns 400 for %s", async (_, noun) => {
    const r = readNoun(form({ noun }));
    expect(status(r)).toBe(400);
    expect(await (r as Response).json()).toEqual({ error: "noun must be 1–40 lowercase letters, spaces or hyphens, starting with a letter" });
  });
  it("returns null when missing and 400 for a file", () => {
    expect(readNoun(form({}))).toBeNull();
    expect(status(readNoun(form({ noun: file(JPEG) })))).toBe(400);
  });
});

describe("readJsonField", () => {
  // {"a":"xxx…"} of exactly n bytes: 8 bytes of JSON around the filler.
  const json = (n: number) => `{"a":"${"x".repeat(n - 8)}"}`;
  it("parses JSON of exactly the 64 KB default cap and returns 400 one byte over", () => {
    expect(readJsonField(form({ j: json(64 * 1024) }), "j")).toEqual({ a: "x".repeat(64 * 1024 - 8) });
    expect(status(readJsonField(form({ j: json(64 * 1024 + 1) }), "j"))).toBe(400);
  });
  it("counts UTF-8 bytes against a caller-given cap", () => {
    expect(readJsonField(form({ j: '"éé"' }), "j", 6)).toBe("éé");         // 4 chars, 6 bytes
    expect(status(readJsonField(form({ j: '"ééé"' }), "j", 6))).toBe(400); // 5 chars, 8 bytes
  });
  it("returns any JSON value unchecked, including null", () => {
    expect(readJsonField(form({ j: '[1,{"a":null}]' }), "j")).toEqual([1, { a: null }]);
    expect(readJsonField(form({ j: "null" }), "j")).toBeNull();
  });
  it.each([
    ["invalid JSON", form({ j: "{a:1}" })],
    ["empty text", form({ j: "" })],
    ["a file", form({ j: file(JPEG) })],
    ["a missing field", form({})],
  ])("returns 400 for %s", (_, f) => {
    expect(status(readJsonField(f, "j"))).toBe(400);
  });
});

describe("readBox", () => {
  it("accepts finite values at 0 and 4096", () => {
    expect(readBox(form({ box: '{"x":0,"y":10.5,"w":4096,"h":100}' }))).toEqual({ x: 0, y: 10.5, w: 4096, h: 100 });
  });
  it.each([
    ['{"x":-1,"y":0,"w":1,"h":1}'],
    ['{"x":0,"y":0,"w":4097,"h":1}'],
    ['{"x":1e999,"y":0,"w":1,"h":1}'], // JSON.parse gives Infinity
    ['{"x":NaN,"y":0,"w":1,"h":1}'],
    ['{"x":"1","y":0,"w":1,"h":1}'],
    ['{"x":0,"y":0,"w":1}'],
    ["not json"],
  ])("returns 400 for %s", (box) => {
    expect(status(readBox(form({ box })))).toBe(400);
  });
  it("returns 400 when missing", () => {
    expect(status(readBox(form({})))).toBe(400);
  });
});

describe("readForm in the multipart model routes", () => {
  // A chunked body has no Content-Length, so only counting its bytes can refuse it before formData() parses it whole.
  it.each(["/api/understand", "/api/segment", "/api/point"])("POST %s refuses a streamed body over its cap with 413 and no model call", async (path) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const body = new Blob([new Uint8Array(MAX_IMAGE_BYTES + 17 * 1024)]).stream();    // the 400 KB image cap + 16 KB framing, plus 1 KB
    const req = new Request(`https://example.com${path}`, { method: "POST", body, headers: { "Content-Type": "multipart/form-data; boundary=x" } });
    expect(req.headers.get("Content-Length")).toBeNull();

    const res = await exports.default.fetch(req);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "Request body is too large" });
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
});
