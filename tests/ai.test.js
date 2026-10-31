import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildRequest, buildHeaders, buildPrompt, parseResponse, resizePlan, RESULT_SCHEMA, OPUS, HAIKU, API_VERSION,
  queueAction, failureState, backoffMs, describeRecord, MAX_TRIES, buildKeyTestRequest, KEY_TEST_URL,
} from '../js/ai.js';
import { KINDS, CATEGORIES } from '../js/categories.js';
import { DEFAULT_SETTINGS } from '../js/runway.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('1. buildRequest (Opus): fallbacks, effort low, json_schema, no sampling keys, image before text', () => {
  const req = buildRequest({ base64: 'AAAA', mediaType: 'image/jpeg', model: OPUS, kinds: KINDS });
  assert.equal(req.model, OPUS);
  assert.equal(req.fallbacks, 'default');
  assert.equal(req.output_config.effort, 'low');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.output_config.format.schema, RESULT_SCHEMA);
  for (const key of ['temperature', 'top_p', 'top_k', 'thinking']) assert.ok(!(key in req), `${key} must not be sent`);
  const content = req.messages[0].content;
  assert.equal(content[0].type, 'image');
  assert.equal(content[0].source.media_type, 'image/jpeg');
  assert.equal(content[0].source.data, 'AAAA');
  assert.equal(content[1].type, 'text');
  assert.equal(req.system, buildPrompt(KINDS));
});

test('2. buildRequest (Haiku) has no fallbacks and still no sampling keys', () => {
  const req = buildRequest({ base64: 'AAAA', model: HAIKU });
  assert.ok(!('fallbacks' in req));
  for (const key of ['temperature', 'top_p', 'top_k', 'thinking']) assert.ok(!(key in req));
});

function walkObjects(schema, visit, path = 'root') {
  if (!schema || typeof schema !== 'object') return;
  const types = [].concat(schema.type || []);
  if (types.includes('object')) visit(schema, path);
  for (const [k, v] of Object.entries(schema.properties || {})) walkObjects(v, visit, `${path}.${k}`);
  if (schema.items) walkObjects(schema.items, visit, `${path}[]`);
  for (const alt of schema.anyOf || []) walkObjects(alt, visit, `${path}|`);
}

test('3. RESULT_SCHEMA: strict objects, required = all keys, kind enum = KINDS', () => {
  let objects = 0;
  walkObjects(RESULT_SCHEMA, (s, path) => {
    objects++;
    assert.equal(s.additionalProperties, false, `${path} additionalProperties`);
    assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), `${path} required`);
  });
  assert.equal(objects, 3, 'root, item and perUnit');
  const item = RESULT_SCHEMA.properties.items.items;
  assert.deepEqual(item.properties.kind.enum, Object.keys(KINDS));
  assert.deepEqual(item.properties.category.enum, CATEGORIES.map((c) => c.key));
  assert.equal(Object.keys(item.properties.perUnit.properties).length, 8);
  assert.doesNotThrow(() => JSON.stringify(RESULT_SCHEMA));
});

test('4. buildPrompt is deterministic and mentions every kind key', () => {
  const a = buildPrompt(KINDS);
  assert.equal(a, buildPrompt(KINDS));
  for (const key of Object.keys(KINDS)) assert.ok(a.includes(`- ${key}:`), `missing kind ${key}`);
  assert.ok(!/\b20\d\d-\d\d-\d\d\b/.test(a), 'no dates in the prompt');
});

test('5a. parseResponse: success with 2 items drops nulls and normalizes qty/names', () => {
  const r = parseResponse(200, fixture('ai-success-two-items.json'));
  assert.equal(r.ok, true);
  assert.equal(r.servedByFallback, false);
  assert.equal(r.model, 'claude-opus-5-5');
  assert.equal(r.items.length, 2);
  const [beans, pen] = r.items;
  assert.equal(beans.name, "Bush's Black Beans");
  assert.equal(beans.qty, 1, 'qty 0 becomes 1');
  assert.deepEqual(beans.perUnit, { kcal: 350, protein_g: 21 });
  assert.equal(beans.expires, '2028-03-31');
  assert.equal(pen.kind, 'insulin');
  assert.equal(pen.qty, 3);
  assert.deepEqual(pen.perUnit, { insulin_units: 300 });
  assert.equal(pen.insulinType, 'humalog');
  assert.equal(pen.shelfLifeMonths, 24);
  assert.equal(pen.brand, null);
});

test('5b. parseResponse: refusal and max_tokens', () => {
  const ref = parseResponse(200, fixture('ai-refusal.json'));
  assert.deepEqual([ref.ok, ref.retry, ref.error], [false, false, "Claude couldn't identify this photo."]);
  const max = parseResponse(200, fixture('ai-max-tokens.json'));
  assert.deepEqual([max.ok, max.retry, max.error], [false, false, 'Too many items in one photo. Try fewer at a time.']);
});

test('5c. parseResponse: HTTP errors', () => {
  const auth = parseResponse(401, fixture('ai-error-401.json'));
  assert.deepEqual([auth.ok, auth.retry, auth.code], [false, false, 'auth']);
  assert.equal(auth.error, 'Your API key was rejected. Check it in Settings.');
  assert.equal(parseResponse(403, null).code, 'auth');
  const busy = parseResponse(529, fixture('ai-error-529.json'));
  assert.deepEqual([busy.ok, busy.retry], [false, true]);
  for (const s of [429, 500, 502, 503]) assert.equal(parseResponse(s, null).retry, true, String(s));
  const bad = parseResponse(400, fixture('ai-error-400.json'));
  assert.deepEqual([bad.ok, bad.retry, bad.code], [false, false, 'bad_request']);
  assert.ok(bad.error.includes('output_config.format.schema: unsupported keyword'));
  assert.equal(parseResponse(404, null).retry, false);
});

