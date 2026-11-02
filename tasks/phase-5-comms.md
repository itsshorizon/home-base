# Phase 5: Comms: radio, Meshtastic, PACE plan

Read `CLAUDE.md` first, especially **invariant 4**: never write a frequency, repeater, phone number, tone or address from memory. The app is at v0.5.1.

**What already exists:**
- **`data/comms.json`**: verified research, every entry with `source` and `checkedAt`:
  - `noaaWeatherRadio`, `broadcastEAS`
  - `hamRepeaters` (19; mode is FM, DMR, D-STAR or Fusion), `hamNets`, `hamOrganizations`
  - `simplexStandards`, `frsGmrsChannels`, `murs`
  - `gmrsRepeaters` (empty), `publicSafety`
  - `meshtastic` (with `communities`), `fccRules`
  - `unverified`. **Never show anything from `unverified` in the UI.**
- **The route `#/comms`** goes to `placeholder.js`. In `js/views/more.js`, the "Comms & Radio" row says "Coming in a later phase".
- **Inventory kinds** `weather_radio` and `two_way_radio`, in category `comms`.
- **The household:** nobody has a ham license yet. They have one phone. The app is used mostly offline.

**Goal:** a Comms section someone can use in an outage, with no internet, to:
1. know what to **listen to right now**
2. **reach family** (the PACE plan)
3. run and troubleshoot **Meshtastic**
4. understand **what they may legally transmit**, and how to get licensed beforehand

Two agents build this **in parallel**. Each part says which files it owns.

---

## Part A: Comms guides and Meshtastic troubleshooting content (research agent)
**You own:**
- `data/guides/comms-*.json`, `data/guides/ham-*.json`, `data/guides/gmrs-*.json`, `data/guides/meshtastic-*.json`
- `data/comms/mesh-troubleshoot.json`
- `img/guides/` (new diagrams only)
- `js/guides.js`: only adding the category
- `tests/guides.test.js`
- `data/comms.json`: **add** entries only, with sources

**Do not edit:**
- `js/app.js`, `sw.js`, `js/views/*`, `css/*`
- **Do not run** `npm run guides`. It rewrites sw.js; the lead runs it. Use `node scripts/guides-index.js --dry-run` to validate.

### Rules
Follow the same sourcing rules as `tasks/guides-content.md`. Read its file format and block types.
- **Every number must come from a source you opened during this task:** frequencies, power limits, license fees, license terms, exam question counts, hop limits, battery figures, distances.
- **Allowed sources:**
  - FCC / eCFR (47 CFR Parts 95 and 97)
  - ARRL, NCVEC / HamStudy
  - meshtastic.org official docs
  - CHIRP docs (chirpmyradio.com)
  - NOAA / NWS, FEMA / Ready.gov
  - manufacturer manuals (RAK, Heltec, LILYGO, Baofeng / BTECH)
- If you can't verify a number, leave it out.
- Write plainly for a stressed reader who is **new to radio**. Explain jargon the first time (offset, tone/CTCSS, simplex, repeater, PSK, hop).

### 1. Add a `comms` guide category
Add `{ key: 'comms', ... }` to `GUIDE_CATEGORIES` in `js/guides.js`, using the same shape as the others, with icon 📻, after `hazards`. Update any test that counts categories.

### 2. Guides (category `comms`). The ids are fixed: the Comms view links to them.
- **`comms-listen-first`: "No power, no internet: what to listen to"**
  - the NOAA Weather Radio for Henrico, with SAME code from `comms.json`
  - the EAS / AM stations in `comms.json` `broadcastEAS`
  - car radio as a backup
  - saving batteries (only what sources say)
  - `kinds: ["weather_radio"]`
- **`comms-what-can-i-transmit`: "What you're allowed to transmit (no license needed vs licensed)"**
  - a table covering FRS, GMRS, MURS, CB, ham, and Meshtastic (ISM 902–928 under Part 15), each with:
    - license needed?
    - power limits from Part 95/97
    - typical use
  - The **emergency exception**: what 47 CFR 97.403 / 97.405 actually say, plus the plain truth that this applies to genuine emergencies only.
  - Note that most cheap dual-band handhelds are **not certified for FRS/GMRS** transmit, if an FCC source says so; check that one exists. Otherwise omit this.
  - Uses `fccRules` from `comms.json`.
