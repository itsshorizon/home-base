# Phase 1: Core offline app (shell, inventory, household, runway dashboard, backup)

Read `CLAUDE.md` first. Its invariants apply to everything here.
When this phase is done, the result is a usable offline app on its own. Photo/barcode, map, guides and comms content come in later phases; for now those areas get placeholder screens.

## File layout (create exactly these)
```
home-base/
  index.html            app shell: header, <main id="view">, bottom tab bar, toast container
  manifest.json         name "Home Base", short_name "Home Base", display standalone, start_url "./", scope "./",
                        background/theme #0d1110, icons: icons/icon.svg (any) + icons/icon-192.png + icons/icon-512.png
  sw.js                 service worker (see "Service worker")
  version.json          {"version":"0.1.0"}
  package.json          {"name":"home-base","private":true,"type":"module","scripts":{"test":"node --test"}}
  .gitignore            .DS_Store
  .claude/launch.json   {"version":"0.0.1","configurations":[{"name":"home-base","runtimeExecutable":"python3","runtimeArgs":["-m","http.server","8790"],"port":8790}]}
  css/app.css
  js/app.js             boot, router, tab bar, toasts, install banner, SW registration, update check; BUILD_ID = '0.1.0'
  js/db.js              IndexedDB wrapper + export/import
  js/categories.js      categories, kinds, templates, room-temp insulin table
  js/runway.js          PURE calculations (Node-importable)
  js/format.js          number/date/days formatting helpers (pure)
  js/views/dashboard.js
  js/views/inventory.js     list + item detail + edit form
  js/views/add.js           add form (manual + staples autocomplete; Photo/Barcode buttons disabled "Coming soon")
  js/views/household.js     people + pets
  js/views/settings.js
  js/views/more.js          menu linking to Household, Settings, and placeholders Comms, Plans
  js/views/placeholder.js   "Coming in a later phase" screen used for Map, Guides, Comms, Plans
  data/staples.json
  icons/icon.svg, icons/icon-192.png, icons/icon-512.png
  vendor/fonts/inter-latin-wght-normal.woff2
  tests/runway.test.js
```
Each view module exports `render(container, params)` and may export `destroy()`.

## Look and feel
- Dark theme. Put these CSS custom properties on `:root`:
  - `--bg #0d1110`, `--surface #161c1a`, `--surface-2 #1f2724`, `--border #2c3632`
  - `--text #e8efe9`, `--muted #9aa8a0`
  - `--accent #ff8a1f` (safety orange)
  - `--red #ef4444`, `--amber #f5a524`, `--green #22c55e`, `--blue #38bdf8`
- **Font:** Inter variable. Download it with `curl -L -o vendor/fonts/inter-latin-wght-normal.woff2 https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.1.0/files/inter-latin-wght-normal.woff2` and load it with a local `@font-face`. Fallback stack: `-apple-system, system-ui, sans-serif`.
- **Base sizes:** body text 16px. Buttons and inputs at least 44px tall. Cards have 12px radius.
- **Header:** the app title "Home Base", a ⋯ "More" button on the right, and an **OFFLINE** pill shown when `navigator.onLine === false` (listen for `online`/`offline` events).
- **Bottom tab bar:** fixed, with `padding-bottom: env(safe-area-inset-bottom)`. Five tabs, each with an inline-SVG icon and a label:
  - Home `#/`
  - Inventory `#/inventory`
  - Add `#/add`, as a prominent center button in the accent colour
  - Map `#/map`
  - Guides `#/guides`
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`. Also add the `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style` (black-translucent) and `apple-touch-icon` meta tags.
- **Icons:** make a simple SVG icon (a house outline inside a shield, orange on dark). For the PNGs, render the SVG with `qlmanage -t -s 512 -o <dir> icons/icon.svg`, then `sips -z 192 192`. If that fails, use any reliable macOS-native method and say which one you used.
- The app must work and look right from 320px to 430px wide, with no horizontal scroll.

## Routing (`js/app.js`)
Hash router with these routes:

| Route | View |
|---|---|
| `#/` | dashboard |
| `#/inventory` | inventory list; supports `?cat=<categoryKey>` |
| `#/item/<id>` | item detail |
| `#/item/<id>/edit` | edit form (same form component as Add) |
| `#/add` | add; supports `?cat=<categoryKey>&kind=<kindKey>` |
| `#/household` | household |
| `#/person/<id>` | person form; `new` creates one |
| `#/pet/<id>` | pet form; `new` creates one |
| `#/settings` | settings |
| `#/more` | more menu |
| `#/map`, `#/guides`, `#/comms`, `#/plans` | placeholder |

