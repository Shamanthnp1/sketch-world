# Core review (task 12 checkpoint)

Date: 2026-10-29. Reviewer: Kiro, with the `ponytail-review` checklist. Scope: the whole core: `worker/**`, `shared/**`,
`src/**`, `public/_headers`, `wrangler.jsonc`, `vite.config.ts` and `index.html`, at commit a921265.

Load assumed: the public hackathon demo on workers.dev. Judges and visitors use it at the same time, some behind a
shared school, office or mobile carrier IP, and the daily cap is $2 (`DAILY_COST_CAP_USD = "2"`).

Tests: 560 before the fixes, 571 after (56 → 57 files). `npm run typecheck` and `npm run build` are clean before and after.

## What this code does

A browser app turns a drawing into a three.js paper world. A Worker proxies three Meta models behind per-IP rate limits
and a daily cost cap, and stores saved worlds in D1 (JSON) and R2 (pictures). Anyone can save a world; it is then public
at `/w/:id` and listed in the Gallery.

## Findings

| # | Severity | Area | Finding | Fixed? |
|---|---|---|---|---|
| 1 | Medium | Security, load | Chunked uploads to understand, segment and point were parsed whole before any size check | Yes, 84eb6bb |
| 2 | Medium | Security, cost | Another site could make its visitors' browsers call the model routes | Yes, d356ad6 |
| 3 | Medium | Security (DoS) | A crafted saved world made every Viewer allocate gigabytes and crash the tab | Yes, 2145242 |
| 4 | High | Security, content | The public thumbnail, cut-outs, backdrop and title of a saved world are never checked | No: needs a decision |
| 5 | High | Load, cost | One person can use up the whole day's $2 in 5–8 minutes within the per-IP limits | No: needs a decision |
| 6 | Low–Medium | Bug | The Viewer stayed on "Opening this world…" forever when 3D could not start | Yes, d33beea |
| 7 | Low | Bug, cost | Leaving Create mid-run kept sending the queued model calls | Yes, 76eaea5 |
| 8 | Low | Security | No `frame-ancestors`: another site could frame the app (clickjacking on Delete world) | Yes, 23a3103 |
| 9 | Low | Cost | A timed-out model call is retried up to 3 times on one reservation | No: needs a decision |
| 10 | Low–Medium | Load | Everyone behind one shared IP shares one rate limit | No: needs a decision |
| 11 | Low | Security | segment and point accept any image, not only a checked drawing | No: needs a decision |
| 12 | Nice to have | Lean | Two copies of `parseJson` | No: style |
| 13 | Nice to have | Load | `GET /api/gallery` has no cache header | No: fine at this load |
| 14 | Nice to have | Data | The `checks` table only grows | No: fine at this load |
| 15 | Nice to have | Memory | Home's IntersectionObserver keeps old nodes until the next Home visit | No: harmless |

### Must fix

1. **Chunked uploads were parsed whole** (`worker/routes/understand.ts`, `segment.ts`, `point.ts`) — fixed in 84eb6bb
   - **What this is:** Each route refused a body over about 416 KB by its `Content-Length` header, then called `req.formData()`.
   - **Problem:** A chunked upload has no `Content-Length`. `curl -H "Transfer-Encoding: chunked" --data-binary @100MB.bin /api/segment` made the Worker buffer and parse the whole body before `readImage` said 413. Thirty of those a minute per IP can run an isolate (128 MB) out of memory, which also fails other people's requests in it. `POST /api/worlds` and `PATCH` already used the bounded `readBody`.
   - **Fix:** `readForm(req, cap)` in `worker/limits/input.ts` reads through `readBody` (413 at cap + 1 bytes), then parses. All four multipart routes use it. Test: a streamed body over the cap on each route → 413 with no model call.

2. **Other sites could spend the budget through their visitors' browsers** (`worker/index.ts`) — fixed in d356ad6
   - **What this is:** The model routes accept multipart, and `/api/backdrop` parses its body as JSON whatever its `Content-Type`.
   - **Problem:** Both are "simple" requests that need no CORS preflight. Any web page could run `fetch(".../api/backdrop", {method: "POST", mode: "no-cors", body: '{"title":"x","style":"sketch"}'})` in every visitor's browser. Each visitor brings a new IP, so the per-IP limits do not slow it down, and each call spends from the shared $2.
   - **Fix:** The router refuses a POST, PATCH or DELETE whose `Origin` header is present and is not the Worker's own origin, with 403, before the rate limit. Browsers always send `Origin` on these methods (`null` from a no-referrer page, also refused). Requests without `Origin` (scripts) behave as before; finding 5 covers those. Tests: a foreign, a `null` and an `http:` origin → 403 with no limiter and no model call; the own origin and no origin reach the handler.