- **`ham-license`: "Getting a Technician license"**
  - exam format, cost, and where exams happen (ARRL / NCVEC VE session search, described as a thing to do **online beforehand**)
  - FCC fee, if verified
  - study resources
  - what Technician privileges allow (VHF/UHF repeaters)
  - **checklist:** steps from today to first contact
- **`ham-repeater-basics`: "Using a repeater"**
  - what offset and tone are
  - how to make a call: listen first, then ID with your call sign
  - net etiquette and the emergency "break"
  - **NATO phonetic alphabet table**
  - one diagram: radio → repeater on a tower → other radio, with the input/output frequencies and the tone labelled generically
- **`ham-baofeng-chirp`: "Program a handheld with CHIRP (do this before an outage)"**
  - CHIRP install, the cable / driver gotcha, download from radio first, back up the image, import a CSV, upload
  - Mention that the Comms screen has an **"Export CHIRP file"** button.
  - Only CHIRP-documented steps.
  - `kinds: ["two_way_radio"]`
- **`gmrs-frs`: "FRS and GMRS walkie-talkies"**
  - license rules and fee
  - channel chart (from `comms.json` `frsGmrsChannels`)
  - "privacy codes" are not private
  - range expectations only if sourced
  - family channel plan tip
  - `kinds: ["two_way_radio"]`
- **`meshtastic-basics`: "Meshtastic: text messages with no cell service"**
  - what it is (LoRa mesh, phone pairs by Bluetooth)
  - **must be set up beforehand**
  - choosing a device (the categories the docs describe)
  - region **US**, preset LongFast, the primary channel vs a private channel with your own PSK
  - sharing the channel by QR code
  - hop limit
  - the power / battery notes the docs give
  - **Local context, from `comms.json`:** the VAMesh Richmond effort is **MeshCore, which cannot talk to Meshtastic**. Say that plainly. No Meshtastic community in the Richmond area is verified, so the family should plan on their **own** private channel. `kinds: ["two_way_radio"]` is optional.
- **`meshtastic-setup`: "Set up two Meshtastic radios for the family"**
  - step by step, from the official docs:
    - flash or update with the web flasher, done online beforehand
    - install the app, pair, set region US
    - set a name
    - create the private channel and share the QR code
    - send a test message
    - set a fixed position or GPS
  - a pre-outage checklist
- **`comms-pace`: "Family PACE plan"**
  - what Primary / Alternate / Contingency / Emergency means
  - an example for this household: cell → text → Meshtastic → FRS/GMRS at the meeting point, plus check-in times
  - Tell the reader to fill in their own plan on the Comms screen. That's Part B; just reference "Comms → Our plan".
- **`comms-scanner`: "Scanners and public-safety radio in Henrico"**
  - From `comms.json` `publicSafety`: most Henrico PD traffic is **encrypted**. Say what remains monitorable, only as the data says.
  - what a scanner can still be useful for: NOAA, ham nets, and fire dispatch only if the data supports it

**Diagrams** (same rules as `tasks/guide-diagrams.md`):
- **`img/guides/ham-repeater.svg`:** the repeater diagram above.
- **`img/guides/comms-pace.svg`:** four stacked P/A/C/E boxes with the example methods.
- **Optional:** a Meshtastic hop diagram (phone ↔ node ↔ node ↔ node ↔ phone).
- All are under 25 KB, with `aria-label` equal to the `alt`.