- The active tab is highlighted.
- Scroll to the top on every route change.
- Unknown routes go to dashboard.

## Data layer (`js/db.js`)
- **Database:** IndexedDB name `homebase`, version 1.
- **Object stores:**
  - `keyPath: 'id'`: `items`, `people`, `pets`, `pins`, `contacts`, `photoQueue`, `blobs`
  - `keyPath: 'key'`: `settings`
- **Exported functions:**
  - `getAll(store)`, `get(store, id)`, `put(store, obj)`, `del(store, id)`, `clear(store)`
  - `newId()`, which returns `crypto.randomUUID()`
  - `getSettings()`, which returns `{...DEFAULT_SETTINGS, ...stored}`
  - `saveSettings(partial)`
  - `exportAll()`: returns `{ app: 'home-base', schema: 1, exportedAt: ISO, stores: { items, people, pets, pins, contacts, settings } }`. Omit `blobs` and `photoQueue` in Phase 1.
  - `importAll(obj)`:
    - Throw `Error('Not a Home Base backup')` if `obj.app !== 'home-base'`.
    - Throw if `schema > 1`.
    - Otherwise clear each listed store and write all of its records **in one transaction**.
  - `requestPersist()`: calls `navigator.storage.persist()` when it is available, and returns the boolean result.
- `put` sets `updatedAt` (ISO) on every write, and sets `createdAt` if it is missing.
- **`DEFAULT_SETTINGS`** (export it from `runway.js` so tests can use it; `db.js` imports it):
```js
{ rationPct: 100, waterGalPerPersonDay: 1, stoveHoursPerDay: 1, peopleOverride: null,
  insulinUnitsOverride: null, gridDown: false, gridDownSince: null, insulinCooling: false,
  whPerDay: 0, tpRollsPerPersonWeek: 1.5, targetDays: 30, redBelowDays: 14, greenAtDays: 30,
  apiKey: '', lastBackupAt: null, installBannerDismissed: false }
```

### Item record
```js
{ id, name, category, kind, qty /*number ≥ 0*/, unit /*'can','lb','gal','canister','vial','pen','box','pack','roll','each',...*/,
  storage: 'pantry'|'fridge'|'freezer'|'other', location /*free text e.g. "Garage shelf B"*/,
  expires: 'YYYY-MM-DD'|null, opened: false, notes: '', instructions: '',
  medName: '' /*kind 'med' only: must match a person's med name, case-insensitive*/,
  insulinType: '' /*kind 'insulin' only: key of ROOM_TEMP_DAYS*/,
  perUnit: { kcal, protein_g, water_gal, treat_gal, fuel_hours, insulin_units, count, wh } /* numbers; omit fields that don't apply */,
  photoId: null, createdAt, updatedAt }
```
`perUnit.count` means "how many usable things per unit". Examples: strips per box, doses per bottle, rolls per pack, sensors per box.

### Person record
```js
{ id, name, age, sex: 'M'|'F', weightLb: null, kcalPerDay: null /*override*/, waterGalPerDay: null /*override*/,
  bloodType: '', allergies: '', conditions: '',
  meds: [{ name, dose: '', perDay: 1 }],
  t1d: null | { basalUnits: 20, bolusUnits: 20, usesPump: true, pumpType: 'tubeless'|'tubed', pumpChangeDays: 3,
                usesCGM: true, cgmDays: 10, stripsPerDay: 2, ketoneStripsPerDay: 0, injectionsPerDay: 0,
                rapidInsulin: 'humalog', basalInsulin: 'lantus' } }
```

