# Phase 6: Plans, checklists, and the printable binder

Read `CLAUDE.md` first. The app is at v0.6.0.

## What Austin asked for (his words, lightly edited)
> The ideal plan right now is to pack what we can and immediately go to Gram's house in a SHTF scenario. That is the main rendezvous point. We need to make sure to bring the solar generator, the panels and the insulin. We need checklists for what to bring and for what to do when we get there.

So the centre of this phase is **"Go to Gram's"**: a fast, checkable packing list built from the household's real inventory, plus an arrival checklist. Around that sit:
- scenario checklists
- per-person go-bags
- emergency contacts
- a **printable paper binder**, for when the phone is dead

**Constraints:**
- **One phone, offline.** Everything is stored on the device in IndexedDB.
- **Never prefill an address, phone number or coordinates.** Gram's address, contacts and so on are typed in by the user, and stay local.
- **Medical content comes only from existing guides or sources you opened.** Link to guides; don't restate numbers. In particular, **insulin storage and transport go through the `t1d-insulin-storage` guide.**

## Already wired by the lead (don't redo)
- **Routes in `js/app.js`:**
  - `#/plans` → `views/plans.js` (name `plans`)
  - `#/plans/<id>` → the same view (name `plan`, `params.id`)
  - `#/print` → `views/print.js` (name `print`)
  - `#/print/<id>` → the same view (name `printpart`, `params.id`)
  - Both views are currently **stubs; replace them**.
- **`js/views/more.js`:** has the Plans row and a new **Print binder** row.
- **`js/db.js`:** `DB_VERSION` 2 adds an ID store **`checklists`**, included in backup/export.
- **Other stores and keys:**
  - `contacts` already exists (an ID store), but has no UI yet.
  - `pins`: types are home, rally, water, cache, danger and other.
  - `people` (with `t1d` and `meds`), `pets`.
  - settings keys: `pacePlan`, `meshNodes`, `hamLicensed` and so on.
- **`sw.js` PRECACHE:** **the lead adds** all new files (`data/plans/*`, new views, CSS) at the end. **No agent edits `sw.js`.** During testing, unregister the SW and clear caches first.

## Shared data shapes (all three agents must match these exactly)

### Templates written by Agent A, under `data/plans/` (static JSON)
Every item `id` is stable kebab-case and unique within its file. **Checkbox state is keyed by these ids, so never rename them.**

**Item**, used everywhere:
```json
{ "id": "insulin-cooler", "text": "...", "note": "optional short detail", "guide": "optional guide id", "source": 2, "who": "optional role hint, e.g. 'T1D person or caregiver'" }
```
`source` is a 1-based index into the file's `sources`.