3. **A crafted saved world crashed the tabs of everyone who opened it** (`shared/saved.ts`) — fixed in 2145242
   - **What this is:** `SavedScene.img` (the Work_Image size) allowed up to 4096 × 4096, and each bbox up to 4096.
   - **Problem:** The Viewer allocates `img.w × img.h × 4` bytes and draws every cut-out on a canvas up to that size, all 30 at once. A save with `img 4096 × 4096` and 30 full-size bboxes asks for about 64 MB + 30 × 128 MB. Only `source.jpg` must pass the safe check, so anyone can make such a world, and it shows in the Gallery.
   - **Fix:** img sides are at most `MAX_IMG_SIDE = 1024`, the Work_Image long side of Requirement 1.3 (the pad is 1024 × 768, `workImage` scales to 1024). Every crop is clamped to img, so the Viewer's memory is now bounded like a real world's. Test: a 4096 × 4096 save → 400 and nothing written. Property 10's generator now draws img sides up to 1024; it passes.

4. **Saved worlds publish pictures and titles that nothing checks** (`worker/routes/worlds.ts`) — not fixed, needs a decision
   - **What this is:** A save needs a `checks` row with `safe = 1` for the SHA-256 of `source.jpg`, which only `/api/understand` writes.
   - **Problem:** That proves only that `source.jpg` is a safe drawing. `thumb.jpg`, the cut-out PNGs, `backdrop.jpg` and the title are whatever the client sends. Someone can save a checked drawing with any picture as its thumbnail, and that picture shows on Home's gallery strip and the Gallery for every visitor.
   - **Options:** (a) new worlds stay out of the Gallery (`safe = 0` or a `listed` column) until the operator approves them, and the Gallery shows the sample worlds; (b) one more Spark safety call on `thumb.jpg` per save ($0.01; misses the cut-outs); (c) keep it, and remove bad worlds by hand with `UPDATE worlds SET safe = 0 WHERE id = ?` on `sketch-world-db` (the Viewer and Gallery then hide the world).
   - **Recommendation:** (a) for the judging period if judges will browse the Gallery; otherwise (c), with that command written down.

5. **One person can use up the day's budget in minutes** (`wrangler.jsonc`, `worker/limits/rate.ts`, `worker/cost.ts`) — not fixed, needs a decision
   - **What this is:** Each IP may call understand 6, point 6, segment 30 and backdrop 6 times a minute; the daily cap is $2.
   - **Problem:** One IP within those limits spends about $0.26 a minute ($0.06 + $0.06 + $0.075 + $0.06), up to $0.38 when Spark replies need retries. The $2 is gone in 5–8 minutes, and Sample_Mode then holds for everyone until 00:00 UTC. The cap protects the bill, as designed, but not the demo. An IPv6 client can also use a new address of its /64 for each request. Workers Rate Limiting is also approximate and counted per Cloudflare location ([Cloudflare docs](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)), so the limits are soft.
   - **Options:** (a) a per-IP daily budget in D1, for example at most 10% of the cap per IP per day, checked in `reserveCall`; (b) key IPv6 addresses by their /64 (changes the key format of Requirement 11.1); (c) Turnstile on `/api/understand`; (d) a higher cap during judging.
   - **Recommendation:** (a) plus (b). They are about 20 lines and a test, but they change Requirement 11.1 and 11.5–11.6 behaviour, so they wait for your decision.

6. **The Viewer hung when 3D could not start** (`src/ui/viewer.ts`) — fixed in d33beea
   - **What this is:** `load()` fetched the world inside a try, then called `open()` (three.js) after it.
   - **Problem:** `new WebGLRenderer()` throws without WebGL, or once the browser has too many WebGL contexts. The throw left the page on "Opening this world…" for good, with an unhandled rejection.
   - **Fix:** `open()` runs inside the try, so the failure shows "This world couldn't open" with Try again; a half-opened world is closed and the site header and footer come back. No automated test: the Viewer is DOM and WebGL code, and the unit tests run in Node. Create already handled this case in `make()`.

### Should fix

7. **Leaving Create kept spending** (`src/cut/io.ts`, `src/ui/create.ts`) — fixed in 76eaea5
   - **What this is:** The chain sends up to 12 noun SAM calls (3 at a time), one point call and up to 4 box SAM calls.
   - **Problem:** A run that was left (the user navigated away) dropped its result, but the queued calls still went out: up to 14 model calls (9 queued noun calls, the point call and 4 box calls), roughly $0.05 of the shared cap, for a world nobody sees.
   - **Fix:** `chainIO(jpeg, live)` asks `live()` just before each request is sent; Create passes `() => me === run`. Calls already sent still finish. Tests: with the run left after 3 calls were sent, the 2 queued calls and the point call are skipped; while live, every call is sent.

8. **No `frame-ancestors`** (`public/_headers`) — fixed in 23a3103
   - **What this is:** The CSP sets `default-src 'self'`, which does not cover `frame-ancestors`.
   - **Problem:** Another site could frame `/w/<id>` and trick the world's owner into the two clicks of Delete world.
   - **Fix:** the CSP ends with `frame-ancestors 'none'`. This adds one directive to the literal CSP of Requirement 12.7 and design.md "Security Considerations"; those texts should get it too (not edited here).