### 3. Meshtastic troubleshooting tree: `data/comms/mesh-troubleshoot.json`
**Schema** (Part B renders it; don't change the shape):
```json
{
  "checkedAt": "2026-11-02",
  "sources": [ { "title": "...", "url": "..." } ],
  "start": "root",
  "nodes": {
    "root": { "q": "What's wrong?", "options": [ { "label": "Phone won't connect to the radio", "next": "bt" }, ... ] },
    "bt":   { "q": "...", "options": [ ... ] },
    "bt-fix-1": { "fix": { "title": "...", "steps": ["..."], "source": 1 }, "options": [ { "label": "That fixed it", "next": null }, { "label": "Still broken", "next": "bt-2" } ] }
  }
}
```
- **Every node** has either `q` + `options`, or `fix` + `options`.
- `next: null` ends the walk ("Fixed").
- `fix.source` is a 1-based index into `sources`.

**Branches to cover**, using only fixes the official docs or the device manuals support:
- Bluetooth won't pair or keeps disconnecting: PIN, forget and re-pair, one app connected at a time, and so on
- no other nodes appear: region not set, a different preset, a different channel name or PSK, the antenna, distance and line of sight
- messages not delivered or no ACK: hop limit, channel mismatch, airtime / duty limits if documented
- the radio won't turn on or charge, or the battery drains fast
- the screen is blank, or it's stuck in a boot loop or the flasher fails (done online)
- GPS shows no position
- **"Never transmit without the antenna attached"**, if a device manual says so; include it where relevant

Aim for about 25–40 nodes. **Every leaf** ends in "Fixed" or "Still stuck", and "Still stuck" leads to a final "last-resort" fix: factory reset steps from the docs, plus a reminder to fall back to the next PACE method.

**Validation:** add a check to `tests/` that loads this file and asserts:
- every `next` id exists
- there are no cycles reachable from `start`
- every node is reachable
- every `fix.source` is in range

### 4. `data/comms.json` additions (optional, sourced only)
- If you can open myGMRS or a similar source for Richmond-area GMRS repeaters, add them to `gmrsRepeaters` with the same field style as `hamRepeaters`. If you can't verify them, leave the list empty and add one `unverified` line.
- Don't edit existing entries, other than moving an `unverified` item to verified if you open a source that confirms it. Report every such move.

### Part A verification
- `node --test` is green.
- `node scripts/guides-index.js --dry-run` reports no errors.
- **Browser pane** with the `home-base-2` config (port 8791), at 375 px:
  - open each new guide; confirm it renders and has no horizontal scroll
  - confirm diagrams render; look at each one
  - Before testing, unregister the SW and clear caches.
- **Clean up:** unregister the SW, clear caches, stop the server.
- **No git, no version bump.**

---

## Part B: the Comms screen (app agent)
**You own:**
- `js/views/comms.js` (new)
- `js/comms.js` (new, PURE: no DOM, no IndexedDB, Node-importable)
- `css/comms.css` (new; load it once from the view, the way `map.js` loads `map.css`)
- `js/app.js`: the route only
- `js/views/more.js`: the row subtitle only
- `sw.js`: PRECACHE, **outside** the GUIDES markers
- `tests/comms.test.js`

**Do not edit:**
- `data/guides/*`, `js/guides.js`, `data/comms/mesh-troubleshoot.json`
  - Part A writes the tree. **Develop against your own fixture** in `tests/fixtures/mesh-tree.json` using the schema above.
  - If Part A's file doesn't exist yet when you test in the browser, fall back gracefully with "Troubleshooter not available".
- **Don't bump the version.**

**Import rule:** reuse existing helpers. That means `esc`, `openSheet`, the settings get/put in `js/db.js`, the guide link format (`#/guide/<id>`, matching what other views use), and the source / disclaimer components. Read `js/views/map.js` and `js/views/guide.js` to see how they're done. Use **page CSS class names under a `.comms-` prefix**, so nothing leaks into other views. That leak is exactly the inventory chips bug just fixed in v0.5.1.

### Screen layout: `#/comms`
**Top segmented control** (sticky, 44 px tall, scrolls sideways if needed): **Listen · Our plan · Mesh · Ham · GMRS/FRS**. Remember the last section in `localStorage` (try/catch).

**1. Listen** (the default; the first thing someone needs)
- **A big card for NOAA Weather Radio:** the Henrico transmitter(s) from `comms.json` `noaaWeatherRadio`, showing frequency, callsign, SAME code (big), and location.
  - Show an entry only if it is in `noaaWeatherRadio`. **Nothing from `unverified`.**
- **AM/FM emergency stations** from `broadcastEAS`.
- **Ham nets to listen to:** from `hamNets`, with name, schedule and frequency/repeater.
- **Scanner note:** a one-line summary from `publicSafety` ("Henrico police: encrypted, can't be monitored"), using each entry's `monitorable` text.
- Every entry has a small "Source · checked 2026-10-31" line linking to its `source` URL. The link works online only; that's fine.
- Link to the `comms-listen-first` and `comms-scanner` guides.

**2. Our plan (PACE)** (household-editable)
- Store it in the settings store under key `pacePlan`. It's included in backup/export automatically. Check that `exportAll` includes settings other than apiKey.
- Fields:
  - four tiers P/A/C/E, each with `method` (a select: Cell call, Text/SMS, Meshtastic, FRS/GMRS, Ham, Meet in person, Other) and `details` (free text, e.g. "FRS ch 7, code off", "Meshtastic channel 'Woodfam'")
  - `checkIns` (free text, e.g. "Top of every hour, 2 min")
  - `codeWords` (list of `{word, meaning}`)
  - `meetingPoints` (list of `{name, details}`; optionally link to a map pin by choosing from the pins store)
  - `outOfAreaContact` (name + free text). **Don't validate or prefill** phone numbers.
- **View mode** shows the plan as a clean card stack (P/A/C/E colored chips). An Edit button opens the form.
- **Empty state:** a short explanation plus a "Start from example" button that fills in the example from the `comms-pace` guide (method names only, with no frequencies) for the user to edit.
- **Share:** a "Copy as text" button builds plain text with the pure `pacePlanText(plan)` in `js/comms.js`, which the user can text to family while the network still works. Use the clipboard API, with the fallback of a selectable textarea in a sheet.

**3. Mesh (Meshtastic)**
- **A status card** with the facts from `comms.json` `meshtastic`: region, band, default preset.
- **A local community note:** VAMesh is MeshCore and is **not** compatible. Wording comes from `comms.json` notes; plan on your own channel.
- **"Troubleshoot" button:** opens the interactive tree from `data/comms/mesh-troubleshoot.json`.
  - one question per screen
  - big option buttons
  - Back
  - Start over
  - a breadcrumb of answers so far
  - fix screens show numbered steps and the source
  - at the end: "Fixed 🎉", or "Still stuck → fall back to your PACE Alternate", which shows the plan's alternate tier if one is set
  - **Walking logic is pure:** `treeStep(tree, nodeId)` and `validateTree(tree)` in `js/comms.js`, with tests. Use `validateTree` at load and show "Troubleshooter not available" if the tree is invalid.
- **"My radios" field:** free-text node names and short IDs for family radios (settings `meshNodes`, a list of `{owner, name, shortId}`), so people know who is who.
- Links to `meshtastic-basics` and `meshtastic-setup`.

**4. Ham**
- **A banner:** "Nobody in the household is licensed yet: listen only, except in a real emergency (47 CFR 97.403)", with a link to `comms-what-can-i-transmit` and `ham-license`. Add a toggle in settings `hamLicensed` (boolean) that removes this banner. Keep it simple.
- **Repeaters list** from `hamRepeaters`:
  - Group by band (2 m / 70 cm / 1.25 m) and filter by mode (FM default · All). Use `.comms-chips` that **scroll sideways in one row**.
  - Each card shows:
    - output frequency (big)
    - offset sign and input
    - tone (or "none listed")
    - mode
    - location
    - sponsor
    - linked to
    - distance from home (see below)
  - Tap to expand notes plus source.
- **Simplex frequencies** from `simplexStandards`.
- **Organizations** from `hamOrganizations`.
- **Distance from home:** if there's a pin with `type: 'home'`, show "≈ N mi" for repeaters whose `location` text has explicit coordinates. Several do, e.g. "(37.715, -77.365)". Parse them with a pure helper `coordsFromText`; tested. **Do not geocode** anything else.
- **"Export CHIRP file (.csv)":**
  - generates a CHIRP-importable CSV of **analog FM repeaters only**, plus NOAA channels as receive-only, plus the simplex calling frequencies from `simplexStandards` that are in ham bands
  - Use the pure `chirpCsv(comms)` in `js/comms.js`.
  - **Before writing it, open CHIRP's docs on the CSV format** (chirpmyradio.com) and match the exact column header and value conventions:
    - Duplex `+`/`-`/`off`
    - Offset in MHz
    - Tone mode `Tone` with `rToneFreq`
    - receive-only via Duplex `off`
    - Name max length: **truncate names to 7 characters**, since many handhelds show 6–7
  - Test it against a fixture CSV you derive from the docs, and cite the doc URL in a comment.
  - Download it via a Blob + `<a download>` (works offline; nothing leaves the device). The filename is `home-base-chirp-YYYYMMDD.csv`.
  - Add a one-line note under the button: "Program the radio with CHIRP on a computer. Ham repeaters are listen-only until you're licensed."

**5. GMRS/FRS**
- the channel table from `frsGmrsChannels`, showing the FRS vs GMRS power columns, plus MURS from `murs`
- "License needed for GMRS" note linking to `gmrs-frs`
- GMRS repeaters if `gmrsRepeaters` is non-empty; otherwise "No verified local GMRS repeaters yet"

**Global on the Comms screen:**
- a `comms.json` "checked on" date in the footer
- Use "Your frequencies may be out of date — verify before relying on them" wording, the same caution style as the map.
- **All guide links must point to the ids in Part A**, exactly as listed.

### `js/comms.js` (pure) and its tests
Functions, all unit-tested in `tests/comms.test.js`:
- `pacePlanText(plan)`
- `treeStep(tree, id)` and `validateTree(tree)`, against the fixture, including a broken fixture: missing next, a cycle, an unreachable node, a bad source index
- `chirpCsv(comms)`
- `coordsFromText(str)`
- `groupRepeaters(list, {mode})`
- `bandOf(mhz)`

### Wire-up
- **Route:** `#/comms` → `views/comms.js`.
- **`more.js`:** subtitle "Listen, family plan, Meshtastic, ham".
- **PRECACHE (outside the markers):**
  - `js/views/comms.js`, `js/comms.js`, `css/comms.css`
  - `data/comms.json` (if it isn't already listed)
  - `data/comms/mesh-troubleshoot.json`. Add it even before Part A creates it, but **check that sw.js install won't fail on a missing file**. If install uses `cache.addAll`, a 404 aborts install. Either create a minimal valid placeholder tree file (Part A overwrites it), or tell the lead in your report. **Prefer the placeholder**: write it only if the file doesn't exist yet.
- **Dashboard weak spot:** skip. The existing NOAA radio weak spot stays.

### Part B verification
- `node --test` is green.
- **Browser pane** with the `home-base` config (port 8790) at **375 px**, plus a check at 320 px:
  - **Every section renders.** Segmented control and chips stay in **one horizontally scrolling row**. No horizontal page overflow.
  - **The PACE plan:** "Start from example" → edit → save → reload, and it persists. Copy as text works; the fallback sheet works.
  - **Troubleshooter:** walk at least three paths to "Fixed" and "Still stuck"; Back and Start over work.
  - **CHIRP export:** downloads a CSV. Read the generated text in the page and check it against the CHIRP format.
  - **Repeater distance:** works with a mock home pin.
  - **Offline:** load once, stop the server, reload `#/comms`; everything works.
  - **Regression check:** open the Map, then the Inventory, and confirm the inventory chips still scroll in one row (no CSS leak from `comms.css` either).
  - No console errors.
- **Clean up:** test IndexedDB, caches, SW, localStorage, the server and the viewport.
- **No git, no version bump.**

## Reports (each agent)
- the files created and changed
- the test summary
- for Part A:
  - the guide list with source counts
  - the tree node count
  - any `comms.json` additions or moves
  - facts you couldn't verify and left out
- for Part B:
  - what you verified, with the screenshots you checked described
  - the CHIRP doc URL used
  - any deviations
