# DESIGN.md: Sketch World

Copied from the author's Undo Manual hackathon repo; screen-specific parts (product mark, cell diagram, step rows)
are replaced as the Sketch World screens are built.

Visual rules for every Sketch World screen. Inspiration: the warm-neutral, sober style of a document/workspace tool
from the `awesome-design-md` library (warm greys, hairline borders, small radii, plain sans type), adjusted to the
app-screen rules of `design-taste-frontend`. No logos, names or brand assets from it are used. These are screens
people work in: calm, easy to scan, no marketing hero, no decoration.

## Tokens

Defined once in `src/ui/app.css` on `:root`. UI code uses the variables, never raw hex values.

```css
:root {
  /* surfaces */
  --bg: #ffffff;           /* page and cards */
  --surface: #f6f5f4;      /* quiet panels, table headers, image wells, disabled buttons */
  --line: #e5e3df;         /* 1px borders and dividers */
  --rule: #efede9;         /* table row rules, one step lighter */
  --line-strong: #c8c4be;  /* input and secondary-button borders, one step darker */
  /* text, every tier ≥ 4.5:1 on --bg and --surface */
  --ink: #1a1a1a;          /* headings, body, primary button fill */
  --ink-2: #37352f;        /* body on tinted surfaces */
  --muted: #5d5b54;        /* secondary text, table headers, hints */
  /* accent: the one hue. Focus ring, progress fill, links, the highlighted cell. Not on buttons. */
  --accent: #0b6bcb;
  /* status: dark text on a pale tint of the same hue */
  --ok-ink: #1d6b34;   --ok-bg: #d9f3e1;
  --warn-ink: #793400; --warn-bg: #ffe8d4;
  --err-ink: #b42318;  --err-bg: #fdecea;
  /* drawing on video frames and photos (calibration grid): bright stroke over a dark halo */
  --overlay: #ffd60a;
  --overlay-halo: rgb(0 0 0 / 0.7);
  /* shape and rhythm: tight radii, 4px base */
  --r-chip: 4px; --r-control: 6px; --r-card: 8px;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px;
  --font: Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --mono: ui-monospace, "Cascadia Mono", Consolas, monospace;
}
```

No web font is loaded: the stack uses Inter when installed, else the system UI font.

## Type

| Role | Size / weight / line height | Use |
|---|---|---|
| Page title | 24px / 600 / 1.3 | One `h1` per screen, a noun ("New manual") |
| Section | 18px / 600 / 1.4 | `h2` |
| Body | 16px / 400 / 1.5 | Prose and inputs (16px stops iOS zoom) |
| Small | 14px / 400 / 1.45 | Hints, meta lines, table cells, buttons (500) |
| Caption | 12px / 500 / 1.4 | Tags, table headers |

- Numbers that update or sit in columns: `font-variant-numeric: tabular-nums`, right-aligned in tables. The debug
  view sets its figures in `--mono`; no other screen uses it.
- Sentence case for every heading, label and button, matching the names in the requirements ("Use this grid",
  "Save session", "Make manual"). No uppercase labels. Weights 400, 500, 600 only.
- Prose lines ≤ 70ch. `text-wrap: balance` on headings.

## Layout

- Product bar on top: the mark (a 3×3 grid sheet with one cell in `--accent`) and "Undo Manual", 56px tall.
- One column, `max-width: 960px`, centred. Page padding 16px; 32px from 720px up. 32px between sections,
  12px inside one.
- Works at 360px wide. The page never scrolls sideways; wide tables scroll inside their own frame.
- Touch targets ≥ 44px tall.

## Components

- **Primary button**: `--ink` fill, white label, 14px/500, padding 0 18px, height 44px, `--r-control`. One per
  screen, on the main job. Hover: 85% opacity of the fill.
- **Secondary button** (the default `button`): `--bg` fill, `--ink` label, 1px `--line-strong` border, same size.
  Hover: `--surface` fill. Disabled: `--surface` fill, `--muted` label, `cursor: not-allowed`.
- **Focus**: `outline: 2px solid var(--accent); outline-offset: 2px` on `:focus-visible`, every control.
- **File picker**: native `<input type="file">` with a visible `<label>`; its `::file-selector-button` looks like the
  secondary button. A hint line under it; an error notice under that.
- **Progress**: native `<progress>`, 8px tall, `--surface` track, `--accent` fill, round ends. Above it a status line
  in an `aria-live="polite"` region that changes in 10% steps, not every frame.
- **Card**: `--bg`, 1px `--line` border, `--r-card`, padding 16px (20px from 720px). No shadow.
- **Step row**: a card; cut-out on the left in a 96px `--surface` well (`--r-control`), then title, a cell diagram,
  meta line, tag. Rows stack with a 12px gap.
- **Cell diagram**: 3×3 grid of 1px `--line-strong` squares, the step's cell filled `--accent`. Decorative; the text
  next to it names the cell.
- **Tag**: 12px/500, padding 2px 8px, `--r-chip`. `--ok-*` for the expected result, `--warn-*` for a fallback.
- **Notice**: `--surface` fill, `--ink-2` text, `--r-card`, padding 12px 16px. **Error**: same with `--err-bg` /
  `--err-ink`, `role="alert"`, says what failed and what to do next, placed in the block that failed.
- **Table** (debug): 14px, 12px `--muted` sentence-case headers on a sticky `--surface` header row, 1px `--rule`
  row rules, no zebra. Missing values are a grey "—".
- **Canvas over frames**: strokes in `--overlay` over a wider `--overlay-halo` stroke so they read on any photo.

## Do / don't

- Do: flat surfaces with hairline borders; plain verbs on buttons ("Choose video", "Use this grid"); state in words,
  not colour alone; zeros printed as 0.
- Don't: gradients, glows, shadows on resting cards, emoji, illustrations, icons in tinted squares, a second accent
  hue, violet or indigo, centred marketing layouts, titles over 32px.
- Motion: only feedback (hover, press), ≤ 150ms, off under `prefers-reduced-motion`.
