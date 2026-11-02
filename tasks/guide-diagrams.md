# Guide diagrams

Read `CLAUDE.md` first. The Guides library has 46 guides in `data/guides/*.json` (format in `tasks/guides-content.md`), rendered by `js/guides.js`. Austin wants **diagrams** in the guides. People will read these in an emergency, on a phone, in bad light, under stress.

**Parallel work.** Another agent is building the map at the same time. To avoid collisions:
- **Do not edit** `js/app.js`, `sw.js`, `css/map.css` or `js/views/map.js`.
- **Do not run** `npm run guides` (it rewrites sw.js). The lead runs it afterward.
- **Do not bump the version.**

## 1. Support for a figure block
- **New block type:** `{"type":"figure","src":"img/guides/<name>.svg","alt":"full text description","caption":"short caption"}`
  - Render it as `<figure>` containing an `<img>` with `loading="lazy"`, `width` 100% and max-width 480px, plus a `<figcaption>`, with all text escaped. Tap opens the image full screen; reuse any existing lightbox, or use a simple overlay with a close button.
  - Add `figure` to `BLOCK_TYPES` in `js/guides.js`.
  - In `scripts/guides-index.js`, validate that `src` exists on disk and that `alt` is non-empty. Also include every referenced figure file in the generated sw.js guide section (between the markers), so diagrams are cached for offline use.
  - Add tests in `tests/guides.test.js`: figure rendering escapes text, and the validator rejects a missing file or an empty alt. Add fixtures under `tests/fixtures/`.
- **CSS:** add figure styles to `css/app.css`.

## 2. The diagrams
Hand-write original SVG files in `img/guides/`. These are simple, clear line drawings and flowcharts, not photos or clip art.

### Hard rules
- **Every number, word and position in a diagram must match the guide's own text, which is already sourced.** Read the guide JSON first and draw only what it says. **Don't add facts** that aren't in the guide. If a diagram needs a fact the guide lacks, change the design, don't add the fact.
- **Self-contained styling.** These are shown via `<img>`, so page CSS can't reach them.
  - Each SVG has its own background: a rounded rect, fill `#1f2724`, stroke `#2c3632`.
  - Colors: text `#e8efe9`, muted `#9aa8a0`, accent orange `#ff8a1f`, danger red `#ef4444`, ok green `#22c55e`, water blue `#38bdf8`.
  - Font: `font-family="Inter, -apple-system, system-ui, sans-serif"`. No external fonts, no `<image>`, no scripts.
- **Readable on a phone:** `viewBox` about 480 wide, minimum text 14px at that scale, thick strokes (3px or more), high contrast. **Don't use color as the only signal.** Pair red/green with ✕/✓ or words.
- **Size and markup:** under 25 KB each. Include `<title>` and `role="img"`, and an `aria-label` that equals the block's `alt`.
- **Clarity over detail.** Body diagrams can be simple stylized figures, but placement must be unambiguous: arrows, labels, measurement callouts. If you can't make an anatomy drawing clearly correct, make a labeled schematic instead.
- **Placement:** insert each `figure` block into the guide JSON at the right spot (usually just before the steps it illustrates). Change **nothing else** in the guide: no text edits.

### Diagrams to make (about 16)
| Guide | Diagram |
|---|---|
| `water-bleach` | "Drops per gallon" panel (6% vs 8.25%, the cloudy-water rule, the wait time from the guide) |
| `water-hidden-sources` | Water-heater cutaway: main shutoff, power/gas setting, cold-supply valve, relief valve (let air in), drain valve with hose and container, per the guide's step order (number the callouts to match the steps) |
| `water-source-choice` | Decision flowchart from the guide's table |
| `water-filters` | Squeeze-filter use and backflush, as the guide describes, in generic form (no brand logos) |
| `sanitation-toilet` | Bucket toilet: liner bag(s), absorbent, lid, disposal, per the guide |
| `stove-butane` | Do / don't: ventilation, CO alarm, no oversized pot covering the canister (only what the guide says) |
| `generator-safety` | House with the generator at the guide's distance, exhaust away, ✕ garage / ✕ near windows |
| `co-safety` | "Alarm sounds → get out → call 911 → don't go back in" flow |
| `hazard-nuclear` | "Get inside, stay inside, stay tuned": building cross-section marking the best spots per the guide |
| `t1d-hypo` | 15-15 rule loop (check → 15 g → wait 15 min → recheck → repeat / snack), with the guide's thresholds |
| `t1d-insulin-storage` | Thermometer showing the temperature limits stated in the guide |
| `t1d-pump-failure` | "First: figure out what's wrong" decision flow from the guide's steps |
| `firstaid-bleeding` | Tourniquet placement on a limb: the distance above the wound as stated in the guide; mark both sources if the guide gives two |
| `firstaid-cpr` | Hand position on the chest, plus rate and depth exactly as the guide states |
| `firstaid-choking` | Abdominal-thrust position, fist placement, per the guide |
| `t1d-hypo` or `firstaid-shock` | Recovery position (side-lying), **only if** a guide tells the reader to roll someone onto their side. Use it where the guide says so. |

Skip any diagram whose guide doesn't contain the needed facts, and list it in your report.

## 3. Verification
- `node --test` is green.
- `node scripts/guides-index.js --dry-run` validates every guide with no errors, including that every figure file exists.
- **Browser pane at 375px**, using the **`home-base-2`** config in `/Users/austin/Code/.claude/launch.json` (port **8791**, so you do not collide with the map agent on 8790): open every guide that has a figure.
  - Each one renders, is legible, doesn't cause horizontal scroll at 320px, and opens full screen on tap.
  - **Look at each diagram yourself** (take a screenshot) and fix anything cramped, overlapping or unclear.
  - Since you can't run the real index, use `--dry-run` output to check paths. A stale service worker may serve old files, so unregister it and clear caches before testing.
- **Clean up:** unregister the SW, clear caches, stop the server, reset the viewport.
- **No git.**

## Report
- the diagrams made, with guide and filename
- any skipped and why
- confirmation that no guide text changed (`git diff --stat` isn't available to you, so diff a copy you made beforehand)
- the test summary
- issues
