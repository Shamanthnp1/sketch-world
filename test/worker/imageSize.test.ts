import { expect, it } from "vitest";
import { imageInfo } from "../../worker/limits/imageSize";

const u8 = (...parts: number[][]) => new Uint8Array(parts.flat());
const be16 = (n: number) => [n >> 8, n & 0xff];
const be32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

// Signature, then the IHDR chunk: length 13, "IHDR", width, height, depth/colour/compression/filter/interlace.
const png = (w: number, h: number) =>
  u8([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], be32(13), [0x49, 0x48, 0x44, 0x52], be32(w), be32(h), [8, 6, 0, 0, 0]);
const SOI = [0xff, 0xd8];
const APP0 = [0xff, 0xe0, ...be16(16), 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0];   // JFIF
const DHT = [0xff, 0xc4, ...be16(4), 0, 0];   // C4 sits in the SOF range but is not a frame header
const sof = (marker: number, w: number, h: number) => [0xff, marker, ...be16(11), 8, ...be16(h), ...be16(w), 1, 1, 0x11, 0];

it("reads PNG width and height from IHDR", () => {
  expect(imageInfo(png(1024, 768))).toEqual({ type: "image/png", width: 1024, height: 768 });
});

it.each([0xc0, 0xc2])("reads JPEG size from SOF 0x%s after APP0, DHT and a fill byte", (marker) => {
  expect(imageInfo(u8(SOI, APP0, DHT, [0xff], sof(marker, 640, 480)))).toEqual({ type: "image/jpeg", width: 640, height: 480 });
});

it.each([
  ["a PNG cut off inside IHDR", png(10, 10).subarray(0, 20)],
  ["a PNG of width 0", png(0, 10)],
  ["a JPEG with scan data before any frame header", u8(SOI, APP0, [0xff, 0xda, ...be16(2)], sof(0xc0, 640, 480))],
  ["a JPEG cut off inside the frame header", u8(SOI, APP0, sof(0xc0, 640, 480)).subarray(0, 25)],
  ["GIF bytes", u8([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], new Array(30).fill(0))],
])("returns null for %s", (_, bytes) => {
  expect(imageInfo(bytes)).toBeNull();
});
