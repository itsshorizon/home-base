# Guides content: offline how-to library

Read `CLAUDE.md` first, especially invariants 4 and 5. These guides will be read **during an emergency, with no internet**, by a household that includes a person with Type 1 diabetes. A wrong number can hurt someone, so:

- **Every number, dose, temperature, time and ratio must come from a source you opened during this task.** Sources include EPA, CDC, FDA, FEMA/Ready.gov, USDA/FoodSafety.gov, American Red Cross, ADA (diabetes.org), Breakthrough T1D, NIH/NIDDK, MedlinePlus, DailyMed drug labels, WHO, Stop the Bleed (ACS), American Heart Association, VDH/VDEM, and manufacturer manuals (Sawyer, LifeStraw, Katadyn, Berkey, Omnipod, Tandem, Medtronic, Dexcom, Abbott, Lilly, Novo Nordisk, Xeris).
- **List those sources** in the guide's `sources`.
- **If you can't verify a number, leave it out.** Say "follow the package directions" or "ask your doctor" instead. Never fill a gap from memory.
- **Never invent medical dosing or insulin conversions.** Where a person-specific number is needed (pump-to-injection doses, insulin-to-carb ratios, correction factors), use the `t1dplan` block, which shows the numbers the family copied from their own diabetes team. You may explain the *general approach* only as the sources describe it.
- **Write plainly**, for a stressed reader. Use short steps, put the most important action first, and use bold sparingly for critical words. Address the reader as "you".
- **Write original text.** Summarize and paraphrase sources. Don't copy paragraphs.

## File format: one file per guide, `data/guides/<id>.json`
```json
{
  "id": "water-bleach",
  "title": "Make water safe with bleach",
  "category": "water",
  "summary": "One sentence shown in the list.",
  "emergency": false,
  "medical": false,
  "kinds": ["bleach"],
  "checkedAt": "2026-10-31",
  "sources": [ { "title": "EPA — Emergency Disinfection of Drinking Water", "url": "https://..." } ],
  "blocks": [ ... ]
}
```

**Field rules:**
- `category` is one of: `water | food | cooking | power | sanitation | hazards | t1d | firstaid`.
- `emergency: true` marks the handful of "do this right now" guides that get big tiles. Keep it to **about 8 in total across both agents**: hypo, bleeding, CPR, choking, anaphylaxis, CO alarm, unsafe water/boil advisory, DKA/ketones.
- `medical: true` makes the app show the medical disclaimer. Set it on every t1d and firstaid guide, and on any guide that gives health advice.
- `kinds` lists the inventory item kinds this guide explains. The app adds a "How to use" link on those items.

**Block types.** Text may use `**bold**` only. No HTML, no links inside text.

| Block | Shape | Notes |
|---|---|---|
| Paragraph | `{"type":"p","text":"..."}` | |
| Heading | `{"type":"h","text":"..."}` | |
| Steps | `{"type":"steps","items":["...","..."]}` | numbered |
| List | `{"type":"list","items":["..."]}` | bullets |
| Checklist | `{"type":"checklist","items":["..."]}` | tickable; for kits and go-bags |
| Warning | `{"type":"warning","text":"..."}` | red callout: when to call 911, dangerous mistakes |
| Tip | `{"type":"tip","text":"..."}` | |
| Table | `{"type":"table","headers":["..."],"rows":[["..."]]}` | |
| Calculator | `{"type":"calc","calc":"bleach"}` | interactive bleach-dose calculator; use only in `water-bleach` |
| T1D plan | `{"type":"t1dplan"}` | shows each T1D person's saved emergency plan (backup long-acting dose, carb ratio, correction factor, target, endocrinologist and pharmacy phone numbers), or a prompt to fill it in |
| Source | `{"type":"source","n":1}` | small "Source: <title>" line pointing at `sources[n-1]`, placed after a block that carries a key number |

## Guide list
Every listed id is required. Keep the ids exactly as written; the app links to them.