9. **A timed-out model call is retried on one reservation** (`worker/meta/metaFetch.ts`) — not fixed, needs a decision
   - **What this is:** `metaFetch` makes up to 3 attempts on a timeout, a network error, a 429 or a 5xx. The route reserves the cost once.
   - **Problem:** A request that timed out on our side (30 s, 90 s for Muse Image) may still have run and been billed by Meta. Three timeouts can cost three times the reservation, so real spend can pass the cap. 429 and 5xx are probably not billed.
   - **Options:** reserve again before a retry after a timeout, or do not retry after a timeout (more 502s, which the browser already handles as a miss or the gradient sky).
   - **Recommendation:** reserve again before a retry after a timeout: real spend then stays under the cap, and a user sees no change until the cap is reached.

10. **Shared IPs share one limit** (`wrangler.jsonc`) — not fixed, needs a decision
    - **What this is:** The limits are per IP: 6 understand and 30 segment calls a minute.
    - **Problem:** A class or office behind one NAT, or a mobile carrier's shared IP, shares them. One world uses 6–16 segment calls, so that group can make only 2–5 worlds a minute. A busy group sees "try again in a minute" on understand, and objects "not found" when SamClient gives up after its 3 retries.
    - **Recommendation:** keep the limits while the cap is $2 (finding 5 matters more). If you raise the cap for judging, raise `RL_SEGMENT` to 60 with it.

11. **segment and point accept any image** (`worker/routes/segment.ts`, `point.ts`) — not fixed, needs a decision
    - **What this is:** Only understand checks that a picture is a safe drawing.
    - **Problem:** Anyone can send a photo of a real person straight to `/api/segment` or `/api/point`, which understand would refuse. The cap still applies.
    - **Option:** require a `checks` row with `safe = 1` for the SHA-256 of the image on both routes; the browser already sends the same JPEG bytes it sent to understand. This costs one D1 read per call (about 17 per world).
    - **Recommendation:** do it if you want the refusal of Requirement 3.9 to hold on every route. It is not in the requirements, so it waits for you.

### Nice to have (left as is)

12. **Two copies of `parseJson`** (`worker/routes/understand.ts`, `point.ts`; `worker/limits/input.ts` has a bytes version). Merging them saves about 14 lines. Style only.
13. **`GET /api/gallery` is not cached.** Each Home and Gallery view runs one D1 batch of two indexed reads (about 27 rows). That is fine for the D1 free tier at hackathon traffic. A 30 s `Cache-Control` would delay a new world in the Gallery, which a user would notice.
14. **The `checks` table only grows**: one small row per understand call. That is fine for months at this traffic.
15. **Home's IntersectionObserver** keeps watching the old Home nodes after you leave Home, until the next Home visit disconnects it. It is harmless.

## Checked and fine

- **Owner token:** 32 random bytes from Web Crypto, only the SHA-256 is stored, `isOwner` hashes before the lookup and compares with `crypto.subtle.timingSafeEqual` after a length check. A missing token, a wrong token and an unknown id all get the same 403. Brute force is not possible at 256 bits, so DELETE needs no rate limit.
- **Asset keys:** `GET /a/:key` tests the design regex before any R2 read. The URL parser resolves `.` and `..`, and an encoded `%2F` does not match.
- **D1:** every statement uses `?N` bound parameters, including the gallery's `json_each(?1)`. The only interpolated SQL is in test helpers.
- **Rate limit and cost cap order:** every model call (understand per attempt, point per attempt, segment, backdrop) runs after the router's `rateLimit` and after `reserveCall`. The reserve batch is one transaction with the cap in the UPDATE, so concurrent calls cannot both pass (Property 7). Finding 9 is the only way spend can pass a reservation.
- **Prompts:** the Worker builds every prompt. Titles and nouns pass charset rules with no quote or line break before they reach a quoted slot. Extra request fields are ignored (route tests).
- **Logs:** no key, header or body is logged; failures log error names and zod field paths only.
- **DOM:** every `innerHTML` assignment is a static template (`shell.ts`, `home.ts`, `gallery.ts`, `viewer.ts`, `create.ts`, `corners.ts`, `pad.ts`, `probe.ts`). The only interpolations are constants and the pad's numeric size. Titles, nouns, labels and gallery items go in through `textContent`, `document.title` or `href` built from a 10-character id.
- **localStorage:** holds only `owner:<id>` tokens and two "seen" flags, and every access is wrapped in try/catch.
- **Refused save:** the world stays open and playable, and the error shows in the HUD slip. A save in flight when the user leaves is harmless; the thumbnail is rendered before the first await.
- **Navigation:** Create and the Viewer dispose the world, walk and HUD, call `forceContextLoss()`, and check `run`/`left` after each await, so a late reply after leaving changes nothing. A late backdrop is ignored once its world is gone.
- **Saves:** R2 is written first and D1 last, with the keys deleted on failure, so a half-saved world is never visible. DELETE removes the D1 row first.
- **Off-by-one:** gallery `LIMIT 24`, cut ids 0–29 against the asset regex `\d{1,2}`, moves keys, the point route's `count` filter and `capInstances` all match their limits.

## Verdict

Fix 4 and 5 first: both need your decision. Findings 1, 2, 3, 6, 7 and 8 are fixed.

Lean: −14 lines possible (finding 12).

Not checked: the deployed site (no deploy and no live model calls in this review).
