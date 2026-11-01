# Phase 3: Guides viewer, weak-spot warnings, T1D emergency plan

Read `CLAUDE.md` first. The app is at v0.2.1, with Phase 1 and Phase 2 working.

Two other agents are writing guide content into `data/guides/<id>.json` **at the same time**. The format is defined in `tasks/guides-content.md`; read it, because your renderer must support every block type listed there.
- **Do not create, edit or delete anything in `data/guides/`.**
- Put your own test guides in `tests/fixtures/guides/`.

## 1. Guides index script: `scripts/guides-index.js` (Node, no dependencies)
- Read `data/guides/*.json` and validate each file: id matches the filename, a known category, at least one source, at least three blocks, and only known block types.
- Exit non-zero with a clear list of problems if any file fails.
- Write `data/guides/index.json`: `{ generatedAt, guides: [{ id, title, category, summary, emergency, medical, kinds }] }`, sorted by category order (water, food, cooking, power, sanitation, hazards, t1d, firstaid) and then by title.
- **Rewrite the guide section of `sw.js` PRECACHE** between two marker comments, `// GUIDES:START` and `// GUIDES:END`, so it lists `data/guides/index.json` plus every guide file. Add the markers to sw.js yourself.
- Add `"guides": "node scripts/guides-index.js"` to `package.json`.
- Also accept `--dir <path>` (default `data/guides`). Tests run it against `tests/fixtures/guides` with `--dry-run`, which validates and prints without writing anything.

## 2. Guides views
- **`#/guides`** (the Guides tab; replaces the placeholder):
  - **"In an emergency" tiles:** every guide with `emergency: true`, as big red-outlined buttons in a 2-column grid with an icon and a short title.
  - A search box that matches title and summary.
  - Then the guides grouped by category, with headers and icons (💧 Water, 🥫 Food, 🔥 Cooking, 🔋 Power, 🧻 Sanitation, ⚠️ Hazards, 🩸 Type 1 diabetes, ⛑️ First aid).
  - Load `data/guides/index.json`. If it's missing, show "Guides haven't been downloaded yet".
- **`#/guide/<id>`:**
  - Show the title and summary. When `medical` is true, show a disclaimer box: "General information from the sources below, not medical advice. In an emergency call 911. Follow your own doctor's instructions first."
  - Render every block with the DOM, or `esc()` first and then convert `**x**` to `<b>`. **Never put raw JSON text into innerHTML.**
    - `steps` → `<ol>`, with large type and a big step number
    - `checklist` → checkboxes whose state is saved in localStorage per guide. Use try/catch, and add a "Reset checklist" link.
    - `warning` → red callout
    - `tip` → blue callout
    - `table` → a horizontally scrollable wrapper, so tables never cause page-level horizontal scroll at 320px
    - `source` → a small muted line, "Source: <title>"
  - **Sources** list at the bottom, as plain text (title and URL). Links are fine when online, but they open outside the app.
  - The footer shows "Checked <date>".
  - **"Related items in your inventory":** items whose `kind` is in `guide.kinds`, linking to each item.
- **`calc` block, bleach calculator:** inputs are gallons of water (default 1), bleach strength (6% or 8.25%), and clear or cloudy. Output: drops, and also teaspoons when it's 76 drops or more (state that 1 tsp ≈ 76 drops is an approximation). The EPA rate is 8 drops/gal at 6% and 6 drops/gal at 8.25%, doubled for cloudy, and always shown alongside "wait 30 minutes". Put the math in a pure function `bleachDose(gallons, pct, cloudy)` in `js/guides.js` and unit-test it: 1 gal at 6% clear = 8, 5 gal at 8.25% cloudy = 60.
- **`t1dplan` block:** for each household person with `t1d`, show a card with their plan fields (below). If a person has no plan, show "Fill in your emergency plan with your diabetes team" with a link to `#/person/<id>`. If nobody has T1D, show "No one in your household is marked as having Type 1 diabetes."
- **Item links:** item detail shows "📖 How to use" links to every guide whose `kinds` includes the item's kind. Build a kind → guides map from the index.
- Add `js/guides.js` (index loading, the kind map, `bleachDose`, and the render helpers) and `js/views/guides.js` / `js/views/guide.js`.