### Agent A: water, food, cooking, power, sanitation, hazards (24 guides)
**Water**
- `water-how-much`: how much to store (FEMA/Ready.gov), containers, rotation, labeling.
- `water-hidden-sources`: water already in the house (water heater draining steps, toilet tank (not bowl), ice, pipes). Include safety notes: turn off power/gas to the heater first, and sediment.
- `water-boil`: boiling. Include the time, and altitude only if the source mentions it; Henrico is low.
- `water-bleach` (`calc` block): EPA drops per gallon for 6% and 8.25%, what to do with cloudy water, wait time, smell test, and only plain unscented bleach. `kinds: ["bleach"]`.
- `water-filters`: what portable filters remove and what they don't (viruses, chemicals), then one section per brand from the manufacturer's instructions: Sawyer Squeeze/Mini (including backflushing), LifeStraw Personal/Family, Katadyn BeFree, Berkey gravity filters. Cover the freezing warning, how to tell when a filter is spent, and combining a filter with chemical disinfection. `kinds: ["filter"]`.
- `water-tablets`: chlorine dioxide and iodine tablets: contact times and limits, per manufacturer and EPA/CDC. `kinds: ["purifier_tabs"]`.
- `water-source-choice`: a decision table by source (tap during a boil advisory, rainwater, creek/river, pond/lake, flood water (don't use), pool water (not for drinking)), with the treatment for each. Also note that agricultural or fuel runoff isn't removed by filters or bleach.

**Food**
- `food-outage-safety`: fridge and freezer rules (FoodSafety.gov 4 h / 48 h / 24 h), the thermometer check, and "when in doubt, throw it out".
- `food-canned-safety`: bulging, leaking, rusted or dented cans, and botulism signs (CDC).
- `food-cooking-no-power`: no-cook meals, rationing order (fridge first, then freezer, then pantry), and fuel-saving cooking.

**Cooking**
- `stove-butane`: indoor-rated vs not, ventilation, canister storage and temperature, never stacking pots over the canister, and leak checks. `kinds: ["fuel_butane","stove"]`.
- `stove-propane`: 1 lb cylinders, connecting and leak testing, outdoor use. `kinds: ["fuel_propane"]`.
- `co-safety` (`emergency: true`): CO poisoning symptoms, what to do when an alarm sounds, and never using grills, generators or camp stoves indoors (CDC). Note that fuel stoves need a CO detector.

**Power**
- `generator-safety`: the 20-ft rule, never indoors or in a garage, backfeed danger, refueling cold (CDC/FEMA).
- `power-phone-battery`: keep phones alive: low-power mode, power banks, car charging safely, and Wh math in plain words. `kinds: ["power_bank","battery_pack","battery_cells","light"]`.

**Sanitation**
- `sanitation-toilet`: the two-bucket toilet (EPA/CDC/Ready.gov), lining, absorbents, disposal.
- `sanitation-hygiene`: handwashing without running water, sanitizer limits, dishes, and the bleach sanitizing ratio for surfaces (from a source).

**Hazards** (each with a short "before / during / after" structure, using Ready.gov, NWS and VDEM)
- `hazard-power-outage`
- `hazard-boil-advisory` (`emergency: true`): what a boil-water advisory means and what to do. You may mention that Richmond-area utilities issued one in January 2025, but don't invent details.
- `hazard-hurricane`, `hazard-winter-storm`, `hazard-extreme-heat`, `hazard-tornado`
- `hazard-nuclear`: shelter in place ("get inside, stay inside, stay tuned"). KI: who it's for, timing, and that it only protects the thyroid (CDC/FDA). Reference North Anna and Surry by name; the distances are in `data/local.json`.
- `hazard-evacuation`: when to leave, go-bag basics, and the T1D go-kit pointer (link by naming "see the T1D go-kit guide").

### Agent B: Type 1 diabetes and first aid (21 guides, all `medical: true`)
**T1D**
- `t1d-hypo` (`emergency: true`): signs of low blood sugar; the 15-15 rule, with numbers from ADA/CDC; severe lows; when to use glucagon. `kinds: ["glucose_tabs"]`.
- `t1d-glucagon`: how to use each product type (nasal Baqsimi, Gvoke autoinjector/syringe, Zegalogue, traditional mix kit), from each label; what to do afterwards; storage. `kinds: ["glucagon"]`.
- `t1d-sick-days-ketones` (`emergency: true`): sick-day rules, ketone testing and what the readings mean (from a source), DKA warning signs, and when to go to the ER. `kinds: ["ketone_strips"]`.
- `t1d-insulin-storage`: unopened vs in-use, the temperature limits from FDA and the manufacturers, signs insulin is damaged, freezing ruins it, keeping it cool with no power (Frio-type evaporative pouches, cool spots), heat in cars. `kinds: ["insulin"]`.
- `t1d-pump-failure`: what to do first, why long-acting insulin is needed within hours, and the `t1dplan` block. Give the general approach only as published by the pump makers, ADA or major diabetes centers. **Don't calculate doses.** Cover Omnipod and Tandem specifics if their user guides cover pump failure. `kinds: ["pump_site","reservoir","pen_needles","syringes"]`.
- `t1d-cgm-failure`: fingerstick backup, how often to check, and sensor warm-up and errors (Dexcom/Abbott). `kinds: ["cgm_sensor","test_strips","lancets"]`.
- `t1d-go-kit` (checklist): what goes in a T1D go-kit (from ADA/Breakthrough T1D emergency-preparedness lists).
- `t1d-emergency-supply`: getting more insulin and supplies in a disaster: emergency refills, Virginia pharmacist emergency-refill rules (research VA law and cite it; if you can't confirm it, omit it), Insulin for Life / ADA disaster hotline (verify the numbers). Plus prescriptions to keep copies of.

**First aid**
- `firstaid-bleeding` (`emergency: true`): Stop the Bleed: pressure, packing, tourniquet placement (ACS). `kinds: ["tourniquet","first_aid_kit"]`.
- `firstaid-cpr` (`emergency: true`): hands-only CPR for adults (AHA) and when to use an AED. Say clearly that training matters.
- `firstaid-choking` (`emergency: true`): adult/child abdominal thrusts, and infant back blows plus chest thrusts (Red Cross/AHA).
- `firstaid-allergic` (`emergency: true`): anaphylaxis signs and epinephrine auto-injector use, from the labels.
- `firstaid-burns`, `firstaid-wounds` (cleaning, closing, infection signs, tetanus), `firstaid-heat-illness`, `firstaid-cold` (hypothermia, frostbite), `firstaid-shock`, `firstaid-fractures-sprains`.
- `firstaid-dehydration`: signs, plus the oral rehydration solution recipe from WHO/CDC, with exact amounts from the source.
- `firstaid-otc-meds`: an **adult** table built **only from DailyMed / FDA label text**, for acetaminophen, ibuprofen, naproxen, diphenhydramine, loperamide, loratadine and cetirizine: dose, interval, max per day, key warnings. Interactions relevant to diabetes (e.g. NSAIDs and kidneys) only if a source says so. Children: "follow the package dosing by weight/age, or call poison control". No child doses. `kinds: ["med"]`.
- `firstaid-kit-checklist` (checklist, Red Cross): what a home first-aid kit should contain. `kinds: ["first_aid_kit"]`.

## Rules for both agents
- Write **only** your own files in `data/guides/`. Don't touch any other file. Another agent is building the app at the same time.
- Validate every file with `python3 -m json.tool`. Then run this check, which must pass: every guide has `id` matching its filename, a valid `category`, `sources.length >= 1`, and `blocks.length >= 3`.
```bash
python3 -c "import json,glob,sys; bad=[f for f in glob.glob('data/guides/*.json') if (lambda g: g['id']!=f.split('/')[-1][:-5] or g['category'] not in 'water food cooking power sanitation hazards t1d firstaid'.split() or len(g['sources'])<1 or len(g['blocks'])<3)(json.load(open(f)))]; print(bad); sys.exit(bool(bad))"
```
- No web forms, sign-ups or logins. If a site blocks you, use another authoritative source and record what you used.
- **Report:** the guides written, any required id you skipped and why, any number you left out because you couldn't verify it, and sources that blocked you.