### Pet record
`{ id, name, species, kcalPerDay, waterGalPerDay }`

## Categories, kinds, templates (`js/categories.js`)
Export `CATEGORIES`, an ordered array of `{ key, label, icon /*emoji*/ }`:

| key | label | icon |
|---|---|---|
| food | Food | 🥫 |
| water | Water | 💧 |
| treatment | Water Treatment | 🧪 |
| cooking | Cooking & Fuel | 🔥 |
| power | Power & Light | 🔋 |
| t1d | T1D Supplies | 🩸 |
| meds | Medications | 💊 |
| firstaid | First Aid | ⛑️ |
| sanitation | Hygiene & Sanitation | 🧻 |
| shelter | Shelter & Warmth | 🛏️ |
| tools | Tools | 🛠️ |
| comms | Comms Gear | 📻 |
| docs | Documents & Cash | 📄 |
| pets | Pets | 🐾 |

Export `KINDS`: an object keyed by kind key, each `{ category, label, unit, fields: [perUnit field names shown in the form], perUnit: {defaults}, instructions: '' }`. The kinds that drive the runway are listed below, with their defaults. Every category also gets a generic `<category>_other` kind (no perUnit fields), so anything can be entered.

- **food**
  - `food`: fields kcal, protein_g; unit 'can'
  - `pet_food`: category pets; fields kcal; unit 'bag'
- **water**
  - `water`: fields water_gal; unit 'gal', water_gal 1. Variants are handled by unit plus water_gal: a 24-pack of 16.9 oz = 3.17 gal, a 5-gal jug = 5, a 55-gal drum = 55.
- **treatment**
  - `filter`: fields treat_gal; instructions placeholder "Add the manufacturer's steps here (Phase 3 adds full guides)."
  - `bleach`: unit 'bottle'; fields treat_gal. The form shows helper inputs **bottle size (fl oz)** and **strength (6% or 8.25%)** and computes treat_gal = oz × 48 for 6%, or oz × 64 for 8.25%. Those are conservative clear-water figures from the EPA dose of 8 drops/gal (6%) or 6 drops/gal (8.25%); add a note that cloudy water needs double. Instructions: "EPA: 6% bleach — 8 drops per gallon; 8.25% — 6 drops per gallon. Double for cloudy water. Stir, wait 30 min; should smell faintly of chlorine. Use plain unscented bleach only. Bleach loses strength after ~1 year."
  - `purifier_tabs`: fields treat_gal, count
- **cooking**
  - `fuel_butane`: unit 'canister'; fuel_hours 1.5 (8 oz canister on high, typical); instructions note: "Indoors only if the stove is rated for indoor use; open a window and run a CO detector."
  - `fuel_propane`: unit 'cylinder'; fuel_hours 2 (1 lb cylinder, typical camp stove on high)
  - `stove`: no perUnit
- **power**
  - `power_bank`, `battery_pack`: fields wh
  - `battery_cells`: fields count, unit 'pack'
  - `light`: none
- **t1d**
  - `insulin`: unit 'vial'; fields insulin_units (vial 1000, pen 300); plus an insulinType select
  - `pump_site`: unit 'box'; fields count. One pod or infusion set = 1. Label: "Pods / infusion sets".
  - `reservoir`: unit 'box'; fields count
  - `cgm_sensor`: unit 'box'; fields count
  - `test_strips`: unit 'box'; fields count (default 50)
  - `ketone_strips`: unit 'box'; fields count (default 10)
  - `pen_needles`: unit 'box'; fields count (default 100)
  - `syringes`: unit 'box'; fields count (default 100)
  - `glucagon`, `glucose_tabs`, `lancets`: fields count
- **meds**
  - `med`: unit 'bottle'; fields count (doses per bottle); plus a medName text field with a datalist of the household's med names
- **sanitation**
  - `toilet_paper`: unit 'pack'; fields count (rolls per pack)

