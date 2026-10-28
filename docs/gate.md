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
| ms2.png | PNG, digital drawing | 15 | 15 (100%) | 15 (100%) | 15.9 s | $0.0325 | 10 calls. 5 birds, not 4 as first counted. Red dots in the grass listed as "flower ×10", 0 masks (decoration, not counted); ground listed as field |
| ms3.png | PNG, digital drawing | 19 | 19 (100%) | 19 (100%) | 14.1 s | $0.0325 | 10 calls. "wall" returned 3 masks: the brick wall plus 2 of the house's walls; ground listed as field |

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
- **ms2.png**
  - No failures on the counted objects. The reference count said 4 birds; the drawing has 5 (3 left of the sun, 2 right), so the count is 15, not 14. Spark said 5 and SAM cut all 5.
  - The mountain masks stop where the tree and the other mountain cover them; the river mask runs the full curve on both sides of the trunk. Both are counted as clean.
  - Spark listed the red dots in the grass as "flower ×10"; SAM returned 0 masks. They are grass decoration, so they are not counted, but the call cost $0.0025.
  - Spark also listed the ground as `field`; SAM cut the middle grass strip. Not counted.
- **ms3.png**
  - No failures on the counted objects. All 10 flowers got their own mask (heads; the stems are faint strokes lost in the grass, so the heads count as whole). The cloud band came back as one mask around the house and tree; one bird mask has a thin sky fringe but covers the bird.
  - Spark listed the brick wall as "wall ×2" (the segments either side of the house). SAM returned 3 "wall" masks: one covering both brick segments, plus the house's front wall and its upper-storey wall. The brick wall is counted as listed and clean; the 2 house-wall masks are house parts and sit inside the house mask.
  - Spark also listed the ground as "grass" (type `field`); SAM cut the two lawn strips. Not counted.

## Spend (estimated, gate runs only)

| Drawing | Cost | Running total |
|---|---|---|
| 1.jpeg | $0.0275 | $0.0275 |
| 2.jpeg | $0.025 | $0.0525 |
| 3.jpeg | $0.04 | $0.0925 |
| ms1.png | $0.0225 | $0.115 |
| ms2.png | $0.0325 | $0.1475 |
| ms3.png | $0.0325 | $0.18 |

Total live spend for the gate: **$0.18** (6 Spark calls × $0.01 + 48 SAM calls × $0.0025, design.md fixed estimates; the bill may differ). The `wrangler dev` log shows every understand call succeeded on attempt 1, so no hidden schema retries.

## Verdict

| File | Drawn | Listed | Clean |
|---|---|---|---|
| 1.jpeg | 11 | 9 (82%) | 6 (55%) |
| 2.jpeg | 12 | 11 (92%) | 11 (92%) |
| 3.jpeg | 21 | 19 (90%) | 16 (76%) |
| ms1.png | 7 | 7 (100%) | 7 (100%) |
| ms2.png | 15 | 15 (100%) | 15 (100%) |
| ms3.png | 19 | 19 (100%) | 19 (100%) |
| **All 6** | **85** | **80 (94%)** | **74 (87%)** |

| Criterion | Result | |
|---|---|---|
| Aggregate listed ≥ 80% | 94% (80/85) | PASS |
| Aggregate clean ≥ 70% | 87% (74/85) | PASS |
| Every drawing < $0.05 | highest $0.04 (3.jpeg) | PASS |
| Every drawing < 40 s | slowest 22.1 s (3.jpeg) | PASS |

**Overall: PASS.** No prompt tuning was needed.

Single drawings below a bar: 1.jpeg is at 55% clean (bar 70%). No drawing is below 80% listed (lowest: 1.jpeg at 82%). 1.jpeg is the only phone photo of paper in the set, so that input is the least tested and the weakest.

## Known weaknesses for task 5

