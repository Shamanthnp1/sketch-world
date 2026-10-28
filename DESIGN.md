# DESIGN.md: Sketch World

Visual rules for every public Sketch World page: Home, Create, World, Gallery and the `/w/:id` Viewer. The theme is
a **paper pop-up book on a desk** (design.md "Visual Design", Requirement 17): warm paper with a faint grain,
blue-black ink, white paper sheets that cast soft shadows, and one sun-yellow accent. The pages should feel warm,
playful and made by hand, while staying clean and easy to read. Nothing on them is clip-art.

The page is the object: each screen is built from pieces of the same stationery (sheets, tabs, a strip, folded
cut-outs), never from outlined boxes. The footer is the pop-up's base page: layered paper hills with folded trees
and the sun, and the front hill runs into the white sheet the footer text sits on. Home (task 7.7) follows the
landing-page rules of `design-taste-frontend`; every other page follows its app-screen rules, inside this theme.
Loose inspiration from the `awesome-design-md` library (a warm-light footer that closes on a horizon picture); no
names, colours, type or assets of any brand are used.

The `?probe` dev tool is not part of the site and keeps its own look: `src/main.ts` removes the site chrome
(`[data-site]`), switches this sheet off and loads `src/ui/tool.css`, the pre-redesign tool tokens that
`src/ui/probe.css` builds on. Don't restyle the probe with these tokens.

## Tokens

Defined once on `:root` in `src/ui/app.css`. UI code uses the variables, never raw hex values.

```css
:root {
  /* paper */
  --paper: #e7e2d8;    /* page ground under the grain */
  --sheet: #ffffff;    /* paper elements (cards, buttons, HUD, the footer's front hill) and text on ink */
  --kraft: #d6ccbb;    /* the sheet behind a card, disabled fills, the middle hill */
  --kraft-2: #c3b59d;  /* the back hill and shaded folds: shapes only, never under text */
  /* ink */
  --ink: #172331;
  --muted: #58524a;
  /* the one accent: sun yellow */
  --accent: #ffc533;
  --err-ink: #a3201a; --err-bg: #fbe7e4;
  /* shadows: paper elements only */
  --shadow: 0 1px 1px rgb(52 40 22 / 0.12), 0 4px 10px -3px rgb(52 40 22 / 0.24);
  --shadow-lift: 0 2px 2px rgb(52 40 22 / 0.1), 0 12px 24px -8px rgb(52 40 22 / 0.34);
  --shadow-press: 0 1px 1px rgb(52 40 22 / 0.18);
  --edge: 5px 6px 0 0 var(--kraft), 6px 9px 14px -6px rgb(52 40 22 / 0.3); /* a second sheet under a card */
  --grain: /* four sparse speckle grids, see Paper */;
  /* type */
  --font-display: "Young Serif", Georgia, serif;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --fs-display: clamp(2.5rem, 1.6rem + 3.6vw, 4.5rem); /* 40–72px, the Home headline only */
  --fs-title: clamp(1.75rem, 1.5rem + 0.8vw, 2rem);    /* 28–32px, h1 on every other page */
  --fs-heading: 1.375rem;                               /* 22px, h2 */
  --fs-body: 1.0625rem;                                 /* 17px */
  --fs-small: 0.875rem;                                 /* 14px */
  /* shape and rhythm */
  --r: 3px; --r-pill: 999px;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px; --s8: 64px;
  --page: 1120px; --margin: 16px;  /* 32px from 720px up */
  --ease: cubic-bezier(0.2, 0.7, 0.3, 1);
}
```

### Colour roles and contrast

| Text on | `--paper` | `--sheet` | `--kraft` | `--accent` | `--ink` |
|---|---|---|---|---|---|
| `--ink` | 12.3:1 | 15.9:1 | 10.0:1 | 10.1:1 | — |
| `--muted` | 6.0:1 | 7.7:1 | 4.9:1 | — | — |
| `--sheet` | — | — | — | — | 15.9:1 |
| `--err-ink` on `--err-bg` | 6.4:1 | | | | |