test('5d. parseResponse: non-JSON text is a failure, not a crash', () => {
  const r = parseResponse(200, fixture('ai-not-json.json'));
  assert.deepEqual([r.ok, r.retry, r.code], [false, false, 'parse']);
  assert.equal(parseResponse(200, null).ok, false);
  assert.equal(parseResponse(200, {}).ok, false);
});

test('5e. parseResponse: fallback_message in usage.iterations sets servedByFallback', () => {
  const r = parseResponse(200, fixture('ai-fallback.json'));
  assert.equal(r.ok, true);
  assert.equal(r.servedByFallback, true);
  assert.equal(r.unreadable, true);
  assert.deepEqual(r.items, []);
  assert.equal(r.message, 'Photo is blurry, retake closer to the label');
});

test('5f. parseResponse: unknown kinds fall back to <category>_other', () => {
  const body = { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ items: [{ name: 'Thing', kind: 'nope', category: 'tools', qty: 2 }], unreadable: false, message: null }) }] };
  const r = parseResponse(200, body);
  assert.equal(r.items[0].kind, 'tools_other');
  assert.equal(r.items[0].category, 'tools');
  assert.equal(r.items[0].qty, 2);
});

test('6. buildHeaders: beta header only for Opus 5.5; browser-access header always', () => {
  const opus = buildHeaders('sk-ant-x', OPUS);
  assert.equal(opus['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(opus['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(opus['anthropic-version'], API_VERSION);
  assert.equal(opus['x-api-key'], 'sk-ant-x');
  const haiku = buildHeaders('sk-ant-x', HAIKU);
  assert.ok(!('anthropic-beta' in haiku));
  assert.equal(haiku['anthropic-dangerous-direct-browser-access'], 'true');
  const test = buildHeaders('sk-ant-x');
  assert.ok(!('anthropic-beta' in test));
});

test('7. resizePlan: long edge capped at 1568, never enlarged', () => {
  assert.deepEqual(resizePlan(4032, 3024), { width: 1568, height: 1176, scale: 1568 / 4032 });
  assert.equal(resizePlan(3024, 4032).height, 1568);
  assert.deepEqual(resizePlan(800, 600), { width: 800, height: 600, scale: 1 });
});

test('8. queue rules: offline / no key / backoff / retries', () => {
  const NOW = 1_000_000;
  const photo = (o = {}) => ({ type: 'photo', status: 'pending', tries: 0, nextTryAt: 0, ...o });
  const barcode = (o = {}) => ({ type: 'barcode', status: 'pending', tries: 0, nextTryAt: 0, ...o });
  const on = { online: true, hasKey: true, now: NOW };
  assert.equal(queueAction(photo(), on), 'process');
  assert.equal(queueAction(photo(), { ...on, online: false }), 'wait-offline');
  assert.equal(queueAction(photo(), { ...on, hasKey: false }), 'wait-key');
  assert.equal(queueAction(barcode(), { ...on, hasKey: false }), 'process', 'barcodes need no key');
  assert.equal(queueAction(barcode(), { ...on, online: false }), 'wait-offline');
  assert.equal(queueAction(photo({ nextTryAt: NOW + 1 }), on), 'wait-retry');
  assert.equal(queueAction(photo({ nextTryAt: NOW }), on), 'process');
  assert.equal(queueAction(photo({ status: 'ready' }), on), 'none');
  // backoff 1 min, 5 min, 30 min, then error on the 4th failure
  assert.deepEqual([1, 2, 3].map(backoffMs), [60_000, 300_000, 1_800_000]);
  let rec = photo();
  for (const [i, wait] of [[1, 60_000], [2, 300_000], [3, 1_800_000]]) {
    const f = failureState(rec, { retry: true, error: 'busy', now: NOW });
    assert.deepEqual([f.status, f.tries, f.nextTryAt], ['pending', i, NOW + wait]);
    rec = { ...rec, ...f };
  }
  const last = failureState(rec, { retry: true, error: 'busy', now: NOW });
  assert.deepEqual([last.status, last.tries], ['error', MAX_TRIES]);
  assert.equal(failureState(photo(), { retry: false, error: 'nope', now: NOW }).status, 'error');
  // labels for the review list
  assert.equal(describeRecord(photo(), { ...on, online: false }).label, 'Waiting for internet');
  assert.match(describeRecord(photo(), { ...on, hasKey: false }).label, /Add your API key in Settings/);
  assert.equal(describeRecord(photo({ status: 'processing' }), on).label, 'Identifying…');
  assert.equal(describeRecord(photo({ status: 'error', error: 'Bad key' }), on).label, 'Bad key');
});

test('9. aiModel defaults to claude-opus-5-5 in DEFAULT_SETTINGS', () => {
  assert.equal(DEFAULT_SETTINGS.aiModel, OPUS);
});

test('10. key test uses the free count_tokens endpoint with no beta header and no sampling keys', () => {
  assert.equal(KEY_TEST_URL, 'https://api.anthropic.com/v1/messages/count_tokens');
  const req = buildKeyTestRequest(OPUS);
  assert.deepEqual(Object.keys(req).sort(), ['messages', 'model']);
  assert.ok(!('anthropic-beta' in buildHeaders('sk-ant-x')));
});