Export `ROOM_TEMP_DAYS`, the room-temperature life in days once insulin is out of the fridge:
```js
{ humalog: 28, admelog: 28, lyumjev: 28, novolog: 28, fiasp: 28, apidra: 28, lantus: 28, basaglar: 28,
  levemir: 42, toujeo: 56, tresiba: 56, humulin_r: 31, humulin_n: 31, novolin: 42, other: 28 }
```
Each entry gets a display label (e.g. `humulin_r` shows as "Humulin R (vial)"). Add a code comment saying the values are from manufacturer labeling, that they vary by vial vs pen, and that the user should check their own package insert.

## Runway engine (`js/runway.js`): exact contract
```js
export const DEFAULT_SETTINGS = {...};
export const FRIDGE_SAFE_HOURS = 4;     // USDA/FoodSafety.gov: fridge food after 4 h without power
export const FREEZER_SAFE_HOURS = 48;   // full freezer; half-full = 24 (use 48, note it in UI)
export function defaultKcal(person)     // see table
export function defaultProteinG(person) // weightLb ? round(weightLb/2.2046*0.8) : (age < 14 ? 30 : 50)
export function computeRunway(items, people, pets, settings, now /*Date*/) // → { resources, bottleneck }
export function shoppingList(runway, settings) // → [{ key, label, need, unit }]
export function statusFor(days, settings)       // 'red' | 'amber' | 'green'
```

### `defaultKcal(person)`
Returns `person.kcalPerDay` if it is set. Otherwise use this table (USDA Dietary Guidelines, "moderately active", rounded):

| Age | M | F |
|---|---|---|
| < 4 | 1200 | 1200 |
| 4–8 | 1500 | 1500 |
| 9–13 | 2000 | 1800 |
| 14–18 | 2600 | 2000 |
| 19–30 | 2700 | 2100 |
| 31–50 | 2500 | 2000 |
| 51+ | 2300 | 1800 |

### Head count and scaling
- **Head count** `n` = `settings.peopleOverride ?? people.length`.
- **No people entered and no override:** treat it as **one default adult**, with 2000 kcal, 50 g protein and 1 gal of water. The dashboard shows a nudge to add household members.
- **Override with people entered:** scale per-person totals by `n / people.length`. For example, people [2500, 2000] with an override of 4 gives 4500 × 4/2 = 9000.

### Grid-down
`gridDownHours` = (now − `gridDownSince`) / 3.6e6 when `settings.gridDown && settings.gridDownSince`, else 0.

### Item filtering (applies to every resource)
- Ignore items with `qty <= 0`.
- Ignore items whose `expires` is before `now`'s date. Compare on the YYYY-MM-DD string against the local date of `now`; an item expiring today is still counted.
- When grid-down:
  - ignore `storage === 'fridge'` items once `gridDownHours > FRIDGE_SAFE_HOURS`
  - ignore `storage === 'freezer'` items once `gridDownHours > FREEZER_SAFE_HOURS`

### Resources
Each resource is `{ key, label, supply, supplyUnit, daily, dailyUnit, days, status, note }`.
- `days = daily > 0 ? supply / daily : null`. **`null` means not applicable.** Leave those resources out of the bottleneck, and show them greyed with the note "Not used by your household".
- `status = days === null ? 'na' : statusFor(days, settings)`.

| key | supply (Σ over filtered items, qty × perUnit) | daily |
|---|---|---|
| `calories` | kind `food`: kcal | Σ defaultKcal × scale × rationPct/100 |
| `protein` | kind `food`: protein_g | Σ defaultProteinG × scale × rationPct/100 |
| `water` | any item with water_gal | n × (person.waterGalPerDay ?? settings.waterGalPerPersonDay), per person then scaled; + Σ pet.waterGalPerDay |
| `treatment` | any item with treat_gal | same as water daily; note "Days of water you can make safe from a river or creek" |
| `fuel` | any item with fuel_hours | settings.stoveHoursPerDay |
| `insulin` | kind `insulin`: insulin_units | settings.insulinUnitsOverride ?? Σ t1d (basalUnits + bolusUnits) |
| `pumpSites` | kind `pump_site`: count | Σ over usesPump persons of 1/pumpChangeDays |
| `reservoirs` | kind `reservoir`: count | Σ over usesPump && pumpType==='tubed' of 1/pumpChangeDays |
| `cgm` | kind `cgm_sensor`: count | Σ over usesCGM of 1/cgmDays |
| `strips` | kind `test_strips`: count | Σ t1d stripsPerDay |
| `ketones` | kind `ketone_strips`: count | Σ t1d ketoneStripsPerDay |
| `needles` | kinds `pen_needles` + `syringes`: count | Σ t1d injectionsPerDay |
| `med:<personId>:<lowercased name>` | kind `med` where medName matches (case-insensitive, trimmed): count | med.perDay. **One resource per person-med.** Label "<Person> — <Med>". |
| `power` | any item with wh | settings.whPerDay |
| `tp` | kind `toilet_paper`: count | n × tpRollsPerPersonWeek / 7 |
| `petFood` | kind `pet_food`: kcal | Σ pet.kcalPerDay |

