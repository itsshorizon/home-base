# Phase 2: Photo identification (Claude vision), barcode scanning, offline queue

Read `CLAUDE.md` first. Phase 1 is in place: `js/db.js`, `js/categories.js` (`KINDS`, `CATEGORIES`, `ROOM_TEMP_DAYS`), `js/views/add.js` (the form), and the 0.1.1 service worker.

**Goal.** Austin points his phone at supplies and the app fills in the inventory for him:
- **Photo:** Claude identifies every product in the picture: name, count, nutrition per container, printed expiry date, and kind.
- **Barcode:** looks the product up in Open Food Facts.

With no internet, photos and barcodes are **queued** and processed automatically once the phone is back online. Nothing is ever saved to the inventory without the user reviewing it first.

## Files
```
js/ai.js              PURE: buildPrompt(), buildRequest(), parseResponse(), resizePlan(): no DOM, Node-importable
js/off.js             PURE: offUrl(code), mapOffProduct(json): Node-importable
js/image.js           browser: fileToJpeg(file, maxEdge) → {blob, base64, width, height}; thumbnail(blob, 400)
js/queue.js           browser: enqueuePhoto, enqueueBarcode, processQueue, queue counts, 'hb:queue' events
js/scanner.js         browser: startScanner(videoContainer, onCode) / stopScanner(); BarcodeDetector first, vendored lib fallback
js/views/review.js    #/review and #/review/<queueId>: review AI/barcode results and save them
vendor/html5-qrcode-2.3.8.min.js   vendored (see Barcode)
tests/ai.test.js, tests/off.test.js, tests/fixtures/*.json
```
Changes to existing files:
- **`add.js`:** enable the Photo and Barcode buttons, and add a "Photos to review (n)" banner.
- **`app.js`:**
  - add the review routes
  - show a queue badge on the Add tab
  - run `processQueue()` on boot and on the `online` event
- **`settings.js`:** add the AI settings.
- **`sw.js`:** add PRECACHE entries.
- **`db.js`:** the item gains optional `barcode` and `brand` fields. No schema version bump is needed.

