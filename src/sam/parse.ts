// Turns the Worker's non-streaming `{outputText}` from sam-3.1 into mask rasters.
// All @meta-sam/parser calls live here. Signatures checked against the installed
// @meta-sam/parser 0.1.0 (dist/*.d.ts):
//   parseImageStream<E extends { readonly type: string }>(source: AsyncIterable<E>)
//     : ParsedResponsesStream<ImageSegmentationSnapshot, ImageSegmentationResult>
//     // AsyncIterable of snapshots plus `finalResult: Promise<ImageSegmentationResult>`;
//     // reading finalResult first drains the source without snapshots.
//   recordsOfKind<K extends SegmentationRecordKind>(records: readonly SegmentationRecord[], kind: K)
//     : readonly SegmentationRecordOfKind<K>[]
//   decodeMaskToRaster(mask: SegmentationMask): Uint8Array
//     // row-major 0/1, length width * height; throws InvalidSegmentationMaskError
// A SegmentationMaskRecord has `mask: {encoding, payload, width, height}` (wire `data=H,W`)
// and `bounds: {left, top, right, bottom}` (half-open) giving where the raster sits in the image.
// Malformed lines become diagnostics and yield no records, so bad text returns [];
// lane/stream problems throw a ResponsesStreamError subclass.
import { decodeMaskToRaster, parseImageStream, recordsOfKind } from "@meta-sam/parser";

/** One SAM mask in image (crop) pixels: `data` is row-major 0/1 of width × height, placed at (left, top). */
export type MaskRaster = { data: Uint8Array; width: number; height: number; left: number; top: number };

const lane = { item_id: "msg_0", output_index: 0, content_index: 0 };

// The live API emits delta → content_part.done → completed; replay that shape.
async function* events(text: string) {
  yield { type: "response.output_text.delta", ...lane, delta: text };
  yield { type: "response.content_part.done", ...lane, part: { type: "output_text", text } };
  yield { type: "response.completed" };
}

export async function parseSamOutput(outputText: string): Promise<MaskRaster[]> {
  const { records } = await parseImageStream(events(outputText)).finalResult;
  return recordsOfKind(records, "mask").map(({ mask, bounds }) => ({
    data: decodeMaskToRaster(mask), width: mask.width, height: mask.height, left: bounds.left, top: bounds.top,
  }));
}