**`data/plans/loadout.json`** (packing for Gram's):
```json
{ "checkedAt": "2026-11-02", "sources": [ {"title":"...","url":"..."} ],
  "tiers": [
    { "id": "t1", "title": "Grab first: medical and must-haves", "hint": "If you only have a few minutes, this is it.",
      "match": { "categories": ["t1d","meds","docs"], "kinds": [] },
      "fixed": [ Item, ... ] },
    { "id": "t2", "title": "Power and comms", "match": { "categories": ["power","comms"], "kinds": [] }, "fixed": [ ... ] },
    { "id": "t3", "title": "Water and food", "match": { "categories": ["water","treatment","food","pets"], "kinds": [] }, "fixed": [ ... ] },
    { "id": "t4", "title": "If there's room and time", "match": { "categories": ["firstaid","cooking","sanitation","shelter","tools"], "kinds": [] }, "fixed": [ ... ] }
  ] }
```
**Keep the tier ids and match rules exactly as above.** Agent B's code depends on them.

`fixed` lines are things **not** tracked as inventory items, or that need an action. **Required fixed lines** (word them well, with guide links):
- **t1:**
  - **Insulin out of the fridge and into the travel cooler**, linked to the `t1d-insulin-storage` guide (no temperatures in the text)
  - **Pump, CGM and phone with the CGM app:** all of the person's in-use devices plus chargers. Link to the `t1d-pump-failure` guide for the backup supplies.
  - **Glucagon** and **fast sugar** in a pocket, not a packed bag; link to the `t1d-hypo` guide
  - every household member's **medications** (with a note that the app lists them per person on screen)
  - phones and charging cables
  - wallet, keys, ID, cash
  - glasses or contacts
  - pets and leashes or carriers
- **t2:**
  - **"Solar generator(s): grab them, plus every charging cable"**
  - **"Solar panels: fold them, and bring their cables and connectors"**
  - power banks
  - **Meshtastic radios** and FRS radios
  - **weather radio**
  - a printed copy of this binder
- **t3:** water containers (filled), water filter and bleach (link the guides), food for at least the trip, and pet food.
- **t4:** first aid kit, stove and fuel (link the CO guide), bedding, a change of clothes per person, sanitation supplies and tools.

**`data/plans/arrival.json`:** "When we get to Gram's".
```json
{ "checkedAt": "...", "sources": [...], "sections": [ { "id": "first-hour", "title": "First hour", "items": [Item...] }, { "id": "first-day", "title": "First day", "items": [...] }, { "id": "daily", "title": "Every day there", "items": [...], "daily": true } ] }
```
- **First hour, required items:**
  - Insulin into a working fridge, or follow the cooling steps in `t1d-insulin-storage` if there's no power.
  - Check blood sugar and CGM; know where the hypo supplies are.
  - Check in with the family by the PACE plan (link "Comms → Our plan", `#/comms`) and with the out-of-area contact.
  - Unload in tier order.
- **First day:**
  - Set up the **solar panels** in full sun and connect them to the generator, following the manufacturer's instructions. List the **charging priority**: medical devices, then phones, then radios, then lights.
  - Check what water Gram's has: city, well or stored. If it's unsafe, follow the boil-advisory and water guides. Use **Map → Find water** for nearby sources.
  - Take stock of the food, medications and fuel already at Gram's.
  - Set up a Meshtastic node up high and the weather radio, tuned to the Listen tab frequency, by reference only.
  - Agree on a sanitation plan (link the guide), sleeping and lights, and fire and CO safety (the CO guide, smoke alarms).
- **Every day there** (`daily: true`, so the checks reset each day):
  - blood sugar and insulin count
  - water left
  - generator charge level
  - radio check-in at the PACE times
  - food rotation (eat the perishables first; link to food guides if present)
- **Optional:** a hard rule from Ready.gov or the Red Cross about telling others where you went, only if sourced.

**`data/plans/gobag.json`:**
```json
{ "checkedAt": "...", "sources": [...], "base": [Item...], "ifT1D": [Item...], "ifMeds": [Item...], "ifChild": [Item...], "ifPet": [Item...] }
```
- **`base`:** the Ready.gov basic kit list, for one person, sized for a bag.
- **`ifT1D`:** a T1D go-kit; reuse the wording from the existing T1D go-kit guide.
- **`ifMeds`:** "Each of this person's medications (listed below)", plus a written med list.
- **`ifChild`:** use only if Ready.gov or the Red Cross has a kids list.
- **`ifPet`:** Ready.gov's pet kit list.

**`data/plans/scenarios/<id>.json`** plus **`data/plans/scenarios/index.json`**:
- `index.json` holds `[ { "id", "title", "icon", "summary" } ]`, in this order: `go-to-grams`, then the hazard scenarios.
- Each scenario file:
```json
{ "id": "hurricane", "title": "Hurricane or tropical storm", "icon": "🌀", "summary": "...", "checkedAt": "...", "sources": [...],
  "phases": [ { "id": "before", "title": "Before (watch issued)", "items": [Item...] }, { "id": "during", "title": "During", "items": [...] }, { "id": "after", "title": "After", "items": [...] } ],
  "guides": ["guide-id", "..."] }
```
- **Scenario ids:**
  - `go-to-grams`: the **decision** checklist. It has a "When we go" phase with **triggers**, written as **examples the family edits**: an official evacuation order, water out, power out with no end in sight, and similar. **No invented thresholds.** Then a "Leaving the house" phase: lock up, shut off utilities **only if** sourced guidance says so, leave a note, and so on. It links to the Load-out and Arrival lists (`#/plans/loadout`, `#/plans/arrival`).
  - `shelter-in-place` (stay home)
  - `power-outage`
  - `boil-water` (the 2025 Richmond water-plant failure is a good framing; only facts from a source)
  - `hurricane`
  - `winter-storm`
  - `extreme-heat`
  - `tornado`
  - `flood`
  - `nuclear` (link the existing `hazard-nuclear` guide)
  - `wildfire-smoke` (only if VDEM or Ready.gov has guidance)
- Base every item on Ready.gov, FEMA, the Red Cross, VDEM, NWS, CDC or EPA. **Open each source.** Link the existing guides by id: run `ls data/guides` to see the ids, and **never** link an id that doesn't exist.

### Runtime records written by Agent B, read by Agent C
**Settings key `goPlan`:**
```json
{ "destination": { "name": "Gram's house", "pinId": null, "address": "", "notes": "" },
  "fallback":    { "name": "", "pinId": null, "notes": "" },
  "routes": [ { "label": "Primary", "text": "" }, { "label": "Alternate", "text": "" } ],
  "triggers": ["..."],
  "assignments": [ { "personId": "...", "task": "Insulin and T1D kit" } ],
  "vehicle": "",
  "leaveNote": "",
  "updatedAt": 0 }
```

**Store `checklists`:** one record per checklist "run".
```json
{ "id": "loadout" | "arrival" | "scenario:<id>" | "gobag:<personId>",
  "checked": { "<itemId or 'item:<inventoryItemId>'>": true },
  "custom": [ { "id": "c-<random>", "text": "...", "tier": "t2", "section": "first-day" } ],
  "hidden": ["<itemId>"],
  "dailyDate": "YYYY-MM-DD",
  "startedAt": 0,
  "updatedAt": 0 }
```
- **Load-out inventory lines** use the key `item:<inventory item id>`.
- **`custom` lines:** the user adds their own lines to any checklist. Load-out custom lines carry `tier`; arrival lines carry `section`.
- **`hidden`:** fixed lines the user removed. Provide a "show hidden" toggle.
- **Daily section:** `checked` entries for `daily: true` sections are cleared when `dailyDate` is not today.
- **Reset** clears `checked` and `startedAt` only, and keeps `custom` and `hidden`.

**Inventory item field `pack`** (new, optional): `'t1'|'t2'|'t3'|'t4'|'no'`. If set, it overrides the tier match. It is set in the item form.

**Store `contacts`:**
```json
{ "id", "name", "relation", "phones": [{ "label": "Cell", "number": "" }], "notes", "outOfArea": false, "order": 0 }
```

---

## Agent A: plan content (research)
**You own:** `data/plans/**`, `tests/plans-data.test.js`, and new SVGs in `img/plans/` (optional).

**You do not edit:** any JS outside `tests/`, any CSS, `sw.js`, `data/guides/*` or `data/comms.json`.

- Write all the files above, following the sourcing rules in `tasks/guides-content.md`: every fact comes from a source you open, and anything you can't verify is left out. Write plainly for a stressed reader. Text may use `**bold**` only.
- Read the existing guides you link to, so the wording doesn't contradict them.
- **`tests/plans-data.test.js`** checks that:
  - all files parse
  - every id is unique per file
  - every `source` index is in range
  - every `guide` id exists in `data/guides/index.json`
  - the tier ids and match rules are exactly t1–t4 as specified
  - every scenario in `index.json` has a file, and vice versa
  - `go-to-grams` is first
- **Verification:** `node --test` is green. No browser needed. **No git, no version bump.**
- **Report:** the files, item counts, sources per file, and anything you left out as unverifiable.

---

## Agent B: the Plans screens
**You own:**
- `js/views/plans.js` (replace the stub)
- `js/plans.js` (new, **PURE**: no DOM, no IndexedDB, Node-importable)
- `css/plans.css` (new; load it once from the view, like `map.js` does; **every selector is prefixed `.plans-`**, to avoid the CSS leak bug from v0.5.1)
- `js/views/itemform.js` (only the new `pack` field)
- `js/categories.js` (only the new `solar_panel` kind)
- `tests/plans.test.js`, `tests/fixtures/plans-*.json`

**You do not edit:** `js/app.js`, `sw.js`, `js/db.js`, `data/plans/*` (Agent A writes those; **develop against your own fixtures** in `tests/fixtures/`, using the shapes above), `js/views/print.js`, `css/print.css`.

### Screens
**`#/plans` (hub):**
- **A big hero card: "🚗 Go to Gram's".**
  - It uses `goPlan.destination.name`, so it shows "Gram's house" by default.
  - It shows load-out progress ("12 / 40 packed") and arrival progress.
  - Buttons: **Start packing** (`#/plans/loadout`), **We're here** (`#/plans/arrival`), **The plan** (`#/plans/go`).
  - If the destination has a pin, it shows the distance from the Home pin, using the haversine helper already in `js/mapinfo.js`.
- **Then:**
  - Scenarios: a list from `data/plans/scenarios/index.json`
  - Go-bags: one row per person and pet
  - Emergency contacts
  - "Print binder" (`#/print`)

**`#/plans/go`: the plan editor/viewer** (`goPlan`):
- **Destination:**
  - name (default "Gram's house")
  - **link a map pin:** pick from the `pins` store, or use the "Drop a pin on the map" hint
  - address (free text, user-typed)
  - notes, e.g. "has well water, gas stove, spare key under…"
- **Fallback rally point.**
- **Routes:** a list of `{label, text}`.
- **Triggers:**
  - an editable list
  - "Start from examples" loads the `go-to-grams` scenario's trigger items as text
- **Who does what:** person (from `people`) plus a task. Add and remove rows.
- **Vehicle notes, and the note to leave behind.**
- **View mode** is a clean summary. It has a "Copy as text" button (like the PACE plan) using the pure `goPlanText(plan, people, pins)`.
- **The PACE plan:** show a compact read-only summary from `pacePlan`, with a link to `#/comms`. Don't duplicate its editor.

**`#/plans/loadout`: the packing list. This is the most important screen.**
- **Built by the pure `buildLoadout(template, items, run, people)`.**
  - **Tiers** come from the template, in order.
  - **Each tier lists, in order:**
    1. its `fixed` lines, minus `hidden`
    2. **the household's inventory items** that match the tier: `item.pack` if set, otherwise `match.categories` or `match.kinds`, and excluding `pack: 'no'`
    3. the custom lines for that tier
  - **Inventory lines show:**
    - name and quantity with unit
    - **location**, big and prominent ("📍 Garage shelf B"), because that's where you go to grab it
    - an expiry warning if it has expired
  - **Items whose location mentions "Gram"** (case-insensitive) go to a collapsed **"Already at Gram's"** section, because there's no need to pack them.
  - **Medications:** in t1, the meds line expands to each person's meds from `people[].meds` (for example "Dad: lisinopril"). Read the people data; don't invent anything.
- **Required alert cards at the top** (computed in `js/plans.js`, with tests):
  - "No **solar panels** in inventory. Add them so they show up here." This fires when there are no items of kind `solar_panel`.
  - "No **solar generator / power station** in inventory." Kind `battery_pack`.
  - "No **insulin** in inventory." Shown only when a person has `t1d`.
- **New kind in `js/categories.js`:** `solar_panel: { category: 'power', label: 'Solar panel', unit: 'each', fields: [], perUnit: {}, instructions: '' }`, following the shape of the neighbouring kinds. If the form supports a watts field, add `watts`. Check the add flow lists it.
- **Check-off UX:**
  - The **whole row** is a 56 px-tall tap target.
  - Checked rows dim and move a check mark in, but **stay in place**, so they don't jump under your finger.
  - A sticky progress bar shows "Packed 12 / 40".
  - **Each tier header** shows progress and **collapses** when complete.
  - "Hide packed" toggle.
  - **Saving:** save to `checklists` on every tap, debounced 300 ms but flushed on `pagehide`.
- **"＋ Add line"** per tier (custom). Long-press or ⋯ on a fixed line: Hide; and **"Show hidden"** to restore.
- **Start / Reset:** the first check sets `startedAt`, so the header shows "Started 6:42 pm". Reset asks for confirmation.
- **"What we're taking lasts…"** card (optional but wanted):
  - Run `computeRunway` from `js/runway.js` over **only the checked inventory items**, at full quantity, with the household's current settings.
  - Show the bottleneck: "Packed supplies last ≈ 9 days (bottleneck: water)."
  - Make sure `computeRunway` is called exactly as `dashboard.js` calls it.
- **Pack field in the item form:** a select **"Pack for Gram's"** with the options: Auto (by category) · Grab first · Power & comms · Water & food · If there's room · Don't pack. It saves `item.pack`. When the value is Auto, the field is `undefined`, never a stored string.

**`#/plans/arrival`:**
- Sections from `arrival.json`, with the same row UX.
- The daily section shows "Today" and resets each day (`dailyDate`).
- Custom lines per section.
- Show `goPlan.destination.notes` at the top, e.g. "has well water".

**`#/plans/<scenarioId>`** (any id in the scenarios index):
- Phases are segmented or stacked, with the same checklist UX and run id `scenario:<id>`.
- Linked guides appear as chips.
- Sources are listed at the bottom.
- `go-to-grams` also shows the big "Start packing" and "We're here" buttons.

**`#/plans/gobag-<personId>`** (and `gobag-pet-<petId>` if pets exist):
- `base` + `ifT1D` (if `person.t1d`) + `ifMeds` (if `person.meds.length`), with the person's meds listed + `ifChild` (only when `person.age < 18` and the list exists) + custom lines.
- Pets get `ifPet`.

**`#/plans/contacts`:**
- Add, edit and delete contacts. Phones are a list of `{label, number}`, shown as `tel:` links.
- An **out-of-area contact** flag, highlighted at the top.
- Reorder with ↑ ↓ buttons.
- No prefilled numbers.

**Pure functions in `js/plans.js`, all tested** in `tests/plans.test.js` against the fixtures:
- `tierFor(item, tiers)`
- `buildLoadout(...)`
- `progress(...)`
- `applyDailyReset(run, todayStr)` (the date is passed in; never call `Date.now()` inside)
- `gobagFor(person, gobagTemplate)`
- `loadoutAlerts(items, people)`
- `goPlanText(...)`
- `isAtGrams(item)`

### Agent B verification (port 8790, `home-base` config, 375 px, plus a 320 px check)
- **Seed test data:**
  - a T1D person, a second person with one med, a pet
  - about 20 inventory items, including:
    - insulin in "Fridge"
    - a solar generator (`battery_pack`) in "Garage"
    - **no** solar panel at first
    - water in "Pantry"
    - one item in "Gram's basement"
  - Your fixtures stand in for Agent A's templates if `data/plans/` isn't there yet. **If A's files exist by then, test with the real ones.**
- **Check that:**
  - The solar panel alert shows. Add a `solar_panel` item through the real Add flow, and the alert clears.
  - The pack override moves an item between tiers.
  - The "Already at Gram's" section works.
  - Check-offs persist across a reload. Reset works.
  - The daily reset works, simulated by editing `dailyDate`.
  - The "lasts ≈ N days" card updates as you check items.
- **Layout and regressions:**
  - No horizontal overflow.
  - The inventory chips still scroll in one row after visiting Plans (the CSS leak check).
  - No console errors.
- **Offline:** you can't edit `sw.js`. Check that the screens work with the server up. The lead does the offline pass.
- **Clean up:** delete the test DB, caches and SW; stop the server; reset the viewport.
- **No git, no version bump.**

---

## Agent C: the printable binder
**You own:**
- `js/views/print.js` (replace the stub)
- `js/print.js` (new; pure builders that return HTML strings from data, so they're Node-testable)
- `css/print.css` (new; loaded once by the view; **every selector is prefixed `.print-`**, and the `@media print` rules are also scoped)
- `tests/print.test.js`

**You do not edit:** `js/app.js`, `sw.js`, `js/db.js`, `js/views/plans.js`, `js/plans.js`, `data/plans/*`, or the guides.

**Read-only inputs:**
- the `checklists`, `contacts`, `people`, `pets`, `items` and `pins` stores
- settings: `goPlan`, `pacePlan`, `meshNodes`
- `data/comms.json`, `data/plans/*`, `data/guides/*`
- Use **your own fixtures** for `data/plans/*` until Agent A's exist, matching the shapes above. Handle missing files gracefully: skip the section and add a note.

### `#/print`: the picker
- **Checkboxes for the sections**, remembered in `localStorage` (wrapped in try/catch).
- **Default ON:**
  1. **Cover / quick card:** household name ("Home Base binder"), date printed, and the **Gram's** destination name and address, routes and fallback.
  2. **Go to Gram's plan:** triggers, who does what, routes.
  3. **Load-out checklist (blank boxes):**
     - every tier, with inventory items **and their locations**, and the fixed and custom lines
     - "Already at Gram's" listed separately
     - **Rebuild the same logic** as `buildLoadout`: import it from `js/plans.js` if Agent B's file exists at integration time. **Otherwise, write a local version and flag it in your report so the lead can dedupe.** Prefer to coordinate on the function signature in the spec.
  4. **Arrival checklist (blank boxes).**
  5. **Family PACE plan** and **emergency contacts** (all phones) and **out-of-area contact**.
  6. **Medical summary:**
     - per person: name, age, blood type, allergies, conditions, meds (dose and per day)
     - **the T1D emergency plan numbers**, using the existing `t1dPlanHtml` from `js/guides.js` if it renders printable HTML
     - Put a "private medical information" notice at the top of the section.
  7. **Comms quick card:**
     - the NOAA frequency and SAME code
     - the EAS stations
     - the FRS/GMRS channel table
     - the Meshtastic region and preset, plus the `meshNodes` list
     - the top FM repeaters, with frequency, offset, tone and location
     - everything from `data/comms.json`, **never** from `unverified`
  8. **Emergency guides:** the guides with `emergency: true` in `data/guides/index.json`, rendered in full.
- **Default OFF:**
  - all other guides, grouped by category, each with its own checkbox
  - all scenario checklists, each with its own checkbox
  - go-bags per person
  - the full inventory by location (name, qty, unit, expiry), grouped by location
  - the map pins list (name, type, lat/lon to 5 decimals, notes)
- **Buttons:**
  - **"Preview"** renders the selected sections below, on screen, at the print styling.
  - **"Print / Save as PDF"** calls `window.print()`.
  - **The note under them:**
    > On iPhone: if nothing happens, open the app in Safari, then Share → Print, and pinch out on the preview to save a PDF. Print it on Wi-Fi now. Keep the paper copy with the go-bags.
  - **Test** whether `window.print` exists, and keep the note visible either way.
- **Size estimate:** "≈ N pages", a rough count of sections and lines. Keep it simple.

### `#/print/card`: wallet card
- A small, two-sided card, about 3.5 × 2 in per side, printed 4-up on letter paper so the family can cut out a card each.
- **It holds:**
  - the destination name and address
  - the fallback point
  - the PACE tiers, in short form
  - the out-of-area contact name and phone
  - one FRS channel and the Meshtastic channel name from the PACE plan, if set
  - the NOAA frequency
  - for any T1D person: "Type 1 diabetic — needs insulin. If confused or unresponsive: give sugar if they can swallow, glucagon, call 911." Take this wording **only** from the existing `t1d-hypo` guide's text; adapt it, don't invent.
- Link to it from the picker.

### Print styling (`css/print.css`)
- **`@media print`:**
  - hide the app chrome (header, tab bar, picker controls)
  - white background, black text, a 10.5 pt base and 9 pt tables
  - checkboxes as empty ☐ boxes
  - `break-before: page` per section
  - `break-inside: avoid` on items, tables, figures
  - URLs printed after source links, as `a[href^="http"]::after { content: " (" attr(href) ")" }`, scoped to `.print-`
- **Guide figures:** they print, at a max of 3.2 in wide. They are dark SVG cards. They're readable, but ink-heavy; that's acceptable. **Note it** in your report.
- **Running footer:** "Home Base · printed YYYY-MM-DD", if CSS paged media allows it. If not, put that line at the top of each section.
- **On screen, the preview** looks like paper: a white card with dark text, inside the dark app.

### Agent C tests and verification
- **`tests/print.test.js`:**
  - the builders escape user text, which is critical, since names and notes come from user input
  - sections are skipped when their data is missing
  - the wallet card renders with a minimal or empty `goPlan`
  - no `unverified` comms data leaks
- **Browser** (port **8791**, the `home-base-2` config, so you don't collide with Agent B), at 375 px:
  - seed test data, then select all and Preview
  - check every section renders and nothing overflows
  - **emulate print:** check the print media rules by reading the computed `display` of the header and tab bar with a print-media test. The `window.matchMedia('print')` route isn't toggleable, so instead temporarily add a class that applies the same rules, or **inspect the CSS rules**.
  - Take a screenshot of the Preview for the cover, the load-out and the wallet card.
- **Clean up:** the test DB, caches, SW and server.
- **No git, no version bump.**

---

## Lead integration (after all three agents finish)
1. If Agent C wrote a local `buildLoadout`, dedupe it.
2. Add to PRECACHE:
   - `js/views/plans.js`, `js/plans.js`, `css/plans.css`
   - `js/views/print.js`, `js/print.js`, `css/print.css`
   - `data/plans/**`
3. Run `node --test`.
4. Test on a phone-size screen, then offline.
5. Bump the version to **0.7.0**.
