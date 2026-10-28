// Types shared by the cut-out chain (src/cut/*).
import type { ObjType, PxBox } from "../../shared/scene";
import type { MaskRaster } from "../sam/parse";

/** A SAM mask competing for scene object `objIndex`. `area` = set pixels of `mask`; `id` breaks sort ties. */
export type Candidate = { id: number; objIndex: number; mask: MaskRaster; area: number };

/** The stage that produced an Instance's mask (Requirement 5.10). */
export type Source = "sam-noun" | "sam-box" | "threshold";

/** One cut-out object. `bbox` is in Work_Image pixels; `mask` is bbox-sized (bbox.w × bbox.h), row-major 0/1. */
export interface Instance {
  id: number; objIndex: number; type: ObjType; noun: string; sky: boolean; bbox: PxBox; mask: Uint8Array; source: Source;
}