- Every text pair reaches 4.5:1. Running text is in `--ink`; `--muted` is for meta lines, hints and disabled labels.
- **Accent**: a fill under ink text (the primary button, the current progress step, the HUD's Save) and the sun in
  the mark and the footer. Never text, a border or a heading colour. It stays under 5% of any screen.
- Surfaces step in tone (`--paper` → `--sheet` → `--kraft`), never with hairlines. `--kraft-2` is only for shapes.
- No second hue. Status beyond errors is said in words.

## Paper

- **Grain**: CSS only, on `body` under `--paper`. Four radial-gradient speckle grids with unequal tile sides
  (7×9, 11×13, 13×7, 19×17 px) at 3.5–6% ink and 35% white. They never line up into a visible lattice, cost one
  tiled paint, and need no image or `data:` URL (CSP `default-src 'self'`).
- **Shadows only on paper elements**: buttons, cards, the HUD strip, toasts, the mark and the footer hills
  (`feDropShadow` in their SVG). Text, the page ground, the stage and inline controls never get one. Nothing glows.
- **Layered edge**: a card sits on a second, kraft sheet offset 5px right and 6px down (`--edge`), done with
  `box-shadow` so it survives transforms and stacking contexts.
- **Cut-paper shapes**: inline SVG (no images, no third-party art): flat fills in the paper tones, the accent sun,
  and pop-up folds drawn as two halves, `--sheet` lit and a darker paper tone shaded. The mark is one fold and the
  sun. Decorative SVG has `aria-hidden="true"` and `focusable="false"`.
- Corners: `--r` (3px, cut paper) for every sheet, tab and card; `--r-pill` only inside the HUD strip.

## Type

| Role | Face / size / line height | Use |
|---|---|---|
| Display | Young Serif, `--fs-display` / 1.0, −0.025em | The Home headline, once (`h1.display`) |
| Page title | Young Serif, `--fs-title` / 1.1, −0.015em | One `h1` per page, a noun ("Make a world", "Gallery") |
| Heading | Young Serif, `--fs-heading` / 1.2 | `h2`, card titles, the HUD title (18px) |
| Wordmark | Young Serif, 22px / 1 | "Sketch World" in the header and footer |
| Body | system stack, `--fs-body` / 1.55 | Prose; lede 19px / 1.5; `h3` at body size, 650 |
| Small | system stack, `--fs-small` / 1.45 | Meta lines, hints, footer text, errors |

- **Display font**: [Young Serif](https://github.com/noirblancrouge/YoungSerif) 400 by Bastien Sozeau,
  self-hosted as `public/fonts/young-serif-latin-400.woff2` (Latin subset, 27 KB, from Fontsource), licensed under
  the SIL Open Font License 1.1: `public/fonts/YoungSerif-OFL.txt`. The README lists this licence (task 11).
  `index.html` preloads it; `@font-face` uses `font-display: swap` and the Latin `unicode-range`. No font CDN.
- Body text is the system font stack; nothing else is loaded.
- Young Serif has old-style figures: numbers, counts, ids and anything tabular go in the system stack with
  `font-variant-numeric: tabular-nums`.
- Sentence case everywhere, matching the requirement names ("Make a world", "Photo of a drawing", "Draw here").
  No uppercase labels, no letter-spaced captions, no text under 14px. `text-wrap: balance` on headings; prose ≤ 65ch.

## Layout

- One centred column: `--page` (1120px) plus `--margin` on each side (16px, 32px from 720px). The header, `main`
  and the footer text share these edges.
- Header on the ground, no bar chrome: the mark and wordmark at left, the nav ("Make a world", "Gallery") at right;
  under 460px the nav always takes its own row under the wordmark, on the same left edge (so the font swap shifts nothing). The current page's link has a 3px ink
  underline (`aria-current="page"`).
- `main` stacks its blocks 48px apart; inside a block 12px. Card grids use `.grid` (min 300px columns, 32/24px gaps).
- Works at 360px wide with no sideways scroll. Every control is at least 44px tall (buttons 48px).
- A skip link ("Skip to content") is the first focusable element; route changes move focus to `main`.

## Components

All live in `src/ui/app.css`. Interactive ones are real `<button>`s and `<a href>`s.

- **Primary button** (`button.primary`, `a.btn.primary`): a sun-yellow paper tab, ink label 16px/600, 48px tall,
  padding 0 24px, `--r`, `--shadow`. One per screen, on its main job.
- **Secondary button** (`button`, `a.btn`): the same tab in `--sheet`. Hover lifts it 1px with `--shadow-lift`;
  active presses it 1px down with `--shadow-press` (120ms). Disabled: `--kraft` fill, `--muted` label, flat, no lift;
  tie the reason to it with `aria-describedby`.
- **Links**: ink, underlined (1px, 2px on hover). Nav links drop the underline until hover or current.
- **Card** (`.card`): a `--sheet` sheet on its kraft second sheet (`--edge`), padding 24px, children 12px apart,
  its `.actions` 24px below. Titles are `h2`. An empty state keeps the card and says what will appear there.
- **HUD** (`.hud`, for the World page in 6.12): one white paper strip with `--shadow-lift`, rounded 28px, holding the
  world title (`.hud-title`, Young Serif 18px, set via `textContent`) and pill buttons flat on the strip: hover
  `--paper`, a toggle uses `aria-pressed` and turns ink with sheet text when on, Save & share is the accent. Under
  600px the strip spans the width and the title takes its own row.
  - Built by `mountHud(host, world, {title, onSave?})` in `src/ui/hud.ts` with its own `src/ui/hud.css` (tokens with
    fallbacks, so the `?probe` overlay shows the same HUD). Strip order: title (`h1`), Objects (`aria-expanded`),
    Pause motion (`aria-pressed`, hidden with reduced motion), Reset positions, Help, Save & share. Until `onSave`
    exists Save & share is `aria-disabled` with "Saving is coming soon" as its description, so it stays focusable.
  - Reset positions turns into "Undo reset" until something moves again (no immediate destructive action).
  - **Objects panel**: a `--sheet` sheet under the strip (320px, full width under 600px) with an `h2`, one hint, a
    list of toggle rows (one per Card, by label; the selected row is ink and its Card is tinted accent with an ink
    ring) that scrolls on its own, and a 48px paper arrow pad (plus Raise/Lower for things that fly). Arrow keys
    anywhere in the panel nudge the selected Card; hills and mountains say they stay put. Moves are announced in a
    polite status region.
  - **Controls help**: a modal `dialog` card on its `--edge` (keys and mouse, or touch, by `pointer: coarse`), shown
    on the first visit (`localStorage`) and from Help; Got it or Escape closes it.
  - On coarse pointers the HUD keeps clear of walk's touch buttons (bottom padding 152px plus the safe area), and
    the tap label stays inside the world, wrapping long names.
- **Progress steps** (`ol.steps`, for Create in 7.5): a real ordered list of plain step names ("Reading your
  drawing", "Cutting out 6 objects", "Popping up your world"). Each step has a small paper card: pending lies flat
  (`--kraft`, tilted back), the current step (`aria-current="step"`) is the accent card folding up and down, a done
  step (`.done`, plus a visually hidden " (done)") stands upright in ink with a sheet-coloured tick.
- **Toast** (`toast(text)` in `src/ui/shell.ts`): an ink slip with sheet text, bottom centre, in the
  `.toasts` live region (`role="status"`, `aria-live="polite"`) that `index.html` provides; it rises in over 200ms
  and leaves after 4 s. For confirmations only, never for errors.
- **Error** (`.error`): `--err-bg` with `--err-ink` text, 14px, `--r`, inside the block that failed, `role="alert"`.
  It says what went wrong and what to do next.
- **Gallery strip** (`renderGalleryStrip(host, items)` in `src/ui/home.ts`, styles in `app.css`): a `ul.strip` of
  `a.world-card` prints, each a `--sheet` card on its `--edge` with a 4:3 thumbnail (`width`/`height` set, lazy) and
  the title in Young Serif 18px via `textContent`, linking to `/w/:id`; hover lifts it 2px. With no items it shows
  `.strip-empty`: four `--kraft` slots cut as cards lying flat, and one sentence saying worlds appear there.
- **Focus**: `:focus-visible` draws a 3px `--ink` outline 3px out on every control and link. Never removed.
- **Forced colours**: buttons, cards, the HUD and toasts carry a transparent 1px border so they keep an edge when the
  system replaces fills and shadows.

## Motion

- Feedback only, plus one signature move: the current progress card folding up (1.2s, alternating). Buttons lift
  and press (120ms); toasts rise in (200ms). Transform and opacity only.
- `prefers-reduced-motion: reduce` stops every animation and transition and the hover/press movement; the current
  step's card then simply stands upright.

## Home (`src/ui/home.ts`, `src/ui/home.css`)

Home follows the landing-page rules of `design-taste-frontend` (direction "Colour chapters"): full-width chapters
butted edge to edge, each keeping the shell's column inside `.wrap`; nothing else on the site uses them.

- **Hero** on `--paper`: the one `h1.display` ("Walk into / your drawing", two authored lines), one lede, the primary
  "Make a world" and the secondary "Walk a sample world", beside the **pop-up book**: an inline-SVG open book
  (`--kraft-2` cover, `--sheet` pages, `--kraft` page edges) with cut-out cards standing on its pages. Each card is
  the shared line art drawn twice, a thick `--sheet` stroke as the paper edge (`.cut`) under 4px `--ink` pen lines
  (`.ink`), with a soft drop shadow; the sun is the accent disc. Under the book: "Pause motion" (`aria-pressed`) and
  "Fold it flat" / "Pop it up", which folds the cards down onto the pages in turn and back up.
- **Draw, photo, walk**: an `ol` of three fields, `--kraft` | `--sheet` | `--ink` (sheet text), the outer two running
  on to the screen edges. Each shows the same drawing further along (on paper with a yellow pencil; photographed with
  the four corner dots and Spark's name tags; standing as cut-outs on a paper island) over its step name (`h3`, 22px)
  and one sentence. On phones the fields stack full width.
- **Worlds people made**: `h2`, a link to the Gallery and the gallery strip.
- **Motion** (transform and opacity only): the headline lines rise from their baseline (800ms, the second 110ms
  later), then the lede and actions fade up; the cards fold up one after another with a slight overshoot (750ms).
  Idle, from the World's motion table: tree and flowers sway ±2.5°, the cloud drifts, the bird loops and flaps, the
  person wanders with small hops and turns, the sun pulses 3%; the house and hill stay still. Each chapter's parts
  rise in once as they enter. Reduced motion shows everything at rest and hides "Pause motion".
- No three.js, images or third-party art on Home, and no inline `style` attributes (CSP).

## Create (`src/ui/create.ts`, `src/ui/create.css`)

App-screen rules, loaded with `import()` from the shell; three.js loads only when the world opens.

- **Choices**: `h1` "Make a world", one lede, then two `.card`s side by side from 720px (stacked below): "Photo of a
  drawing" (primary "Choose a photo", plus "Take a photo" with the camera on coarse pointers only) and "Draw here"
  ("Start drawing"). Each card's buttons sit on one line at its foot. One privacy line under both.
- **Draw here**: the pad sized so its tools, the canvas and the actions fit one screen; primary "Make my world" and
  "Back". An empty pad gets an `.error` ("Draw something first") instead of a request.
- **Corners**: `pickCorners` (`src/ui/corners.ts`); Cancel returns to the choices.
- **Progress**: a `.card` "Making your world" with the `ol.steps` and "This takes up to a minute."; a visually hidden
  polite status says each step as it starts. The heading takes focus.
- **Failed**: a `.card` with an `h2`, the `.error` (the Worker's own words for 422, a short reason otherwise),
  "Try another picture" (photo) or "Back to my drawing" (pad, the drawing kept), and, when the picture wasn't the
  problem (429, 503, 5xx, no network), a primary "Try again" that sends the same drawing again.
- **World**: the host covers the window and the site header and footer hide; the HUD strip gains "Make another",
  which asks first in a dialog styled like Controls help ("Make another" / "Keep this world"), and a reload or
  closed tab asks the browser's own question. Objects not found, and why a Minimal_Scene can't be saved, go on one
  paper slip under the strip (`.create-note`, `--sheet` with `--shadow-lift`, Dismiss), never in a toast.
- **Minimal_Scene** (after a 502): the trimmed drawing on a white page 3 × its longer side wide, so its one hill Card
  shows whole from the spawn point.
- **Sky** (`src/world/build.ts`): Muse Image's panorama on a sphere around the player, twice around with its edges
  crossfaded (no seam, no mirror line), at the same scale up as across; its painted horizon fades into one haze colour,
  which the fog shares, so the ground runs into the sky without a line. Until it arrives, and when it can't be painted
  (no message: the gradient is a complete sky), a vertical gradient from the ground colour (`groundColour`, tinted
  towards white) at the horizon to a soft blue (`#a9c7df`) from about 50° up. The one colour gradient on the site:
  it's the World's sky, never a page surface. The Minimal_Scene always has the gradient.

## Routes and the shell

- `src/router.ts`: a History-API router. `match(path)` maps `/`, `/create`, `/gallery` and `/w/:id` (10 base62
  characters) to a page; anything else is the not-found page ("This page is not in the book"). Same-origin `<a href>`
  clicks are handled without a reload; links with a query (`?probe`), a hash, a target or a download, `/api/*` and
  `/a/*`, and modified clicks load normally. Back and forward work; the Worker's SPA fallback serves `index.html`.
- `index.html` holds the shell (skip link, header, footer, the toast region) so it paints before any script runs.
- `src/ui/shell.ts` fills `main` per route and sets the title ("Gallery · Sketch World") and the current nav link.
  Home is `src/ui/home.ts`; the other pages are placeholders until Create (7.5), and Gallery and the Viewer (9.5) replace them. The footer stays hidden while `main` is empty, so it never paints and then jumps.
- Page templates are static markup. User strings (titles, labels, ids, server messages) go into the DOM only via
  `textContent`.

## Do / don't

- Do: paper sheets with real edges and soft shadows; ink on paper; one sun-yellow action per screen; plain verbs on
  buttons; state in words as well as colour; the product's own drawings as the only pictures.
- Don't: hairline borders or outlined boxes, colour gradients (the grain is the one texture), glows, glass or blur,
  a second accent hue, violet, indigo or a terracotta accent, emoji, stock photos or third-party art, monospace
  outside code, uppercase labels, icons in tinted squares, centred marketing layouts on app pages, app-page titles
  over 32px.