A perUnit field that is missing counts as 0. A `count` that is missing on a kind that needs it counts as **1** (one box = one thing). That way users who don't know the count still get a conservative number.

#### Insulin grid-down cap
When `settings.gridDown && !settings.insulinCooling && gridDownHours > 0`:
- `life` = max of `ROOM_TEMP_DAYS[item.insulinType || 'other']` over the counted insulin items. All insulin warms at once, so the longest-lasting type you hold sets the limit.
- `remaining` = max(0, life − gridDownHours/24).
- If `remaining < days`, set `days = remaining`, add `capped: true`, and set the note to "Limited by heat: insulin out of the fridge lasts ~<life> days. Keep it cool (Frio pouch, evaporative cooling) to remove this limit."
- Import `ROOM_TEMP_DAYS` from `categories.js`. Both files must be Node-importable, so `categories.js` must not touch the DOM.

### Bottleneck and status
- **`bottleneck`**: the key of the resource with the lowest `days`, ignoring `null`. Return `null` if there are none.
- **Order of `resources`**: applicable ones sorted by days ascending, then the n/a ones in the table order above.
- **`statusFor(d, s)`**: `d < s.redBelowDays` → 'red'; `d < s.greenAtDays` → 'amber'; else 'green'.

### `shoppingList(runway, settings)`
For each applicable resource with `days < settings.targetDays`, return `need = (targetDays − days) × daily`. Round it up to a whole number, or to 1 decimal place for gallons. The unit is the resource's supplyUnit.

## Tests (`tests/runway.test.js`, using `node:test` + `node:assert/strict`)
Use a fixed `now = new Date('2026-11-01T12:00:00')`. Required cases, with these exact expectations:
1. **Calories:** people M35 and F35 (4500/day); one food item with qty 10 and kcal 4500 → calories.days === 10. With rationPct 50 → 20.
2. **Water:** water_gal total 14 with 2 people → 7 days. With waterGalPerPersonDay 0.5 → 14.
3. **peopleOverride:** override 4 with the same 2 people → calories.daily === 9000.
4. **No people:** defaults to 2000 kcal/day and 1 gal/day.
5. **Insulin:** one T1D person (basal 20, bolus 20); 4 humalog vials of 1000 units → 100 days.
   - gridDown with gridDownSince 10 days before now → 18 days, `capped` true.
   - With insulinCooling true → 100.
   - Add a tresiba pen (300 units), still grid-down: life 56 → min(4300/40 = 107.5, 46) = 46.
6. **Expired items:** an expired insulin vial is excluded; an item expiring today is included.
7. **Fridge/freezer:**
   - fridge food is counted at gridDown 3 h and excluded at 5 h
   - freezer food is counted at 47 h and excluded at 49 h
   - pantry food is always counted
8. **CGM:** cgmDays 10 and 9 sensors (kind cgm_sensor, qty 9, count 1) → 90 days. A box with qty 3 and count 3 → also 90.
9. **Med matching:** person med `{name:'Levothyroxine', perDay:1}` and item kind med, medName ' levothyroxine ', qty 1, count 90 → resource `med:<id>:levothyroxine` has 90 days.
10. **Fuel:** 4 butane canisters (1.5 h each) at 1 h/day → 6 days. With stoveHoursPerDay 0 → days null, and fuel is not the bottleneck.
11. **Bottleneck:** with water at 7 days, food at 10, and a T1D-free household, bottleneck === 'water', and the insulin resource has status 'na'.
12. **statusFor:** 13.9 → red, 14 → amber, 29.9 → amber, 30 → green.
13. **shoppingList:** water at 7 days, daily 2, target 30 → need 46 gal.
14. **Pump:** a tubeless pump user does not create reservoir demand (reservoirs.days null).

