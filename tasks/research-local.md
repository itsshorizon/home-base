# Research task: verified local data for Henrico County, VA

Read `CLAUDE.md` invariant #4 first. **Nothing in these files may come from memory.** Every record needs a `source` (a URL you actually opened during this task) and `checkedAt: "2026-10-31"`. If you can't confirm something from a source you opened, leave it out of the main list and put it in `unverified: [{ claim, why }]` instead. Accuracy beats completeness: a wrong frequency or phone number in an emergency is worse than a missing one.

**Output:** two JSON files, `home-base/data/comms.json` and `home-base/data/local.json`, plus a short report. Touch no other files.

Preferred sources: RepeaterBook (repeaterbook.com), RadioReference (radioreference.com), myGMRS (mygmrs.com), NOAA/NWS (weather.gov), FCC (fcc.gov / ecfr.gov), henrico.gov, vaemergency.gov (VDEM), ARRL (arrl.org), meshtastic.org, and local club websites. If a site blocks fetching, try its search-results snippets or another reputable source, and record what you used.

## `data/comms.json`
```json
{
  "checkedAt": "2026-10-31",
  "noaaWeatherRadio": [ { "callsign", "freqMHz", "transmitterLocation", "sameCode": "Henrico SAME code", "notes", "source", "checkedAt" } ],
  "broadcastEAS": [ { "call", "freq", "band": "AM|FM", "role": "LP-1|LP-2|news|other", "notes", "source", "checkedAt" } ],
  "hamRepeaters": [ { "callsign", "outputMHz", "inputMHz", "offset": "+|-", "toneHz": null, "dcs": null, "mode": "FM|DMR|D-STAR|Fusion|P25", "location", "sponsor", "linkedTo", "notes", "source", "checkedAt" } ],
  "hamNets": [ { "name", "schedule", "freqMHz", "repeater", "purpose", "source", "checkedAt" } ],
  "hamOrganizations": [ { "name", "type": "ARES|RACES|club|CERT", "area", "url", "notes", "source", "checkedAt" } ],
  "simplexStandards": [ { "freqMHz", "band", "use", "source" } ],
  "frsGmrsChannels": [ { "channel", "freqMHz", "frsWatts", "gmrsWatts", "notes" } ],
  "murs": [ { "channel", "freqMHz", "notes" } ],
  "gmrsRepeaters": [ { "name", "outputMHz", "inputMHz", "toneHz", "location", "openToPublic": true, "notes", "source", "checkedAt" } ],
  "publicSafety": [ { "agency", "system", "type": "e.g. P25 Phase II trunked", "encrypted": "yes|no|partial|unknown", "monitorable": "notes on whether a scanner can follow it", "source", "checkedAt" } ],
  "meshtastic": { "region": "US", "band": "902–928 MHz", "defaultPreset": "LongFast", "communities": [ { "name", "url", "area", "notes", "source", "checkedAt" } ] },
  "fccRules": [ { "rule": "47 CFR 97.403", "summary": "your own short paraphrase", "source" } ],
  "unverified": []
}
```

**Scope:**
- **NOAA Weather Radio:** the transmitter(s) covering Henrico County, with frequency and callsign, and Henrico's SAME/FIPS code.
- **EAS:** the Richmond-area LP-1/LP-2 stations from Virginia's EAS plan, plus major news/talk stations.
- **Ham:** about 20 open 2 m and 70 cm FM repeaters within roughly 25 miles of Henrico (Richmond, Henrico, Chesterfield, Hanover, Goochland). Prefer ARES/RACES-affiliated repeaters and wide-coverage machines. Include any regularly scheduled nets (especially ARES/emergency and new-ham-friendly nets) and Henrico/Richmond ARES and RACES contacts.
- **Simplex standards:** national calling frequencies (2 m, 70 cm, 6 m, 1.25 m), sourced from the ARRL band plan.
- **FRS/GMRS:** the full 22-channel table with power limits, from FCC Part 95 (cite ecfr.gov), plus the 5 MURS channels.
- **GMRS repeaters:** in the Richmond area, from myGMRS (where publicly listed).
- **Public safety:** Henrico County's radio system (Police/Fire/EMS), whether it's encrypted, and the Virginia STARS state system, from RadioReference.
- **Meshtastic:** any active Richmond or central Virginia Meshtastic community or mesh groups.

## `data/local.json`
```json
{
  "checkedAt": "2026-10-31",
  "emergencyContacts": [ { "name", "phone", "purpose", "url", "source", "checkedAt" } ],
  "shelters": [ { "name", "address", "lat", "lon", "type": "general|pet-friendly|medical-needs", "notes", "source", "checkedAt" } ],
  "nuclearPlants": [ { "name", "operator", "lat", "lon", "epzMiles": 10, "ingestionZoneMiles": 50, "approxMilesFromHenricoCenter", "notes", "source", "checkedAt" } ],
  "potassiumIodide": { "summary", "virginiaDistribution", "source", "checkedAt" },
  "waterUtility": { "provider", "sourceWater", "treatmentPlant", "boilAdvisoryInfo", "notes", "source", "checkedAt" },
  "hazards": [ { "hazard", "localNotes", "source", "checkedAt" } ],
  "alerts": [ { "name": "e.g. Henrico alert sign-up system", "url", "source", "checkedAt" } ],
  "unverified": []
}
```

**Scope:**
- **Emergency contacts:** Henrico Emergency Management, Police and Fire non-emergency lines, Henrico Dept. of Public Utilities (water), Dominion Energy outage line, VDEM, Poison Control, 211 Virginia, and the nearest major hospitals' main lines (VCU Medical Center, Henrico Doctors', St. Mary's, Parham Doctors', Bon Secours Memorial Regional).
- **Shelters:** Henrico's designated emergency shelters and any pet-friendly shelter, if published. Geocode coordinates only from a source you opened. If there are no coordinates, set lat/lon to null and say so in notes.
- **Nuclear plants:** North Anna and Surry. Include their coordinates, and the 10-mile EPZ and 50-mile ingestion pathway zone facts. Note whether Henrico falls inside the 50-mile zones.
- **Potassium iodide (KI):** VDH's distribution program and who is eligible.
- **Water:** Henrico's water source and treatment plant, and what happened to Henrico customers during the January 2025 Richmond water outage.
- **Hazards:** hurricanes and tropical floods, ice storms, tornadoes, extreme heat, and James River flooding, each with a local note.
- **Alerts:** Henrico's emergency alert sign-up system.

## Report back
- Counts per section.
- The sources that blocked you.
- Everything placed in `unverified`.
- Anything surprising, e.g. Henrico public safety being fully encrypted, or a repeater that has gone off-air.
