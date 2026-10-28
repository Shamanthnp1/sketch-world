/// <reference types="vite/client" />
// Shared by the route tests: fixture bytes and requests through the Worker's router.
import { exports } from "cloudflare:workers";
import jpegUrl from "../fixtures/images/world-640.jpg?inline";       // 640 × 360 JPEG
import pngUrl from "../fixtures/images/line-drawing.png?inline";     // 512 × 384 PNG

const bytes = (dataUrl: string) => Uint8Array.from(atob(dataUrl.split(",")[1]!), (c) => c.charCodeAt(0));
export const jpg = bytes(jpegUrl), png = bytes(pngUrl);

/** A body-less request through the router. */
export const call = (method: string, path: string, headers?: HeadersInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, { method, headers }));

/** POST /api/worlds through the router with these multipart fields, in this order. */
export const save = (fields: Record<string, string | File>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return exports.default.fetch(new Request("https://example.com/api/worlds", { method: "POST", body }));
};