## Claude API call (`js/ai.js`)
Use raw `fetch` (CLAUDE.md invariant 7 rules out npm and bundlers, so the SDK isn't an option).
- Endpoint: `POST https://api.anthropic.com/v1/messages`
- Headers:
```
content-type: application/json
x-api-key: <settings.apiKey>
anthropic-version: 2026-10-21
anthropic-dangerous-direct-browser-access: true     // required for calls straight from a browser (CORS)
anthropic-beta: server-side-fallback-2026-07-01     // ONLY when model is claude-opus-5-5 (goes with fallbacks)
```
- Body from `buildRequest({ base64, mediaType: 'image/jpeg', model, kinds })`:
```js
{
  model,                                   // settings.aiModel, default 'claude-opus-5-5'
  max_tokens: 4000,
  output_config: { effort: 'low', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
  ...(model === 'claude-opus-5-5' ? { fallbacks: 'default' } : {}),
  system: buildPrompt(kinds),
  messages: [{ role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
    { type: 'text', text: 'Identify every supply item in this photo for our inventory.' },
  ]}],
}
```
**Rules for the request:**
- Do **not** send `thinking`, `temperature`, `top_p` or `top_k`. Sampling parameters are a 400 on API version 2026-10-21. Thinking is adaptive by default; effort `low` keeps it cheap.
- Model choices in Settings:
  - `claude-opus-5-5`: "Most accurate · about 2¢ per photo". This is the **default**.
  - `claude-haiku-5-5`: "Cheapest · well under 1¢ per photo".

**`RESULT_SCHEMA`** (export it):
- Every object has `additionalProperties: false`, and every property is listed in `required`. Use `{"type": ["number","null"]}` for optional numbers and `["string","null"]` for optional strings. If the API rejects the type-array form, switch to `anyOf: [{type:'number'},{type:'null'}]` and record that in your report.
- Shape:
```
{ items: [ {
    name: string,                 // "Bush's Black Beans"
    brand: string|null,
    packageSize: string|null,     // "15 oz can", "24 x 16.9 fl oz", "8 oz canister"
    category: enum CATEGORIES keys,
    kind: enum KINDS keys,        // build the enum from Object.keys(KINDS)
    qty: number,                  // how many identical units are visible (≥1)
    unit: string,                 // 'can','jar','bag','case','bottle','box','canister','pack','vial','pen','each'
    storage: enum 'pantry'|'fridge'|'freezer'|'other',
    perUnit: { kcal, protein_g, water_gal, treat_gal, fuel_hours, insulin_units, count, wh }  // each number|null, for ONE unit (the whole container)
    nutritionSource: enum 'label'|'estimated'|'none',
    insulinType: enum ROOM_TEMP_DAYS keys | null,
    expires: string|null,         // YYYY-MM-DD, only if a date is printed and legible
    shelfLifeMonths: number|null, // typical unopened shelf life, for when no date is visible
    confidence: enum 'high'|'medium'|'low',
    instructions: string|null,    // short how-to for non-food gear (filters, stoves, bleach, med dosing as printed)
    notes: string|null
} ],
  unreadable: boolean,            // true if the photo is too blurry or dark to identify anything
  message: string|null }          // e.g. "Photo is blurry, retake closer to the label"
```

**`buildPrompt(kinds)`** returns a stable system prompt (no dates or random values in it). Say it plainly:
- You're helping a household in Virginia keep an emergency-supply inventory (food, water, medical, Type 1 diabetes supplies, fuel, gear).
- List every **distinct** product. Identical units are one entry with `qty`.
- `perUnit` covers one whole container:
  - **Food:** kcal and protein for the whole package. Calories per serving × servings per container from the nutrition label if it's readable (`nutritionSource: 'label'`); otherwise typical USDA values (`'estimated'`).
  - **Water:** `water_gal` per unit. A case of 24 × 16.9 fl oz with unit 'case' is 3.17.
  - **Fuel:** butane 8 oz ≈ 1.5 h; 1 lb propane ≈ 2 h on high.
  - **Countables** (test strips, sensors, pods, pills/doses, toilet-paper rolls): `count` per box or pack, from the label.
  - **Insulin:** `insulin_units` per vial (usually 1000) or pen (usually 300), plus `insulinType`.
- Pick `kind` from the list. Include each kind key with its label, generated from `kinds`. If nothing fits, use `<category>_other`.
- `expires` only when a date is printed and you can read it. A month-only date ("MAR 2027") means the last day of that month. Never guess a date. Use `shelfLifeMonths` instead.
- Never invent a medication dose. Copy dosing instructions only as printed.
- If the photo is unusable, return `items: []`, `unreadable: true` and a helpful `message`.

**`parseResponse(httpStatus, json)`** returns `{ ok: true, items, message, model, servedByFallback }` or `{ ok: false, retry: boolean, error: 'human sentence', code }`:
| Response | Result |
|---|---|
| 200 with `stop_reason` `refusal` | `ok: false`, `retry: false`, error "Claude couldn't identify this photo." |
| 200 with `stop_reason` `max_tokens` | `ok: false`, `retry: false`, error "Too many items in one photo. Try fewer at a time." |
| 200, other stop reason | Find the first `type: 'text'` block and `JSON.parse` it. On a parse failure: `ok: false`, `retry: false`. |
| `servedByFallback` | `true` if `usage.iterations` has an entry with type `'fallback_message'` |
| 401 / 403 | `retry: false`, code 'auth', error "Your API key was rejected. Check it in Settings." |
| 400 | `retry: false`; include `json.error.message` |
| 429, 500, 529, other 5xx | `retry: true` |

`items` are normalized: qty is at least 1, `perUnit` drops nulls, and names are trimmed.

## Image handling (`js/image.js`)
- Load the file with `createImageBitmap(file, { imageOrientation: 'from-image' })`, falling back to an `<img>` element. Draw it on a canvas with the long edge at most **1568 px**. Export JPEG at quality 0.85 to get `{ blob, base64 }`, with base64 having no `data:` prefix.
- `thumbnail(blob, 400)`: JPEG at 0.75. Thumbnails go in the `blobs` store as `{ id, type: 'photo', blob, createdAt }`, and the item's `photoId` points to them. Item detail shows the thumbnail. Revoke object URLs on view `destroy()`.

## Queue (`js/queue.js`, using the `photoQueue` store)
Record:
```js
{ id, type: 'photo'|'barcode', createdAt, status: 'pending'|'processing'|'ready'|'error'|'done',
  tries: 0, imageBlobId /*photo: full 1568px JPEG in blobs*/, thumbId, barcode /*barcode type*/,
  result /*parsed items or mapped OFF product*/, error, nextTryAt }
```

- **Adding photos.** Every photo is enqueued first, then processed immediately when online. This gives one code path: the photo survives a crash or a closed app.
- **`processQueue()`**
  - It is a single-flight lock, so it never runs twice at once.
  - Skip everything when `!navigator.onLine` or there is no `apiKey`. Barcode items don't need a key.
  - Process `pending` records with `nextTryAt <= now` one at a time.
  - On success, set `ready`.
  - On `retry: true` or a network `TypeError`, increment `tries` and set `nextTryAt` with backoff of 1 min, 5 min, then 30 min. After 4 tries, set `error`.
  - On `retry: false`, set `error` with the message.
  - Dispatch `window` event `hb:queue` after each change.
- **When it runs:** app boot, `online` events, after each enqueue, and the "Retry" buttons.
- **Records that are `ready`** show up for review:
  - a badge with the count on the Add tab
  - a banner on Add, "📸 3 photos ready to review", linking to `#/review`
  - a dashboard nudge when the count is at least 1
- **Records in `error`** show the error message, with Retry (resets to pending, tries 0) and Delete buttons.
- **Records with no API key:** if a photo is queued and there's no key, show "Add your API key in Settings to identify photos". Keep the record pending.
- **Cleanup:** after the user saves or discards everything in a result, set the record to `done`, then delete it and its `imageBlobId` blob. Keep the thumbnail if any item was saved with it.

## Review screen (`js/views/review.js`)
- **`#/review`:** a list of queue records that aren't `done`, each with a thumbnail, status (Waiting for internet / Identifying… / Ready / Error) and created time. Actions: tap to review a Ready one; Retry and Delete for errors.
- **`#/review/<id>`:**
  - The photo at the top, which can be tapped to view full size.
  - Then one card per identified item, using the **same form component as Add**. Refactor `add.js` so the form can be mounted with initial values and an `onSave`. Do not duplicate the form.
  - Each card has:
    - a confidence badge
    - a "Nutrition estimated — check the label" note when `nutritionSource !== 'label'`
    - `expires` prefilled from `expires`, or else today + shelfLifeMonths with the hint "estimated"
    - Save, which writes the item (with `photoId` = thumbnail, `barcode`, `brand`), and Skip
  - **Duplicate check:** if an existing item has the same barcode, or the same name case-insensitively plus the same kind, show "You already have 6 of these — **Add 4 to existing** or Save as new".
  - When every card has been saved or skipped, run the cleanup above, show a toast "Saved 3 items", and go to `#/inventory`.

## Barcode (`js/scanner.js`, `js/off.js`)
- **Scanner:**
  - If `'BarcodeDetector' in window` and `getSupportedFormats()` includes `ean_13`, use it with `getUserMedia({ video: { facingMode: 'environment' } })`.
  - Otherwise use the vendored html5-qrcode. Download it with `curl -L -o vendor/html5-qrcode-2.3.8.min.js https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js` and load it with a classic `<script>` only when the scanner opens; add it to PRECACHE. Formats: EAN_13, EAN_8, UPC_A, UPC_E.
  - Show a full-screen overlay with the video, a framing box, a Cancel button, and a "Type the number" input as a fallback.
  - On a detection: vibrate if available, stop the camera, and continue.
- **After a scan (`onCode`):**
  1. **Local first, so it works offline:** if any item has `barcode === code`, show a sheet: "You have 6 × Bush's Black Beans" with **+1**, **+ how many…**, **−1 (used one)** and **Open item**.
  2. Otherwise enqueue a `barcode` record. When online, process it right away:
     - Fetch `offUrl(code)`, which is `https://world.openfoodfacts.org/api/v2/product/<code>.json?fields=product_name,brands,quantity,product_quantity,product_quantity_unit,serving_size,serving_quantity,nutriments,categories_tags,image_front_small_url`.
     - Map the result with `mapOffProduct`, then go straight to `#/review/<id>`.
     - When offline, show the toast "Saved — will look up when you're back online".
  3. **Not found** (`status === 0` or no product_name): mark the record `ready`, with an empty item that has the barcode prefilled and the message "Not in the food database. Take a photo or type it in." The review card shows a **Take photo instead** button.
- **`mapOffProduct(json)`** returns an item draft:
  - name = `product_name`, brand = the first of `brands`, packageSize = `quantity`
  - kind 'food', category 'food', unit 'each', `nutritionSource: 'label'`, qty 1
  - **kcal per package:**
    - if `product_quantity` is set and its unit is g or ml (or missing): `nutriments['energy-kcal_100g'] × product_quantity / 100`
    - else if `serving_quantity` and `energy-kcal_serving` are set: the serving value (and note "per serving — set the count")
    - else null
  - protein uses the same rule with `proteins_100g` / `proteins_serving`.
  - Round kcal to a whole number and protein to 1 decimal.
  - The image URL is not stored. Images are not cached, so they wouldn't work offline.
- Off-origin requests are not intercepted by the service worker. That is already true; keep it.

## Add screen
- **Photo:** two buttons.
  - **📷 Take photo**: `<input type=file accept="image/*" capture="environment">`
  - **🖼️ Choose photos**: `accept="image/*" multiple`, no capture. Each photo becomes its own queue record.
  - After picking a photo, show an inline "Identifying…" state with a spinner, then route to the review screen.
  - Offline: toast "Saved — will identify when you're back online (n waiting)".
- **Barcode:** opens the scanner.
- Under the buttons, a muted line: "Photos are sent to Anthropic to identify them, using your key. About 2¢ each." Show the price for the selected model. If there's no key, the Photo button opens a sheet that explains and links to Settings. Barcode still works without a key.

## Settings additions
- **Model select** (`settings.aiModel`), with the two options above.
- A **Test key** button that calls `GET https://api.anthropic.com/v1/models?limit=1` with the same headers (minus beta). It's free. Show "Key works ✓" or the error.
- A link: "Get a key: console.anthropic.com → API Keys. Add a few dollars of credit; ~200 photos ≈ $4 on the default model."
- Add `aiModel: 'claude-opus-5-5'` to `DEFAULT_SETTINGS` in `runway.js`.

## Tests
Run `node --test`; all Phase 1 tests must still pass.

**`tests/ai.test.js`**
1. `buildRequest` with Opus:
   - includes `fallbacks: 'default'`, effort 'low', and the json_schema format
   - has no `temperature`, `top_p`, `top_k` or `thinking` keys
   - the image block comes before the text block
2. `buildRequest` with Haiku has no `fallbacks`.
3. `RESULT_SCHEMA`:
   - every object has `additionalProperties: false`, with `required` equal to all keys (walk it recursively)
   - the kind enum equals `Object.keys(KINDS)`
4. `buildPrompt(KINDS)` is deterministic (identical on two calls) and mentions every kind key.
5. `parseResponse` cases, each against a fixture in `tests/fixtures/`:
   - success with 2 items: nulls dropped, qty normalized
   - refusal
   - max_tokens
   - 401 → code 'auth', retry false
   - 529 → retry true
   - 400 with an error message
   - non-JSON text → ok false
   - `usage.iterations` containing `fallback_message` → servedByFallback true
6. **Header helper:** export `buildHeaders(apiKey, model)`. It includes the beta header only for Opus 5.5 and always includes `anthropic-dangerous-direct-browser-access`.

**`tests/off.test.js`**
- Use a **real** OFF response saved with curl as a fixture. Pick a common US canned-food barcode whose OFF entry has `product_quantity` and `energy-kcal_100g`, and record the code in the fixture filename.
- Assert mapped kcal = round(kcal_100g × qty / 100).
- Also cover: a not-found fixture (`status: 0`), and a fixture with serving-only nutriments.

## Verification you must do
- `node --test` is green.
- **Browser pane at 375 px**, using the `home-base` launch config in `/Users/austin/Code/.claude/launch.json` (port 8790):
  - **Photo picker:** the "Choose photos" path works with a local test image. You can't use the camera in the pane, so use `DataTransfer` or set the input files via JS if needed.
  - **Queue with no key:** the record stays pending with the "Add your API key" message.
  - **CORS check:** set a bogus key `sk-ant-test-invalid` and run the photo through. The app must show "Your API key was rejected…". That proves CORS and the headers work end to end without spending money. Then use Test key with the bogus key and expect a clean error.
  - **Offline:** set `navigator.onLine` behaviour by stopping the network, or call the queue with a forced offline flag. Confirm the photo is queued, and confirm `processQueue` runs on the `online` event. If you can't simulate offline in the pane, unit-test the decision logic and say so.
  - **Barcode:** type a number into the fallback input. A real code shows the OFF review card with calories. Scanning the same code again after saving shows the "You have 1 × …" sheet with no network request (check network requests).
  - The review → save flow creates the item with a thumbnail, and the item detail shows the thumbnail.
- **Offline reload** after the version bump: precache count matches, and Add, Review and Settings all render with the server stopped.
- **Do not use a real Anthropic key.** None is available. Austin will do the live test.
- **Clean up** any test data you created in the pane's IndexedDB (`indexedDB.deleteDatabase('homebase')`), unregister the service worker, and stop the server.

## Release
- Bump the version to **0.2.0** in all three places.
- Add every new file to PRECACHE: the js files, the view, the vendor lib, and anything else new. Do not add test fixtures.
- No git commands. Don't touch `data/comms.json`, `data/local.json` or `tasks/` (other than reading).

## Report back
- files changed and created
- test output
- every verification step and its result
- spec deviations and why
- anything for Austin to test with his real key and phone