## Views

### Dashboard (`#/`)
Show these blocks from top to bottom:
1. **Nudges** (dismissible per session):
   - "Add your household so the math is right" when there are no people.
   - "Back up your data" when there are items and `lastBackupAt` is null or more than 7 days old. It links to Settings.
   - The **install banner**: if not standalone (`matchMedia('(display-mode: standalone)').matches || navigator.standalone`) and not dismissed, show iPhone instructions: "Tap Share → Add to Home Screen. This keeps your data safe — Safari can erase data for sites that aren't installed."
2. **Bottleneck hero:** a big card reading "You can last about **N days**", where N is the bottleneck's days formatted. Under it: "Limited by **<label>**". If there are no items, it says "Add your first items to see how long you can last" with a button to Add.
3. **Grid-down card:**
   - A toggle labelled "Power is out", which sets `gridDown` and `gridDownSince` to now. Turning it off clears both.
   - When on, show live countdowns, updated every minute: "Fridge food safe for 2h 13m" (or "Fridge food: discard (unsafe after 4 h)"), "Freezer (full): 41h left", and "Insulin out of fridge: day 3 of ~28".
   - A "Keeping insulin cool" toggle that sets `insulinCooling`.
4. **Sliders card** ("Adjust daily use"):
   - People: 1–12. Defaults to the household count. A "reset" link clears the override.
   - Ration: 50–120% in steps of 5.
   - Water per person: 0.5–2 gal in steps of 0.25.
   - Stove hours/day: 0–4 in steps of 0.25.
   - Insulin units/day: shown only if anyone has t1d; range 5–150; reset link.
   - Goal (target days): 7–180.
   - Bars recompute live on `input`; settings are saved (debounced at 300 ms) on `change`.
5. **Runway bars:** one row per resource, showing the label, a days value on the right, a horizontal bar, and supply/daily in small muted text (e.g. "45,000 kcal · 4,500/day").
   - Bar width = min(days / targetDays, 1) × 100%, coloured by status.
   - The bottleneck row has an outline and a "BOTTLENECK" tag.
   - n/a rows are collapsed under "Not tracked for your household (3)".
   - Tapping a row opens `#/inventory?cat=<category>`, using this map: calories/protein → food; water → water; treatment → treatment; fuel → cooking; insulin/pumpSites/reservoirs/cgm/strips/ketones/needles → t1d; med:* → meds; power → power; tp → sanitation; petFood → pets.
6. **Expiring soon:** items with `expires` within 60 days or already expired, soonest first. Red if expired, amber otherwise. Show at most 8, with a "see all" link to an inventory filter (`#/inventory?expiring=1`).
7. **Shopping list:** from `shoppingList()`, e.g. "Water — 46 more gal to reach 30 days". There is a "Copy list" button that uses the clipboard.

`js/format.js` exports:
- `fmtDays(d)`: null → "—"; < 1 → "<1 day"; < 365 → `${Math.floor(d)} days` (1 → "1 day"); otherwise `${(d/365).toFixed(1)} yr`
- `fmtNum(n)` using `toLocaleString`
- `fmtDate(iso)` giving e.g. "Nov 3, 2026"
- `daysUntil(iso, now)`

### Inventory (`#/inventory`)
- A sticky search box filters by name, location and notes.
- Category chips scroll horizontally: All plus the 14 categories, each with a count.
- Supports the `?cat=` and `?expiring=1` filters.
- Items are grouped by category with headers.
- **Card (at a glance):**
  - emoji, **name**, and `qty unit` (e.g. "12 cans")
  - a "provides" line computed from qty × perUnit, picking the first that applies: kcal → "54,000 kcal"; water_gal → "36 gal"; treat_gal → "treats 1,000 gal"; fuel_hours → "~6 burn-hrs"; insulin_units → "4,000 u"; count → "90 doses" / "27 sensors"
  - an expiry badge
  - the location, in muted text
  - right side: − and + buttons (44px) that change qty by 1 (never below 0), save immediately and re-render the card. Tapping elsewhere on the card opens the detail.
