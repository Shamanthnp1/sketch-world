import { describe, expect, it } from "vitest";
import { match } from "../../src/router";

describe("match", () => {
  it("maps the site paths, with or without a trailing slash", () => {
    expect(match("/")).toEqual({ page: "home" });
    expect(match("/create")).toEqual({ page: "create" });
    expect(match("/create/")).toEqual({ page: "create" });
    expect(match("/gallery")).toEqual({ page: "gallery" });
  });

  it("reads a 10-char base62 world id", () => {
    expect(match("/w/aZ09bY18cX")).toEqual({ page: "world", id: "aZ09bY18cX" });
    expect(match("/w/aZ09bY18cX/")).toEqual({ page: "world", id: "aZ09bY18cX" });
  });

  it("sends everything else to the not-found page", () => {
    for (const p of ["/w/short", "/w/aZ09bY18cX1", "/w/aZ09bY18c-", "/w/aZ09bY18cX/x", "/w/", "/Create", "/nope", "/api/x"]) {
      expect(match(p)).toEqual({ page: "missing" });
    }
  });
});
