// Types shared by the cut-out chain (src/cut/*).
import type { MaskRaster } from "../sam/parse";

/** A SAM mask competing for scene object `objIndex`. `area` = set pixels of `mask`; `id` breaks sort ties. */
export type Candidate = { id: number; objIndex: number; mask: MaskRaster; area: number };