- **Empty state:** a big Add button.

### Item detail (`#/item/<id>`)
- A header with the name and category.
- A facts grid: qty/unit, storage, location, expires (with days left), opened, every perUnit field with its label (e.g. "Calories per can"), and the totals.
- An **Instructions** section, shown if non-empty, with preserved line breaks (render as text, never innerHTML of user input).
- **Notes.**
- Buttons: Edit, Duplicate (copies the item with a new id and opens edit), Delete (uses `confirm()`).

### Add / Edit form (`#/add`, `#/item/<id>/edit`)
- At the top, a row of three method buttons: **Photo** and **Barcode** (disabled, labelled "Coming soon"), and **Type it in** (active).
- **Fields:**
  - Category select, then a Kind select filtered by category. Changing the kind applies the template defaults, but only to fields the user hasn't edited.
  - Name, with a `<datalist>`-style custom autocomplete from `data/staples.json` when category is food (see below).
  - Qty (number, step any) and Unit (text, with a datalist of common units).
  - Storage select, Location (text, with a datalist of locations already used).
  - Expires (date), Opened (checkbox).
  - The perUnit inputs for the kind's `fields`, each with a human label and its unit. The bleach helper goes here.
  - insulinType select (insulin kind) and medName (med kind).
  - Instructions and Notes textareas.
- Validation: name is required; qty ≥ 0.
- **Save** writes the record, shows a toast "Saved", and goes to `#/inventory?cat=<cat>`. **Save & add another** keeps the category and kind and clears the rest.
- **Staples autocomplete:**
  - Fetch `data/staples.json` once and cache it in a module variable.
  - Match case-insensitive substrings; show up to 8 suggestions below the input as tappable rows.
  - Choosing one sets name, unit, kcal, protein_g, storage, and `expires` = today + shelfLifeMonths (the user can change it).
  - It also appends "Nutrition values approximate (USDA)." to notes.

### `data/staples.json`
Contains 150 or more entries: `{ name, unit, kcal, protein_g, shelfLifeMonths, storage }`. The kcal and protein are **per the stated unit**, e.g. `{ "name": "White rice, dry", "unit": "lb", "kcal": 1650, "protein_g": 32, "shelfLifeMonths": 300, "storage": "pantry" }` (sealed, oxygen-free storage).
- Cover these groups: grains and pasta, dry beans and lentils, canned beans, canned vegetables, canned fruit, canned meats and fish, canned soups and chili, peanut butter and nut butters, nuts, oils and shortening, sugar, honey and salt, flour and baking, oats and cereal, crackers, powdered milk and eggs, freeze-dried meals (per pouch), MREs, protein bars, jerky, coffee and tea, drink mixes, baby formula, glucose tabs and juice boxes (useful for hypos), and common fridge and freezer items (eggs, cheese, butter, frozen vegetables, ground beef), with the right `storage`.
- Use typical US retail package sizes in `unit`, e.g. "15 oz can", "18 oz jar", "lb".
- Values are approximate USDA FoodData Central figures. Be realistic, and don't invent precision.
- Add a top-level object form: `{ "source": "USDA FoodData Central (approximate, per package)", "items": [...] }`.

### Household (`#/household`)
- Lists the people and pets, each with Add and Edit.
- Each person row shows name, age, the computed kcal/day and water/day, and badges (T1D, n meds).
- **Person form:**
  - name, age, sex, weight (lb, optional)
  - kcal/day override, with a placeholder showing the computed default
  - water/day override
  - blood type, allergies, conditions
  - **Medications** repeater: name, dose, per day, plus add/remove rows
  - a **"Has Type 1 diabetes"** toggle that reveals the t1d fields with their defaults:
    - basal units/day, bolus units/day
    - uses pump (yes/no); pump type tubeless (Omnipod) or tubed (Tandem/Medtronic); change every N days
    - uses CGM; sensor lasts N days
    - fingersticks/day, ketone strips/day, injections/day ("for MDI or pump backup")
    - rapid insulin and basal insulin selects, from ROOM_TEMP_DAYS
  - Delete is a button with confirm.
