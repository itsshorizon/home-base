// Photo identification with Claude vision. PURE: no DOM, no IndexedDB, no Date.now() (callers pass `now`).
// Node can import this file, so tests/ai.test.js can check the request and response handling.
import { CATEGORIES, KINDS, ROOM_TEMP_DAYS } from './categories.js';

export const API_URL = 'https://api.anthropic.com/v1/messages';
// "Test key" calls the free token-counting endpoint with a tiny message. The spec suggested GET /v1/models, but
// Anthropic does not send CORS headers on that endpoint, so a browser cannot read its answer. POST endpoints work.
export const KEY_TEST_URL = 'https://api.anthropic.com/v1/messages/count_tokens';
export const API_VERSION = '2026-10-21';
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
export const OPUS = 'claude-opus-5-5';
export const HAIKU = 'claude-haiku-5-5';
export const DEFAULT_MODEL = OPUS;
export const MAX_EDGE = 1568;

export const MODELS = [
  { id: OPUS, label: 'Claude Opus 5.5', blurb: 'Most accurate · about 2¢ per photo', cost: '2¢' },
  { id: HAIKU, label: 'Claude Haiku 5.5', blurb: 'Cheapest · well under 1¢ per photo', cost: 'under 1¢' },
];

export function modelCost(model) {
  return (MODELS.find((m) => m.id === model) || MODELS[0]).cost;
}

// ---------- result schema ----------
const PER_UNIT_FIELDS = ['kcal', 'protein_g', 'water_gal', 'treat_gal', 'fuel_hours', 'insulin_units', 'count', 'wh'];
// anyOf form: the API rejected an enum inside a type-array (`['string','null']`) schema.
const nullable = (schema) => ({ anyOf: [typeof schema === 'string' ? { type: schema } : schema, { type: 'null' }] });

function objectSchema(properties) {
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
}

const ITEM_SCHEMA = objectSchema({
  name: { type: 'string' },
  brand: nullable('string'),
  packageSize: nullable('string'),
  category: { type: 'string', enum: CATEGORIES.map((c) => c.key) },
  kind: { type: 'string', enum: Object.keys(KINDS) },
  qty: { type: 'number' },
  unit: { type: 'string' },
  storage: { type: 'string', enum: ['pantry', 'fridge', 'freezer', 'other'] },
  perUnit: objectSchema(Object.fromEntries(PER_UNIT_FIELDS.map((f) => [f, nullable('number')]))),
  nutritionSource: { type: 'string', enum: ['label', 'estimated', 'none'] },
  insulinType: nullable({ type: 'string', enum: Object.keys(ROOM_TEMP_DAYS) }),
  expires: nullable('string'),
  shelfLifeMonths: nullable('number'),
  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  instructions: nullable('string'),
  notes: nullable('string'),
});

export const RESULT_SCHEMA = objectSchema({
  items: { type: 'array', items: ITEM_SCHEMA },
  unreadable: { type: 'boolean' },
  message: nullable('string'),
});

