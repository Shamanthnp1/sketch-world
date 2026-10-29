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

## Deployed (task 11.2)

Date: 2026-10-28

URL: **https://sketch-world.shamanthnp.workers.dev** (workers.dev only; no routes, custom domains or DNS changes). Version id `9268a1b5-951b-49e1-8b41-2db4626f67b9`, deployed with wrangler 4.153.0 by `npx wrangler deploy --secrets-file .dev.vars` from commit `fb4fcd3` plus the cap change.

Before creating anything, the shared account (b48bb45c…f753) had D1 `undo-manual-db`, R2 `undo-manual-images` and `wastatus-videos`, and no Worker `sketch-world`. None of them was changed.

| Resource | Name | Notes |
|---|---|---|
| Worker | `sketch-world` | Static Assets from `dist/` (27 files), Worker first for `/api/*` and `/a/*` |
| D1 | `sketch-world-db` | id `0f1a2aeb-08bd-431b-b6ce-eed4db5af212`, region APAC; `0001_init.sql` applied remotely (tables `worlds`, `usage`, `checks`) |
| R2 | `sketch-world-assets` | Standard storage class, empty |
| Rate limits | `RL_UNDERSTAND` 74031, `RL_POINT` 74032, `RL_SEGMENT` 74033, `RL_BACKDROP` 74034, `RL_SAVE` 74035 | 6/60 s each, `RL_SEGMENT` 30/60 s; no namespace conflict reported |
| Var | `DAILY_COST_CAP_USD` = `"2"` | **$2 per UTC day** (lowered from $5 at the user's request), about 40–57 worlds a day at the design.md estimate of $0.035–0.05 each. Raised to `"5"` for judging week at the task 12 review (see "Review decisions" below) |
| Var | `SAMPLE_WORLD_IDS` = `""` | Set in task 11.3 |
| Secret | `MODEL_API_KEY` | `wrangler secret list` shows it by name, type `secret_text` |

Post-deploy smoke, with no model calls (the remote `usage` table has 0 rows afterwards):

| Request | Result |
|---|---|
| `HEAD /`, `/create`, `/gallery` | 200 `text/html`, each with `content-security-policy: default-src 'self'; img-src 'self' blob: data:; connect-src 'self'` and `x-content-type-options: nosniff` |
| `GET /api/gallery` | 200 `{"worlds":[],"samples":[]}` |
| `GET /api/worlds/abcdefghij` | 404 `{"error":"World not found"}` |
| `GET /a/w/abcdefghij/thumb.jpg` | 404 `{"error":"Not found"}` |
| `PUT /api/gallery` | 405 `{"error":"Method not allowed"}`, `Allow: GET` |

## Sample worlds (task 11.3)

Date: 2026-10-28

The user approved three gate drawings as public sample worlds: `1.jpeg`, `ms1.png` and `ms2.png`. Each was made once on the deployed site through the normal Create flow ("Photo of a drawing", privacy notice accepted once), driven by `playwright-cli` in headless Chrome at 1280 × 800, then saved with Save & share, so each save has the server-side safe check row from `/api/understand`. The paper in `1.jpeg` fills the photo, so all three used "Use the whole photo". `ms1.png` is 3346 × 1186 (2.82 : 1), which the corner check refuses (paper shapes 1.0–1.8 : 1), so at the user's choice it went in as a copy padded to 3346 × 1859 (1.8 : 1): its top row (the cream sky) repeated above and its bottom row (the grass) repeated below, the drawing itself unchanged. The copy stays in the gitignored private folder. The owner tokens are kept in the gitignored `test/fixtures/drawings/private/sample-owners.json`, not here.

| World | Drawing | Title | Objects | Calls | Est. cost | World open | Sky | Moves saved |
|---|---|---|---|---|---|---|---|---|
| [NjaZ1IphRu](https://sketch-world.shamanthnp.workers.dev/w/NjaZ1IphRu) | 1.jpeg | Underwater sea life | 7: fish ×2, turtle, crab, starfish, seaweed, coral | understand, 6 noun + 1 box segment, point, backdrop | $0.0475 | ≈ 16 s | 22.9 s | crab 1 unit further back |
| [Tco7s8pREl](https://sketch-world.shamanthnp.workers.dev/w/Tco7s8pREl) | ms1.png (padded) | House with Two Trees | 7: tree ×2, house, cloud ×3, sun | understand, 4 noun segments, backdrop | $0.03 | 9.4 s | 20.0 s | one cloud 1 unit higher |
| [VcULvxRZQO](https://sketch-world.shamanthnp.workers.dev/w/VcULvxRZQO) | ms2.png | Sunny valley with house and river | 25: tree, mountain ×2, house, river, flower ×10, sun, cloud ×4, bird ×5 | understand, 8 noun + 4 box segments, point, backdrop | $0.06 | 36.8 s | 28.6 s | none |

Times run from Use the whole photo (the understand request) to the open world and to the backdrop reply; saving took 2.4–3.5 s. Every call replied 200. Spend: **$0.1375** at the design.md fixed estimates, which matches the remote `usage` row for the day (137,500 µ$), so no understand retries. Live spend including the gate and its re-check: **$0.3675**.

- **1.jpeg**: Spark listed the same 7 objects as in the 5.9 re-run (rocks and the small shell still missing). "seaweed" got 0 noun masks again and was cut by the point call plus one SAM box prompt; the card includes the rocks under it. The fish and the turtle have sky false, so they stand and wander on the sand instead of floating.
- **ms1.png**: every object cut out whole by noun, as at the gate. No ground listed.
- **ms2.png**: the ground is no longer listed as `field` (the 5.9 prompt fix, untested on ms2 until now), but the red dots in the grass are still listed as "flower ×10". They got 0 noun masks, so the world paid for a point call (13.9 s, most of the 36.8 s) and 4 box calls: 3 box cut-outs about 10 px across and 7 threshold cut-outs that show as small green squares by the river. The front mountain's mask has a tree-shaped hole where the tree covers it.
- **Checks in a fresh browser context, as a non-owner**: each `/w/<id>` opens with all its cut-outs (7, 7 and 25 PNGs), the painted sky (`backdrop.jpg` 200) and only Share link and Make your own (no Save positions or Delete world). Reset positions reports the saved moves on the two worlds that have them ("Nothing has been moved yet" on ms2), and no model or save request is sent. The Gallery lists all three with 640 × 400 thumbnails; none is blank.
- **`SAMPLE_WORLD_IDS`** = `NjaZ1IphRu,Tco7s8pREl,VcULvxRZQO`. Home's "Walk a sample world" opens the first. It goes first because it is the one drawing on paper, its crayon cut-outs look most like the paper pop-up the site promises, and the starfish and crab already stand near the spawn point. ms1 is the cleanest but its house and trees lie flat until you walk in; ms2 has the flower squares.

Redeployed twice (both approved), static assets and vars only, no new resource:

| Version | Change |
|---|---|
| `2f302a6d-4bb7-48cc-b4a7-4923549fc1cb` | `SAMPLE_WORLD_IDS`, the SAM License copy at `/licenses/SAM-LICENSE.txt`, the footer's SAM License link |
| `e74e84d4-1bfb-4ec4-b78e-3fb73f647df6` | `public/_headers`: `Content-Type: text/plain; charset=utf-8` for `/licenses/*`, since without a charset Chrome decoded the licence's curly quotes as windows-1252 |

Smoke on `e74e84d4`: `GET /api/gallery` lists the 3 worlds and the 3 samples in that order; Home's "Walk a sample world" links `/w/NjaZ1IphRu` and opens it; `/licenses/SAM-LICENSE.txt` is 200 `text/plain; charset=utf-8` with the CSP and `nosniff`, byte-identical to `node_modules/@meta-sam/parser/LICENSE`, and the footer link loads it from an app page; the footer's Source on GitHub link is https://github.com/Shamanthnp1/sketch-world.

## Checkpoint fixes (task 12)

Date: 2026-10-29

Two fixes from the sample worlds: ms2's grass dots became 10 cards (3 tiny box cut-outs and 7 green threshold squares), and 1.jpeg's fish and turtle had sky false, so they walked on the sand.

**Measured sizes.** Long side and mask area at the 1024 px scale (× 1024 ÷ the Work_Image's long side). The dots come from the saved ms2 world (`VcULvxRZQO`: its bboxes and the alpha of its cut PNGs, fetched from `/a/w/`, no model calls), the rest from the noun masks in the saved gate replies.

| What | Long side (px) | Mask area (px) |
|---|---|---|
| ms2 grass dots, box SAM masks (3) | 11, 11, 15 | 55, 90, 109 |
| ms2 grass dots, Spark boxes of the 7 threshold squares (crop minus the 4 px padding) | 11–12 | crops 19–20 px: 4 all opaque and 1 all but 3 px (the green squares); 2 partial, 38 px within 9 × 13 and 87 px spread over 20 × 18 |
| Birds: ms2 (5), ms3 (3) | 25–31, 26–43 | 256–330, 245–327 |
| Sparkle stars: 2.jpeg (3), 3.jpeg (3 kept) | 28–40 | 297–414 |
| 3.jpeg's 2 extra "star" blobs on the bush flowers (already dropped by count) | 13, 14 | 115, 117 |
| Other small noun masks: 3.jpeg flower head, ms3 flower heads, ms1 sun, ms2 thin cloud | 40, 41–80, 48, 71 | 1147, 1173–4063, 1744, 674 |
| 1.jpeg crab, starfish | 195, 134 | |

**Rule.** `MIN_SIDE = 20` px per 1024 px of the Work_Image's long side (20 px on ms2, 13 px on 1.jpeg's 671 px), halfway between the largest dot (15) and the smallest real object (a bird, 25). There is no area rule: the long side alone separates every measured case, and an area limit would also drop real objects drawn in thin open strokes. In `src/cut/chain.ts`:
- a box SAM mask whose set pixels have a long side under the limit is rejected, like an IoU miss, so the box falls through to the threshold step;
- a Spark box under the limit gets no threshold cut-out at all, whether the crop comes out all transparent, all opaque (the green squares) or partial (the 87 px grass patch spans 20 × 18 px, so a rule on the cut-out's own size would have kept it);
- a threshold cut-out whose trimmed bbox is under the limit is dropped;
- an object left with no instance is in `notFound` ("Not found in your drawing: flower"); noun masks have no size limit, and the whole-crop rule (5.7) still holds for boxes at or above the limit.

**Tight bbox.** Every sam-box and threshold instance's bbox is trimmed to its mask's set pixels, with the mask cropped to match, so `cardArt` no longer stretches a threshold cut-out back to a loose Spark box. SAM rasters can have empty margins (1 px on ms2's mountain and on one 1.jpeg fish), so sam-box masks are trimmed too. Noun masks are left as they are.

**Replay, no calls.** The gate's saved noun replies through `buildInstances` with a fake ChainIO. For ms2, the sample world's scene and its 10 flower boxes and 3 box masks were rebuilt from the saved world, on its `source.jpg`.

| Replay | Before | After |
|---|---|---|
| ms2, sample-world scene | 25: 15 noun, 3 sam-box dots (10–15 px), 7 threshold squares (19–22 px) | 15, all noun: tree, mountain ×2, house, river, sun, cloud ×4, bird ×5; flower not found (the 4 box calls still happen if Spark lists dots) |
| 1.jpeg, sample-world scene | 7, seaweed sam-box 145 × 166 | the same 7 (the seaweed mask has no margins) |
| 2.jpeg, 3.jpeg, ms1, ms3 gate scenes, noun stage | 14, 20, 8, 20 | the same; 3 stars in 2.jpeg and in 3.jpeg, 3 birds in ms3, 5 in ms2 |

On these drawings the trimming only changes the dropped dots: every kept sam-box mask fills its raster, and the seaweed box cut by threshold instead (box SAM forced to fail) touches all four crop edges (154 × 175 px).

**Scene prompt.** Two rule changes: small dots, specks and scattered marks are texture even when coloured (red dots in grass), with a flower listed only when it has a drawn head; and sky is true for things that swim or float in water above the ground (fish, turtle, jellyfish, balloon, kite), false for things on the ground or the sea floor (crab, starfish, seaweed, coral).

**Live check.** Local `wrangler dev` on port 8796 after `npm run build`, one `POST /api/understand` per drawing with the sample worlds' `source.jpg` (the exact JPEGs sent at task 11.3), no SAM calls.

| Drawing | Spark listed | Before (task 11.3) | Spark time |
|---|---|---|---|
| ms2.png | tree, mountain ×2, house, river, sun, cloud ×4, bird ×5 (the 15 counted objects); no flower, no field | the same plus flower ×10 | 5.8 s |
| 1.jpeg | fish ×2 and sea turtle with sky true; crab, starfish, seaweed, coral with sky false | fish and turtle sky false | 7.0 s |

One run per drawing, so this can't separate the prompt change from run-to-run variance. The local D1 had no tables (its database id changed at deploy), so the first two requests got a 500 before any model call; `wrangler d1 migrations apply sketch-world-db --local` fixed that. Both Spark calls succeeded on attempt 1. Spend: **$0.02** (local `usage` row 20,000 µ$). Live spend including the gate, its re-check and the sample worlds: **$0.3875**. Not deployed; the saved sample worlds keep their old cards until they are made again.

## Review decisions (task 12)

Date: 2026-10-29. The user's decisions on the core review (`docs/review.md`). Not deployed yet.

**Daily cap: $5.** `DAILY_COST_CAP_USD` = `"5"` in `wrangler.jsonc`, raised from `"2"` for judging week at the user's request. At the design.md estimate of $0.035–0.05 per world that is about 100–140 worlds a day.

**Approved-only Gallery (review finding 4).** `migrations/0002_listed.sql` adds `worlds.listed` (default 0), rebuilds the `worlds_gallery` index as `(safe, listed, created_at DESC)` and sets `listed = 1` on the three sample worlds. A new save opens by link at `/w/<id>` at once, and `GET /api/gallery` lists only worlds with `listed = 1` or an id in `SAMPLE_WORLD_IDS` (whatever their column says). The deploy step must run `$env:CI='true'; npx wrangler d1 migrations apply sketch-world-db --remote` before `wrangler deploy`, since the new gallery query needs the column.

Approve a world for the Gallery after looking at it:

```powershell
$env:CI='true'; npx wrangler d1 execute sketch-world-db --remote --command "UPDATE worlds SET listed = 1 WHERE id = '<id>'"
```

Hide it again (it still opens by link):

```powershell
$env:CI='true'; npx wrangler d1 execute sketch-world-db --remote --command "UPDATE worlds SET listed = 0 WHERE id = '<id>'"
```

**Per-visitor budget and timeout re-reservation (review findings 5 and 9).** `PER_IP_DAILY_USD` = `"0.5"`: each client (an IPv4 address or an IPv6 /64) may spend at most $0.50 per UTC day, tracked in the `usage_ip` table of `migrations/0003_usage_ip.sql`. Over it the Worker replies 503 `{mode: "sample", reason: "visitor"}`. A model call that timed out is reserved again before its retry. The same `migrations apply ... --remote` step applies 0003 after 0002; `wrangler deploy` must come after it, since every model call now writes `usage_ip`.

**Safe gate on segment and point (review finding 11).** Both routes now need a `checks` row with `safe = 1` for the SHA-256 of their image, the row `/api/understand` writes. Without one they reply 403 "Only drawings checked by this app can be cut out", after the input caps and before any cost is reserved. Create and the probe's Live mode send the same Work_Image JPEG `Blob` to understand, segment and point, so a normal run is unchanged.

## Checkpoint deploy (task 12)

Date: 2026-10-29. Part 1 of 2, approved by the user: deploy the checkpoint fixes and make sample worlds 1 (`1.jpeg`) and 3 (`ms2.png`) again on the live site.

Version id **`425dc088-d083-4296-8c92-f7e1b16f5fe3`**, deployed with wrangler 4.153.0 by `npx wrangler deploy --secrets-file .dev.vars` from commit `d0eee5c` (clean tree; 622 tests, typecheck and build clean). `wrangler whoami` showed account b48bb45c…f753, and `.dev.vars` holds only `MODEL_API_KEY`. The deploy uploaded 13 new or changed assets of 29 and listed the same bindings as before, with `DAILY_COST_CAP_USD` `"5"`, `PER_IP_DAILY_USD` `"0.5"` and `SAMPLE_WORLD_IDS` unchanged; `wrangler secret list` shows `MODEL_API_KEY` as `secret_text`. No other resource was touched.

**Migrations**, applied before the deploy with `npx wrangler d1 migrations apply sketch-world-db --remote`: `0002_listed.sql` (5 commands), then `0003_usage_ip.sql` (2 commands), both ✅. Afterwards `SELECT id, listed FROM worlds` returned the 3 samples with `listed = 1`, and `sqlite_master` has `usage_ip` and the rebuilt `worlds_gallery`.

**Smoke**, no model calls (the day's `usage` and `usage_ip` rows were still absent afterwards):

| Request | Result |
|---|---|
| `HEAD /` | 200 `text/html`, `content-security-policy: default-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'`, `x-content-type-options: nosniff` |
| `GET /api/gallery` | 200, the 3 sample worlds in `worlds` and in `samples` |
| `POST /api/understand` with `Origin: https://example.com` (a 1 × 1 PNG) | 403 `{"error":"Requests from other sites are not allowed"}` |
| `POST /api/segment` with no Origin, a 1 × 1 PNG with no checks row and `noun=fish` | 403 `{"error":"Only drawings checked by this app can be cut out"}` |

**New sample worlds.** Each drawing was run once on the deployed site through the normal Create flow ("Photo of a drawing", privacy notice accepted, "Use the whole photo"), in `playwright-cli` headless Chrome at 1280 × 800, then saved with Save & share. Every model call replied 200 on attempt 1. The owner tokens are added to the gitignored `test/fixtures/drawings/private/sample-owners.json`, next to the old ones. Both new worlds have `listed = 0`; the Gallery will list them once they are in `SAMPLE_WORLD_IDS`.

| World | Drawing | Title | Objects | Calls | Est. cost | World open | Sky |
|---|---|---|---|---|---|---|---|
| [wLeiDFftn0](https://sketch-world.shamanthnp.workers.dev/w/wLeiDFftn0) | 1.jpeg | Underwater Sea Friends | 7: fish ×2, turtle, crab, starfish, seaweed, coral | understand, 6 noun + 1 box segment, point, backdrop | $0.0475 | ≈ 16.5 s | 18.7 s |
| [3gQJnD3lHP](https://sketch-world.shamanthnp.workers.dev/w/3gQJnD3lHP) | ms2.png | Sunny Valley with River | 15: sun, cloud ×4, bird ×5, mountain ×2, tree, house, river | understand, 7 noun segments, backdrop | $0.0375 | 12.5 s | 19.2 s |

Times run from Use the whole photo to the open world and to the backdrop reply; saving took 2.9 s and 2.5 s.

- **1.jpeg**: both fish and the turtle now have sky true and float in the water, with their shadows on the sand below. The crab, starfish, seaweed and coral have sky false and stand on the sand. Seaweed again got 0 noun masks and was cut by the point call plus one box SAM call. Spark listed the same 7 objects as at task 11.3 (rocks and the small shell still missing).
- **ms2.png**: no flower and no field listed, so no point or box calls. All 15 cards are noun cut-outs, with no green squares and no dot cut-outs. The world opened 24 s sooner than at task 11.3 (36.8 s) and cost $0.0225 less ($0.06). The front mountain still has its tree-shaped hole with a small dark-green fleck inside it, part of its noun mask, as in the old world. The tree stands close to the spawn point on the left, so it is out of the opening view once it has popped up. A few red grass dots show at the foot of its trunk, inside the tree's mask.

**Cost rows.** Before the two runs, the remote `usage` table had no row for 2026-10-29 and `usage_ip` was empty. Afterwards, `usage` for 2026-10-29 is 85,000 µ$ and `usage_ip` has one row for the day at 85,000 µ$ (client column not read). Both grew by the same total, which equals $0.0475 + $0.0375, so there were no hidden retries. A `wrangler tail` (pretty format) ran through both runs: 19 model calls, all attempt 1, and no "reserve counted one total only" warning.

**Non-owner check**, in a fresh `playwright-cli` session (in-memory profile, no `owner:*` keys) at 1280 × 800:

| World | Cut-outs | Sky | Pop-up intro | Controls | Model or save requests | Console errors |
|---|---|---|---|---|---|---|
| wLeiDFftn0 | 7 PNGs, all 200 | `backdrop.jpg` 200 | the crab and starfish still rising 150 ms after the canvas appears | Objects, Pause motion, Reset positions, Help, Share link, Make your own; no Save positions or Delete world | 0 | 0 |
| 3gQJnD3lHP | 15 PNGs, all 200 | `backdrop.jpg` 200 | the house and tree still rising | the same | 0 | 0 |

Spend: **$0.085** (2 understand, 1 point, 14 SAM and 2 backdrop calls at the design.md fixed estimates; matches the `usage` row). Live spend including the gate, its re-check, the task 11.3 sample worlds and the task 12 local check: **$0.4725**.

**Part 2** (a later run) will delete the old worlds `NjaZ1IphRu` and `VcULvxRZQO` with their owner tokens and set `SAMPLE_WORLD_IDS` to `wLeiDFftn0,Tco7s8pREl,3gQJnD3lHP`, then deploy again and push. Until then the Gallery and Home still show the old three.

## Checkpoint deploy, part 2 (task 12)

Date: 2026-10-29. Part 2 of 2, approved by the user.

**Old sample worlds deleted** through the app's own route, `DELETE /api/worlds/<id>` with the owner token from the gitignored `sample-owners.json` and no Origin header: `NjaZ1IphRu` (the old 1.jpeg world, "Underwater sea life") and `VcULvxRZQO` (the old ms2 world, "Sunny valley with house and river"), 204 each. Afterwards `GET /api/worlds/<id>` and `GET /a/w/<id>/thumb.jpg` reply 404 for both, and so do `source.jpg`, `backdrop.jpg` and `cut/0.png`–`cut/39.png` (43 paths each), so the R2 cleanup ran. The kept worlds still reply 200, and the remote `worlds` table holds only `Tco7s8pREl`, `wLeiDFftn0` and `3gQJnD3lHP`. The two deleted entries are removed from `sample-owners.json`; the other three stay.

**`SAMPLE_WORLD_IDS`** = `"wLeiDFftn0,Tco7s8pREl,3gQJnD3lHP"` in `wrangler.jsonc`. Home's "Walk a sample world" opens the first.

Version id **`65a3f380-69e5-4812-919a-bea7d0ad9c2f`**, deployed with wrangler 4.153.0 by `npx wrangler deploy --secrets-file .dev.vars` from `fb3730e` plus the `wrangler.jsonc` change committed with this note (622 tests, typecheck and build clean). Same account (b48bb45c…f753); `.dev.vars` holds only `MODEL_API_KEY`. No asset changed (29 files read, none uploaded), and the bindings are those of part 1 with the new `SAMPLE_WORLD_IDS`. No migrations. No other resource was touched.

**Smoke**, no model calls: `usage` for 2026-10-29 is still 85,000 µ$ and `usage_ip` still one row at 85,000 µ$. The browser run aborted any model request or non-GET `/api/worlds` request, and none was made.

| Check | Result |
|---|---|
| `GET /api/gallery` | 200. `samples`: wLeiDFftn0, Tco7s8pREl, 3gQJnD3lHP, in that order. `worlds`: the same 3, newest first (3gQJnD3lHP, wLeiDFftn0, Tco7s8pREl). Neither deleted id appears |
| Home | "Walk a sample world" links `/w/wLeiDFftn0` and opens "Underwater Sea Friends"; the strip shows the 3 samples |
| `/w/wLeiDFftn0` (`playwright-cli`, headless Chrome, 1280 × 800, fresh context) | 7 cut-out PNGs and `backdrop.jpg`, all 200. Pop-up: the 4 standing cards' folds were 0.003, 0.19, 0 and 0 on the first frame and 1 after 2.5 s. The 3 floating cards (the scene's sky objects: fish ×2 and the turtle) hang at y 3.3–5.2 and moved 0.6–1.7 units in 2 s |
| `/gallery` | One group, "Sample worlds", with 3 cards in the gallery order, each thumbnail loaded (640 × 400) |
| `/w/NjaZ1IphRu` | "This world isn’t here" and "It may have been deleted, or the link is mistyped.", no canvas; its `GET /api/worlds/NjaZ1IphRu` was 404 |

Console: one error, the browser's "Failed to load resource" for that expected 404; no page errors. Spend: $0. Live spend stays **$0.4725**.
