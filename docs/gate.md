# Day-1 gate

Date: 2026-10-28

Setup: local `npx wrangler dev` (after `npm run build`), probe page (`/?probe`) in Live mode, driven by `playwright-cli` in headless Chrome. Models `muse-spark-1.3` (understand) and `sam-3.1` (noun segments). `npm run smoke` showed `store: false` is accepted by Spark (echoed in the reply) and by Muse Image (accepted, not echoed). No prompt tuning in these runs.

## Criteria

- Spark lists ≥ 80% of the drawn objects.
- ≥ 70% of the drawn objects get a clean SAM cut-out.
- Each drawing costs < $0.05 and takes < 40 s.

Judged by eye from the outlined canvas and the cut-out thumbnails. "Listed" means the right kind and roughly the right count. "Clean" means the mask covers the whole object, not mostly background or a neighbour; a mask on the wrong object doesn't count. Decorations (sparkle stars, grass texture, house parts like doors, windows and chimneys) and the background are not counted. Time and cost are the probe page's figures (time from the understand request to the last cut-out; cost from the design.md fixed estimates).

## Results

| File | Kind | Objects drawn | Listed | Clean | Time | Cost | Notes |
|---|---|---|---|---|---|---|---|
| 1.jpeg | Phone photo of paper | 11 | 9 (82%) | 6 (55%) | 14.9 s | $0.0275 | 8 calls. Rocks not listed; "seaweed" 0 masks; "shell" masks hit the rocks and the turtle's shell |
| 2.jpeg | JPEG, clean white background | 12 | 11 (92%) | 11 (92%) | 13.3 s | $0.025 | 7 calls. Rainbow not listed; sparkle stars listed (ignored) |
| 3.jpeg | JPEG, clean white background | 21 | 19 (90%) | 16 (76%) | 22.1 s | $0.04 | 13 calls; Spark took 15.7 s. Rainbow and grass tuft not listed; "bush" 0 masks (the bushes came back as "cloud" masks); flower mask is the head only |
| ms1.png | PNG, digital drawing | 7 | 7 (100%) | 7 (100%) | 8.9 s | $0.0225 | 6 calls. Also listed the ground as "grass field" (type field, not counted) |

## Failure notes

- **1.jpeg**
  - The 3 rocks were not listed.
  - "seaweed" returned 0 masks.
  - "shell" returned 4 masks: the 3 rocks and the turtle's shell, not the small real shell at bottom-left. IoU de-dup (task 5.5) would drop the turtle-shell mask; the rock masks would stay under the wrong label.
- **2.jpeg**
  - The rainbow was not listed, so it got no cut-out.
  - Spark listed the 3 sparkle stars as `star`; SAM cut them cleanly, but they are decorations and not counted.
- **3.jpeg**
  - The rainbow and the grass tuft were not listed.
  - Spark listed "log ×2"; the 2 masks it meant are the log and the tree stump, so the stump is counted as listed and clean under "log". SAM returned 5 "log" masks: the log, the stump, 2 campfire logs and the pine tree's trunk.
  - "bush" (count 2) returned 0 masks, while "cloud" (count 6) returned 8: the 6 clouds plus both bushes. The bushes have no cut-out under the right label, so they are not counted as clean.
  - "flower" got 1 mask covering only the flower head; the stem and leaves are missing, so it is not counted as clean.
  - "tree" (count 1) returned 2 masks: the round tree and the pine tree, which also has its own "pine tree" mask. IoU de-dup (task 5.5) would keep only one of the two pine-tree masks.
  - "star" (count 3) returned 5 masks: 3 sparkle stars and 2 blobs on the small blue flowers inside the second bush.
  - Spark took 15.7 s of the 22.1 s, longer than on the smaller drawings.
- **ms1.png**
  - No failures. Every object was listed with the right count and cut out whole (the trees include their trunks and apples, the clouds their thought-bubble tails).
  - Spark also listed the ground as "grass field" (type `field`); SAM cut the green strip. It is background here, so it is not counted.

## Spend (estimated, gate runs only)

| Drawing | Cost | Running total |
|---|---|---|
| 1.jpeg | $0.0275 | $0.0275 |
| 2.jpeg | $0.025 | $0.0525 |
| 3.jpeg | $0.04 | $0.0925 |
| ms1.png | $0.0225 | $0.115 |

## Verdict

Pending: ms2.png and ms3.png not run yet.