// ---------- prompt ----------
// Stable on purpose: no dates, no random values. (A stable prefix is also cache-friendly.)
export function buildPrompt(kinds = KINDS) {
  const kindLines = Object.entries(kinds).map(([key, k]) => {
    const count = k.countNoun ? `; \`count\` = ${k.countNoun} per package` : '';
    return `- ${key}: ${k.label} (category ${k.category}, default unit ${k.unit}${count})`;
  });
  return [
    'You are helping a household in Virginia keep an emergency-supply inventory: food, water, medical supplies, Type 1 diabetes supplies, fuel and gear.',
    'You will be shown one photo. Identify what is in it so the household can add it to their inventory.',
    '',
    'Rules:',
    '- List every DISTINCT product you can see. Identical units are ONE entry with `qty` set to how many you can count (at least 1).',
    '- `perUnit` describes ONE whole container (one can, one box, one case), never a single serving:',
    '  - Food: `kcal` and `protein_g` for the whole package. Use calories per serving x servings per container from the Nutrition Facts label when it is readable and set `nutritionSource` to "label". Otherwise use typical USDA values and set `nutritionSource` to "estimated". Set it to "none" when nutrition does not apply (gear, medicine).',
    '  - Water: `water_gal` per unit. A case of 24 x 16.9 fl oz with unit "case" is 3.17.',
    '  - Fuel: an 8 oz butane canister is about 1.5 hours; a 1 lb propane cylinder is about 2 hours on high. Put it in `fuel_hours`.',
    '  - Countables (test strips, sensors, pods, pills or doses, toilet-paper rolls, batteries): `count` per box or pack, read from the label.',
    '  - Insulin: `insulin_units` per vial (usually 1000) or pen (usually 300), plus `insulinType`.',
    '  - Use null for any number that does not apply or that you cannot determine.',
    '- Pick `kind` from the list below, and set `category` to that kind\'s category. If nothing fits, use `<category>_other`.',
    '- `expires`: only when a date is printed AND you can read it, as YYYY-MM-DD. A month-only date such as "MAR 2027" means the last day of that month. Never guess a date. When no date is visible, leave `expires` null and give the typical unopened shelf life in `shelfLifeMonths`.',
    '- Never invent a medication dose. Copy dosing instructions only as they are printed on the package.',
    '- `instructions`: a short how-to for non-food gear (filters, stoves, bleach) or dosing exactly as printed. Otherwise null.',
    '- `confidence` is how sure you are of the identification. Use "low" when you are guessing.',
    '- If the photo is too blurry, dark or empty to identify anything, return `items: []`, `unreadable: true`, and a helpful `message` such as "Photo is blurry, retake closer to the label".',
    '',
    'Kinds (key: label):',
    ...kindLines,
  ].join('\n');
}

// ---------- request ----------
export function buildHeaders(apiKey, model) {
  const h = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true', // required for calls made straight from a browser (CORS)
  };
  if (model === OPUS) h['anthropic-beta'] = FALLBACK_BETA; // goes with `fallbacks` below
  return h;
}

// NOTE: no temperature / top_p / top_k / thinking. Sampling parameters are a 400 on this API version.
export function buildRequest({ base64, mediaType = 'image/jpeg', model = DEFAULT_MODEL, kinds = KINDS }) {
  return {
    model,
    max_tokens: 4000,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
    ...(model === OPUS ? { fallbacks: 'default' } : {}),
    system: buildPrompt(kinds),
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: 'Identify every supply item in this photo for our inventory.' },
      ],
    }],
  };
}

export function buildKeyTestRequest(model = DEFAULT_MODEL) {
  return { model, messages: [{ role: 'user', content: 'hi' }] };
}

// Long edge capped at maxEdge, never enlarged.
export function resizePlan(width, height, maxEdge = MAX_EDGE) {
  const long = Math.max(width, height);
  if (!(long > 0)) return { width: 0, height: 0, scale: 1 };
  const scale = long > maxEdge ? maxEdge / long : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

// ---------- response ----------
const strOrNull = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function normalizeItem(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  let kind = typeof r.kind === 'string' && KINDS[r.kind] ? r.kind : null;
  let category = typeof r.category === 'string' && CATEGORIES.some((c) => c.key === r.category) ? r.category : null;
  if (kind) category = KINDS[kind].category; // the kind decides the category
  else if (category) kind = `${category}_other`;
  else { category = 'food'; kind = 'food_other'; }
  const qtyNum = Number(r.qty);
  const perUnit = {};
  for (const [k, v] of Object.entries(r.perUnit && typeof r.perUnit === 'object' ? r.perUnit : {})) {
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) perUnit[k] = n;
  }
  const expires = typeof r.expires === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.expires.trim()) ? r.expires.trim() : null;
  const shelf = Number(r.shelfLifeMonths);
  return {
    name: (typeof r.name === 'string' ? r.name.trim() : '') || 'Unnamed item',
    brand: strOrNull(r.brand),
    packageSize: strOrNull(r.packageSize),
    category,
    kind,
    qty: Number.isFinite(qtyNum) ? Math.max(1, qtyNum) : 1,
    unit: strOrNull(r.unit) || KINDS[kind].unit,
    storage: ['pantry', 'fridge', 'freezer', 'other'].includes(r.storage) ? r.storage : 'pantry',
    perUnit,
    nutritionSource: ['label', 'estimated', 'none'].includes(r.nutritionSource) ? r.nutritionSource : 'none',
    insulinType: typeof r.insulinType === 'string' && ROOM_TEMP_DAYS[r.insulinType] ? r.insulinType : null,
    expires,
    shelfLifeMonths: Number.isFinite(shelf) && shelf > 0 && r.shelfLifeMonths !== null ? shelf : null,
    confidence: ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'medium',
    instructions: strOrNull(r.instructions),
    notes: strOrNull(r.notes),
  };
}