- **A 0-mask noun loses its objects to a neighbour** (3.jpeg: "bush" 0, both bushes under "cloud"; 1.jpeg: "seaweed" 0, rocks under "shell"). Handled: 0-mask nouns go to `/api/point` and box SAM; a box mask that overlaps an assigned mask falls back to `thresholdMask`, so the bush and seaweed still get a cut-out. Not handled: the neighbour keeps the taken masks under its label, so a bush can show twice; `assign` doesn't prefer the label whose Spark box overlaps best.
- **Nouns return more masks than Spark's count** (3.jpeg: tree 2 for 1, log 5 for 2, star 5 for 3; ms3: wall 3 for 2). Handled: IoU de-dup drops the same object under two nouns (the pine tree's extra "tree" mask). Not handled: extra masks on other objects (campfire logs, the pine trunk) survive, and so do masks inside a bigger one (the house walls inside "house", low IoU); no cap per noun at Spark's count, no containment check.
- **Partial masks** (3.jpeg: flower head without stem and leaves). Handled: nothing; the 5%-of-bbox rule accepts it and the box stage only runs for 0-mask nouns. Not handled: no check that a mask covers the whole object.
- **Objects Spark didn't list** (rainbow in 2.jpeg and 3.jpeg, rocks in 1.jpeg, grass tuft in 3.jpeg). Handled: nothing; the chain only sees listed objects, so they don't even appear as "not found". Not handled: needs an understand-prompt change, outside task 5.
- **Decorations and ground listed** (sparkle stars in 2.jpeg and 3.jpeg, ground as `field` in all 3 PNGs, grass dots as "flower ×10" in ms2). Handled: `field` gets the 90% bbox allowance, so ground cuts stay as terrain. Not handled: clean decoration cuts become extra instances, and a 0-mask decoration noun (ms2 "flower ×10") would trigger the point call plus up to 10 box calls ($0.035) and threshold cuts of grass dots.
- **Cost headroom.** The gate figures cover understand + noun SAM only. A world adds the backdrop ($0.01) and any point/box calls: 3.jpeg would be about $0.065 (backdrop, point, 2 bush boxes), ms2 up to $0.0775. Task 5 has no per-world limit on box calls.

## Re-check after the scene-prompt fix (task 5.9)

Date: 2026-10-28

Change: `rainbow` is now a sky type, and the scene prompt tells Spark to skip decorations (sparkles, dots, texture strokes) and the ground, sky or background itself, and to list rainbows. Same setup as the gate (local `wrangler dev`, probe in Live mode, headless Chrome), judged the same way, one live run per drawing. Before the live runs, the saved gate replies for both drawings replayed on the new build with no errors and no calls.

| File | Spark listed | Decorations and ground | Rainbow | Listed | Clean | Time | Cost |
|---|---|---|---|---|---|---|---|
| 1.jpeg | fish ×2, turtle, crab, starfish, seaweed, coral (7) | None listed (bubbles, sand and water skipped, as at the gate) | None drawn | 7 of 11 (64%) | 6 (55%) | 10.0 s (Spark 5.6 s) | $0.025 |
| 2.jpeg | rainbow, sun, cloud ×6, house, tree, bush ×2 (12) | The 3 sparkle stars are no longer listed (gate: `star` ×3); no ground drawn or listed | Listed; 1 mask covering the whole arc | 12 of 12 (100%) | 12 (100%) | 9.3 s (Spark 5.3 s) | $0.025 |

- **1.jpeg**: the small shell at bottom-left is no longer listed. It is a real object, so the drawing lost one listed object; one run can't tell whether the skip-decorations rule or run-to-run variance dropped it. Its gate masks were wrong anyway (the 3 rocks and the turtle's shell), so those 4 wrong-label cut-outs are gone too. The rocks are still not listed, and "seaweed" still returns 0 masks. Counted the same way, the gate run listed 8 objects (Spark's counts add up to 8; the gate table above says 9).
- **2.jpeg**: both gate failures are fixed. The rainbow is listed (type `rainbow`, sky true) and SAM cut it cleanly. The sparkle stars are gone.
- **Type changes between runs**: seaweed and coral are now `flower` (gate: `other-standing`), the bushes `other-standing` (gate: `tree`), and the fish and turtle have sky false (gate: true).
- **Not re-checked live**: the ground-as-`field` entries and the grass dots ("flower ×10") came from ms1–ms3, which weren't re-run. Neither 1.jpeg nor 2.jpeg had ground listed at the gate, so the ground part of the fix is untested live.

Spend: 2 understand calls (both on attempt 1 in the `wrangler dev` log, so no hidden retries) and 12 SAM calls, $0.05 at the design.md fixed estimates. Live gate spend including this re-check: **$0.23**.