## 3. New item kinds (`js/categories.js`)
These are no-perUnit "gear" kinds that the weak-spot rules check for.

| Category | Kinds |
|---|---|
| tools | `co_detector` ("CO detector"), `smoke_detector`, `fire_extinguisher`, `can_opener` ("Manual can opener"), `multitool` |
| comms | `weather_radio` ("NOAA weather radio"), `two_way_radio` |
| firstaid | `first_aid_kit`, `tourniquet`, `epinephrine` (fields: count; "Epinephrine auto-injector") |
| meds | `potassium_iodide` (fields: count; "Potassium iodide (KI)") |
| t1d | `insulin_cooler` ("Insulin cooling pouch (Frio etc.)"), `glucose_meter` |

Keep the existing kinds unchanged. Update `KINDS` ordering so these appear sensibly in the Add form's kind select.

The Phase 2 AI schema derives its kind enum from `KINDS`, so it updates automatically. Make sure the ai tests still pass.

## 4. T1D emergency plan (on the Person form)
Inside the T1D section, add a collapsible **"Emergency plan (from your diabetes team)"** with these fields, stored as `person.t1d.plan = { ... }`:
- `backupBasalInsulin` (select from ROOM_TEMP_DAYS long-acting types) and `backupBasalUnits` (number): "Long-acting dose if your pump fails"
- `carbRatio` (text, e.g. "1:10"), `correctionFactor` (text, e.g. "1 unit per 50 mg/dL"), `targetBg` (text)
- `endoName`, `endoPhone`, `pharmacyName`, `pharmacyPhone`, `pumpSupportPhone`, `cgmSupportPhone`
- `notes` (textarea)
- `updatedAt`, shown as "Last updated <date> — review with your doctor yearly"

Helper text at the top: "Copy these from your doctor's written instructions. The app never calculates doses."

Phone numbers render as `tel:` links in the `t1dplan` block.

## 5. Weak spots (`js/weakspots.js`, PURE and Node-importable)
`computeWeakSpots(items, people, pets, settings, runway, now)` returns an array of `{ id, severity: 'red'|'amber'|'info', title, detail, fix: { label, href } }`, sorted red, then amber, then info.
- Use the same filtering as `runway.js` (qty > 0, not expired). Export a helper from `runway.js` if one isn't already exported.
- **No `Date.now()`:** `now` is passed in.

Let `has(kind)` mean "at least one usable item of that kind". Let `t1d` mean "someone in the household has t1d". The rules, with exact ids:

