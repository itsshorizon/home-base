# Home Base — survival inventory & reference PWA

Offline-first Progressive Web App for one household in Henrico County, VA (one member has Type 1 diabetes).
Built on a Mac, hosted on GitHub Pages, installed to one phone's home screen, used mostly **without internet**.
The owner (Austin) is new to coding: explain changes plainly, and say *why* as well as *what*.

Full product plan: `/Users/austin/.claude/plans/i-want-to-create-precious-lobster.md`. Phase specs live in `tasks/`.

## Invariants (do not break)
1. **Offline is the normal case.** Every file the app needs is precached by `sw.js`. No runtime CDN, no web fonts from Google, no remote images. Third-party libraries are vendored into `vendor/` with an exact version in the filename or a comment.
2. **Household data never leaves the device.** It lives in IndexedDB (`js/db.js`). The only network calls allowed are ones the user starts: the Anthropic API (photo ID, Phase 2), Open Food Facts (barcode, Phase 2), and the `version.json` update check. No analytics.
3. **`js/runway.js` is pure.** No DOM, no IndexedDB, no `Date.now()` inside: `now` is passed in. It must import cleanly in Node, and `node --test` must pass.
4. **Never write a radio frequency, repeater, phone number, shelter or address from memory.** Local facts come only from `data/comms.json` / `data/local.json`. Every entry there has a `source` URL and a `checkedAt` date. Unverified facts go in an `unverified` list, not the UI.
5. **Medical and safety content cites its source** (EPA, CDC, ADA, FEMA, Red Cross, manufacturer) and shows the disclaimer component.
6. **Mobile first.** Design for a 375px-wide phone, with large tap targets (at least 44px). Respect `env(safe-area-inset-*)`. It must also be usable in bright sunlight: high contrast, dark theme.
7. **Vanilla JS ES modules, no build step, no npm runtime dependencies.** `package.json` exists only for `"type": "module"` and the test script.

## Release checklist
When shipping a change, bump the same version string in **three** places:
- `CACHE_NAME` in `sw.js`
- `BUILD_ID` in `js/app.js`
- `version.json`

Also add any new file to `PRECACHE` in `sw.js`, or it will be missing offline.

## Run / test
- Dev server: `python3 -m http.server 8790` from this folder (or the `home-base` entry in `.claude/launch.json`).
- Tests: `node --test`
- Offline check: load the app once, stop the server, reload. Everything must still work.
