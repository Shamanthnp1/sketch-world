// Image type and pixel size from header bytes only: the Worker never decodes images (10 ms CPU budget).
export interface ImageInfo { type: "image/png" | "image/jpeg"; width: number; height: number; }

const sized = (type: ImageInfo["type"], width: number, height: number): ImageInfo | null =>
  width > 0 && height > 0 ? { type, width, height } : null;

export function imageInfo(b: Uint8Array): ImageInfo | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  const be16 = (i: number) => (b[i]! << 8) | b[i + 1]!;

  // PNG: 8-byte signature, then the IHDR chunk with big-endian width and height at bytes 16–23.
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 4) === "PNG" && ascii(12, 16) === "IHDR") {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return sized("image/png", view.getUint32(16), view.getUint32(20));
  }

  // JPEG: walk the marker segments to the first frame header (SOFn: FF Cn, length, precision, height, width).
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1]!;
    if (m === 0xff) { i++; continue; }                                    // fill byte
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return sized("image/jpeg", be16(i + 7), be16(i + 5));
    if (m === 0xda || m === 0xd9) return null;                            // scan data or end before any frame header
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue; }   // standalone markers have no length
    i += 2 + be16(i + 2);
  }
  return null;
}