export function parseResponse(httpStatus, json) {
  const fail = (code, error, retry = false) => ({ ok: false, retry, error, code });
  const apiMessage = json && json.error && typeof json.error.message === 'string' ? json.error.message : '';

  if (httpStatus === 401 || httpStatus === 403) return fail('auth', 'Your API key was rejected. Check it in Settings.');
  if (httpStatus === 400) return fail('bad_request', `Anthropic could not accept the request: ${apiMessage || 'bad request'}`);
  if (httpStatus === 413) return fail('too_large', 'That photo is too large to send. Try a smaller one.');
  if (httpStatus === 429) return fail('rate_limit', 'Anthropic is rate-limiting requests. Will try again.', true);
  if (httpStatus === 529) return fail('overloaded', 'Anthropic is busy right now. Will try again.', true);
  if (httpStatus >= 500) return fail('server', 'Anthropic had a server problem. Will try again.', true);
  if (!(httpStatus >= 200 && httpStatus < 300)) {
    return fail('http', `Anthropic returned an unexpected error (${httpStatus}).${apiMessage ? ` ${apiMessage}` : ''}`);
  }

  if (!json || typeof json !== 'object') return fail('parse', 'Claude sent back something unreadable.');
  if (json.stop_reason === 'refusal') return fail('refusal', "Claude couldn't identify this photo.");
  if (json.stop_reason === 'max_tokens') return fail('max_tokens', 'Too many items in one photo. Try fewer at a time.');

  const block = Array.isArray(json.content) ? json.content.find((b) => b && b.type === 'text') : null;
  let data = null;
  try { data = block ? JSON.parse(block.text) : null; } catch { data = null; }
  if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
    return fail('parse', "Claude's answer could not be read. Try the photo again.");
  }
  const iterations = json.usage && Array.isArray(json.usage.iterations) ? json.usage.iterations : [];
  return {
    ok: true,
    items: data.items.map(normalizeItem),
    unreadable: !!data.unreadable,
    message: strOrNull(data.message),
    model: typeof json.model === 'string' ? json.model : null,
    servedByFallback: iterations.some((it) => it && it.type === 'fallback_message'),
  };
}

// ---------- offline queue rules (pure, so they can be tested) ----------
export const BACKOFF_MS = [60_000, 300_000, 1_800_000]; // 1 min, 5 min, 30 min
export const MAX_TRIES = 4;

export function backoffMs(tries) {
  return BACKOFF_MS[Math.min(Math.max(tries, 1), BACKOFF_MS.length) - 1];
}

// What should the queue do with this record right now?
export function queueAction(rec, { online, hasKey, now }) {
  if (!rec || rec.status !== 'pending') return 'none';
  if (rec.type === 'photo' && !hasKey) return 'wait-key';
  if (!online) return 'wait-offline';
  if (rec.nextTryAt && rec.nextTryAt > now) return 'wait-retry';
  return 'process';
}

// New fields for a record after an attempt failed.
export function failureState(rec, { retry, error, now }) {
  if (!retry) return { status: 'error', error, tries: rec.tries || 0, nextTryAt: 0 };
  const tries = (rec.tries || 0) + 1;
  if (tries >= MAX_TRIES) return { status: 'error', error, tries, nextTryAt: 0 };
  return { status: 'pending', error, tries, nextTryAt: now + backoffMs(tries) };
}

// Words for the review list.
export function describeRecord(rec, { online, hasKey, now }) {
  if (rec.status === 'ready') return { label: 'Ready', tone: 'ready' };
  if (rec.status === 'error') return { label: rec.error || 'Something went wrong', tone: 'error' };
  if (rec.status === 'processing') return { label: 'Identifying…', tone: 'working' };
  const action = queueAction(rec, { online, hasKey, now });
  if (action === 'wait-key') return { label: 'Add your API key in Settings to identify photos', tone: 'nokey' };
  if (action === 'wait-offline') return { label: 'Waiting for internet', tone: 'waiting' };
  if (action === 'wait-retry') return { label: `${rec.error || 'Will try again'} Retrying soon.`, tone: 'waiting' };
  return { label: rec.type === 'barcode' ? 'Looking it up…' : 'Identifying…', tone: 'working' };
}