- **Pet form:** name, species, kcal/day, water gal/day. Placeholder hint: "A 50 lb dog ≈ 1,100 kcal and 0.2 gal per day."

### Settings (`#/settings`)
- **Backup**
  - "Download backup" exports via `exportAll()` to `home-base-backup-YYYY-MM-DD.json`. If `navigator.canShare?.({files:[file]})`, use `navigator.share` (this gives the iOS share sheet: AirDrop, Files); otherwise use an anchor download. Then set `lastBackupAt`.
  - Show the date of the last backup.
- **Restore:** a file input, then `confirm('Replace everything on this device with this backup?')`, then `importAll`, a toast, and a reload. Show a friendly error message on a bad file.
- **AI photo ID:** an API key input (type password, with a show/hide toggle) and a Save button. Help text: "Stored only on this phone. Used in a later update to identify photos. Get a key at console.anthropic.com."
- **Storage:** "Using X MB" from `navigator.storage.estimate()`, plus the persisted status (`navigator.storage.persisted()`), and a "Protect my data" button that calls `requestPersist()`.
- **App version:** BUILD_ID, plus a "Check for update" button.
- **Danger zone:** "Erase all data", which requires typing ERASE.

### More (`#/more`)
Large list rows: Household, Comms & Radio (placeholder), Plans & Checklists (placeholder), Settings.

### Placeholder view
An icon, a title, "Coming in a later phase", and one line describing what will be there:
- Map: offline Henrico map with water sources
- Guides: water, T1D, first aid, stoves
- Comms: ham, GMRS, Meshtastic, local frequencies
- Plans: scenario checklists and go-bags

## Service worker (`sw.js`)
- `const CACHE_NAME = 'hb-0.1.0'`. `const PRECACHE = [...]` lists **every** file in the app: index.html, './', the css, every js including views, manifest, version.json, data/staples.json, the icons and the font.
- **install:** open the cache and `addAll` the PRECACHE, mapped to `new Request(u, {cache:'reload'})`, then `skipWaiting()`.
- **activate:** delete any cache whose name starts with `hb-` and isn't CACHE_NAME, then `clients.claim()`.
- **fetch:**
  - Only handle same-origin GET requests. Never intercept cross-origin requests (Anthropic, Open Food Facts).
  - `version.json`: network-first, with cache fallback.
  - Navigation requests: serve the cached `./index.html`.
  - Everything else: cache-first. On a miss, fetch from the network and put the response in the cache if it's ok.
- **In `app.js`:**
  - Register the SW on load.
  - When online, fetch `version.json?t=<now>` with `{cache:'no-store'}`. If its version differs from BUILD_ID, call `registration.update()`.
  - On `controllerchange` (when the page was already controlled), show a toast "Updated to vX — tap to reload".
  - Call `requestPersist()` once on first run.

## Acceptance criteria
- [ ] `node --test` passes, with all 14 cases present.
- [ ] With the dev server running: add a household (2 adults, 1 with T1D on an Omnipod plus Dexcom), plus at least one item in each runway resource. The dashboard shows bars, a bottleneck, and the shopping list. Moving each slider changes the relevant bars live.
- [ ] Turning on grid-down shows the countdowns; with backdated `gridDownSince`, fridge items drop out after 4 h.
- [ ] +/− on an inventory card changes qty and persists across a reload.
- [ ] Backup → Erase → Restore round-trips all the data.
- [ ] Offline: load once, **stop the server**, reload. Every route still renders and staples autocomplete still works.
- [ ] No console errors. No horizontal scroll at 375px. No request to any third-party origin during normal use.
- [ ] Report back: the files created, the test output, anything in this spec you changed and why, and anything you couldn't verify.