| id | Condition | Severity | Title / fix |
|---|---|---|---|
| `pump-no-basal` | someone usesPump && no usable `insulin` item whose insulinType ∈ {lantus, basaglar, levemir, toujeo, tresiba, humulin_n} | red | "Pump backup: no long-acting insulin" · fix `#/add?cat=t1d&kind=insulin` + guide `t1d-pump-failure` |
| `pump-no-needles` | someone usesPump && !has(pen_needles) && !has(syringes) | red | "Pump backup: no pen needles or syringes" |
| `t1d-no-glucagon` | t1d && !has(glucagon) | red | |
| `cgm-no-strips` | someone usesCGM && !has(test_strips) | red | "No fingerstick backup if the CGM fails" |
| `t1d-no-ketone` | t1d && !has(ketone_strips) | amber | |
| `t1d-no-fast-sugar` | t1d && !has(glucose_tabs) | amber | "No fast sugar for lows (glucose tabs or gel)" |
| `t1d-no-cooler` | t1d && !has(insulin_cooler) | amber | "No way to keep insulin cool without power" |
| `t1d-no-plan` | a t1d person has no `plan.backupBasalUnits` | amber | "Fill in <name>'s emergency plan" → `#/person/<id>` |
| `insulin-open-old` | an insulin item with `opened` and `openedAt` older than ROOM_TEMP_DAYS[type] days | amber | "<name>: opened <n> days ago, past its in-use limit" |
| `water-low` | the water resource has days < 14 | red | "Less than 2 weeks of water" (FEMA's recommendation is at least 2 weeks; cite it in detail) |
| `no-treatment` | no item with treat_gal > 0 | amber | "No way to treat water" |
| `bleach-old` | a bleach item whose `createdAt` is more than 365 days before now, or whose expires is past | amber | "Bleach may be too weak" → guide `water-bleach` |
| `fuel-no-co` | has(fuel_butane) or has(fuel_propane) or has(stove), and !has(co_detector) | red | "Fuel stoves but no CO detector" → guide `co-safety` |
| `cans-no-opener` | any food item with unit 'can' && !has(can_opener) | amber | |
| `no-weather-radio` | !has(weather_radio) | amber | |
| `no-first-aid` | !has(first_aid_kit) | amber | |
| `no-tourniquet` | !has(tourniquet) | info | |
| `no-light` | !has(light) | amber | |
| `no-power` | no item with wh > 0 && !has(battery_cells) | info | |
| `no-extinguisher` | !has(fire_extinguisher) | amber | |
| `no-smoke` | !has(smoke_detector) | info | |
| `pets-no-food` | pets.length && no pet_food | amber | |
| `med-low:<personId>:<med>` | each med resource from runway with days < 14 | red | "Refill <med> for <person> (<n> days left)" |
| `no-ki` | !has(potassium_iodide) | info | detail: "Henrico is outside the 10-mile emergency zones of North Anna and Surry. KI is mainly for people closer in; see the nuclear guide." → guide `hazard-nuclear` |

Fix links for "add" rules go to `#/add?cat=<cat>&kind=<kind>`. Guide links go to `#/guide/<id>`. A weak spot can have both: the primary fix is the add link, plus a secondary "How-to" link.

**`tests/weakspots.test.js`** covers:
- every rule firing and not firing
- the sort order
- that expired and qty-0 items don't count
- `insulin-open-old` at 27 days vs 29 days for humalog

**Dashboard:** a "Weak spots" card between the hero and the grid-down card. Show the count by severity, the top 3 red (or amber) items, and a "See all (n)" link to **`#/weakspots`**, which lists them all with fix buttons. Users can dismiss info items (stored in settings `dismissedWeakSpots: []`). Red and amber can't be dismissed, only fixed.

## 6. Housekeeping
- `js/app.js` routes: `#/guides`, `#/guide/<id>`, `#/weakspots`. Remove the Guides placeholder.
- Don't run `npm run guides` against `data/guides` yourself. Austin's lead runs it after the content lands. Test it with `--dir tests/fixtures/guides --dry-run` only. **Do add the markers** to sw.js.
- Bump the version to **0.3.0** in all three places. Add the new js files to PRECACHE.
- `node --test` must be green: the old tests plus guides (bleachDose and the index validator on fixtures) plus weakspots.

## Verification
- Browser pane at 375px, using the `home-base` launch config in `/Users/austin/Code/.claude/launch.json` (port 8790).
- **Guides:** temporarily point the guides loader at your fixtures to check every block type renders, or copy fixtures into a temp location the loader can read, and then restore it. Check:
  - no horizontal scroll at 320px, including tables
  - checklist state persists across a reload
  - the bleach calculator updates live
  - `t1dplan` shows a saved plan with tap-to-call links
- **Weak spots:** with a T1D pump user and a few items, the dashboard card shows the right reds, and fixing one (adding a CO detector) removes it.
- **Item detail:** shows "How to use" for a bleach item once a matching guide is in the index (use the fixtures).
- **Offline reload:** works.
- **Clean up:** delete the test IndexedDB, unregister the SW, stop the server, reset the viewport. Leave no fixture paths active in the shipping code.
- No git.

## Report
Files, test summary, verification results, deviations.
