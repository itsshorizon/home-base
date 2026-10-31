// The item form, as a reusable component. Used by Add, Edit and the photo/barcode Review cards.
//
//   const form = mountItemForm(rootEl, {
//     mode: 'add' | 'edit' | 'review',
//     existing,          // edit: the saved item (unknown fields such as barcode/photoId are kept)
//     initial,           // review: an item-shaped draft to prefill
//     category, kind,    // add: starting category / kind
//     items, medNames,   // for the unit / location / medication suggestions
//     extra,             // review: fields merged into the saved item (barcode, brand, photoId)
//     hints,             // { expires: 'text' } small notes under a field; hidden once the user edits that field
//     buttons,           // [{ label, after, primary }] submit buttons; default is a single Save
//     actions,           // [{ label, name }] plain buttons; they call onAction(name)
//     bare,              // true: no card border (the caller supplies one)
//     onSave(item, { again }),   // may be async; if it throws, the message shows in the form
//     onAction(name),
//   });
//   form.destroy(); form.reset(category, kind); form.focusName(); form.getQty();
import { newId } from '../db.js';
import {
  CATEGORIES, KINDS, kindsForCategory, defaultKindFor, fieldLabel, COMMON_UNITS, ROOM_TEMP_DAYS, ROOM_TEMP_LABELS,
} from '../categories.js';
import { esc, addMonths } from '../format.js';

let staplesCache = null;
let instanceCount = 0;

async function loadStaples() {
  if (staplesCache) return staplesCache;
  try {
    const res = await fetch('data/staples.json');
    const json = await res.json();
    staplesCache = Array.isArray(json) ? json : json.items || [];
  } catch {
    staplesCache = [];
  }
  return staplesCache;
}

function blankVals(category = 'food', kind) {
  const k = kind && KINDS[kind] && KINDS[kind].category === category ? kind : defaultKindFor(category);
  return {
    category, kind: k, name: '', qty: '1', unit: '', storage: 'pantry', location: '', expires: '', opened: false,
    notes: '', instructions: '', medName: '', insulinType: 'other', perUnit: {}, bleachOz: '', bleachPct: '6',
  };
}

function valsFromItem(item) {
  const pu = {};
  for (const [k, val] of Object.entries(item.perUnit || {})) pu[k] = String(val);
  return {
    category: item.category, kind: item.kind, name: item.name || '', qty: String(item.qty ?? ''), unit: item.unit || '',
    storage: item.storage || 'pantry', location: item.location || '', expires: item.expires || '', opened: !!item.opened,
    notes: item.notes || '', instructions: item.instructions || '', medName: item.medName || '',
    insulinType: item.insulinType || 'other', perUnit: pu,
    bleachOz: item.bleachOz !== undefined ? String(item.bleachOz) : '', bleachPct: item.bleachPct || '6',
  };
}

function opt(value, label, selected) {
  return `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
}

export function mountItemForm(root, opts) {
  const uid = ++instanceCount;
  const mode = opts.mode || 'add';
  const prefilled = mode === 'edit' ? opts.existing : mode === 'review' ? opts.initial : null;
  const F = {
    vals: prefilled ? valsFromItem(prefilled) : blankVals(opts.category || 'food', opts.kind),
    touched: new Set(),
    hits: [],
    hints: { ...(opts.hints || {}) },
  };
  const items = opts.items || [];

  // Apply a kind's template to every field the user hasn't edited.
  function applyKindDefaults() {
    const k = KINDS[F.vals.kind];
    if (!k) return;
    if (!F.touched.has('unit')) F.vals.unit = k.unit;
    if (!F.touched.has('instructions')) F.vals.instructions = k.instructions || '';
    for (const f of ['kcal', 'protein_g', 'water_gal', 'treat_gal', 'fuel_hours', 'insulin_units', 'count', 'wh']) {
      if (!F.touched.has(`pu.${f}`)) {
        const d = k.perUnit[f];
        if (d !== undefined) F.vals.perUnit[f] = String(d);
        else delete F.vals.perUnit[f];
      }
    }
  }

  if (prefilled) {
    // Values that came in with the item are the user's starting point: changing the kind must not overwrite them.
    F.touched.add('unit'); F.touched.add('instructions');
    for (const f of Object.keys(prefilled.perUnit || {})) F.touched.add(`pu.${f}`);
  } else {
    applyKindDefaults();
  }

  // ---------- html ----------
  const kindSelectHtml = () => kindsForCategory(F.vals.category).map((k) => opt(k.key, k.label, k.key === F.vals.kind)).join('');

  function dynamicHtml() {
    const v = F.vals;
    const k = KINDS[v.kind];
    if (!k) return '';
    let html = '';
    if (v.kind === 'med') {
      html += `<label class="field"><span>Medication name</span>
        <input type="text" data-f="medName" value="${esc(v.medName)}" list="med-names-${uid}" autocomplete="off" placeholder="Must match the name in Household">
        <small class="hint">Match the name you gave in Household so doses are counted for that person.</small></label>`;
    }
    if (v.kind === 'insulin') {
      html += `<label class="field"><span>Insulin type</span><select data-f="insulinType">
        ${Object.keys(ROOM_TEMP_DAYS).map((key) => opt(key, `${ROOM_TEMP_LABELS[key]} · ${ROOM_TEMP_DAYS[key]} days out of fridge`, key === v.insulinType)).join('')}
        </select><small class="hint">Room-temperature days are from manufacturer labeling and differ for vials vs pens. Check your own package insert.</small></label>`;
    }
    if (v.kind === 'bleach') {
      html += `<div class="field-pair">
        <label class="field"><span>Bottle size (fl oz)</span><input type="number" inputmode="decimal" step="any" min="0" data-f="bleachOz" value="${esc(v.bleachOz)}" placeholder="e.g. 121"></label>
        <label class="field"><span>Strength</span><select data-f="bleachPct">${opt('6', '6%', v.bleachPct === '6')}${opt('8.25', '8.25%', v.bleachPct === '8.25')}</select></label>
      </div>
      <p class="hint">Fills in "water it can treat" below: fl oz × 48 for 6%, × 64 for 8.25%. These are conservative clear-water figures from the EPA dose. Cloudy water needs double.</p>`;
    }
    for (const f of k.fields) {
      const label = fieldLabel(f, v.kind, v.unit.trim() || k.unit);
      const val = v.perUnit[f] ?? '';
      html += `<label class="field"><span>${esc(label)}</span>
        <input type="number" inputmode="decimal" step="any" min="0" data-pu="${f}" value="${esc(val)}"${f === 'count' ? ' placeholder="blank = 1"' : ''}>
        ${f === 'count' ? '<small class="hint">Leave blank to count each as 1. That gives a conservative (lower) runway.</small>' : ''}</label>`;
    }
    return html;
  }

  function formHtml() {
    const v = F.vals;
    const units = [...new Set([...COMMON_UNITS, ...items.map((i) => i.unit).filter(Boolean)])];
    const locations = [...new Set(items.map((i) => i.location).filter(Boolean))];
    const buttons = opts.buttons || [{ label: 'Save', after: 'open', primary: true }];
    const actions = opts.actions || [];
    return `
    <form class="form${opts.bare ? ' bare' : ' card'}" novalidate autocomplete="off">
      <div class="field-pair">
        <label class="field"><span>Category</span><select data-f="category">
          ${CATEGORIES.map((c) => opt(c.key, `${c.icon} ${c.label}`, c.key === v.category)).join('')}</select></label>
        <label class="field"><span>Kind</span><select data-f="kind">${kindSelectHtml()}</select></label>
      </div>
      <label class="field name-wrap"><span>Name</span>
        <input type="text" data-f="name" value="${esc(v.name)}" required placeholder="What is it?" autocapitalize="sentences">
        <div class="suggest" data-suggest hidden></div></label>
      <div class="field-pair">
        <label class="field"><span>Quantity</span><input type="number" inputmode="decimal" step="any" min="0" data-f="qty" value="${esc(v.qty)}"></label>
        <label class="field"><span>Unit</span><input type="text" data-f="unit" value="${esc(v.unit)}" list="units-${uid}" autocapitalize="none"></label>
      </div>
      <div class="field-pair">
        <label class="field"><span>Storage</span><select data-f="storage">
          ${opt('pantry', 'Pantry', v.storage === 'pantry')}${opt('fridge', 'Fridge', v.storage === 'fridge')}${opt('freezer', 'Freezer', v.storage === 'freezer')}${opt('other', 'Other', v.storage === 'other')}</select></label>
        <label class="field"><span>Location</span><input type="text" data-f="location" value="${esc(v.location)}" list="locations-${uid}" placeholder="e.g. Garage shelf B"></label>
      </div>
      <div class="field-pair">
        <div><label class="field"><span>Expires</span><input type="date" data-f="expires" value="${esc(v.expires)}"></label>
          <small class="hint est" data-hint="expires"${F.hints.expires ? '' : ' hidden'}>${esc(F.hints.expires || '')}</small></div>
        <label class="field check"><input type="checkbox" data-f="opened"${v.opened ? ' checked' : ''}><span>Opened</span></label>
      </div>
      <div data-dyn>${dynamicHtml()}</div>
      <label class="field"><span>Instructions</span><textarea data-f="instructions" rows="3">${esc(v.instructions)}</textarea></label>
      <label class="field"><span>Notes</span><textarea data-f="notes" rows="2">${esc(v.notes)}</textarea></label>
      <p class="error" data-error role="alert" hidden></p>
      <div class="btn-row">
        ${buttons.map((b) => `<button type="submit" class="btn${b.primary ? ' primary' : ''}" data-after="${esc(b.after || 'open')}">${b.label}</button>`).join('')}
        ${actions.map((a) => `<button type="button" class="btn${a.danger ? ' danger' : ''}" data-action="${esc(a.name)}">${a.label}</button>`).join('')}
      </div>
    </form>
    <datalist id="units-${uid}">${units.map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
    <datalist id="locations-${uid}">${locations.map((u) => `<option value="${esc(u)}">`).join('')}</datalist>
    <datalist id="med-names-${uid}">${(opts.medNames || []).map((u) => `<option value="${esc(u)}">`).join('')}</datalist>`;
  }

  // ---------- state sync ----------
  const q = (sel) => root.querySelector(sel);
  const field = (name) => root.querySelector(`[data-f="${name}"]`);

  function syncStatic() {
    for (const name of ['name', 'qty', 'unit', 'storage', 'location', 'expires', 'notes', 'instructions']) {
      const el = field(name);
      if (el) el.value = F.vals[name];
    }
    field('opened').checked = F.vals.opened;
    field('category').value = F.vals.category;
    field('kind').innerHTML = kindSelectHtml();
  }

  function paintDynamic() {
    q('[data-dyn]').innerHTML = dynamicHtml();
  }

  function paintHints() {
    const el = q('[data-hint="expires"]');
    if (el) { el.textContent = F.hints.expires || ''; el.hidden = !F.hints.expires; }
  }

  function onInput(e) {
    const el = e.target;
    if (el.dataset.pu) {
      F.vals.perUnit[el.dataset.pu] = el.value;
      F.touched.add(`pu.${el.dataset.pu}`);
      return;
    }
    const name = el.dataset.f;
    if (!name || name === 'category' || name === 'kind') return;
    F.vals[name] = el.type === 'checkbox' ? el.checked : el.value;
    if (['unit', 'storage', 'instructions', 'name'].includes(name)) F.touched.add(name);
    if (name === 'expires' && F.hints.expires) { F.hints.expires = ''; paintHints(); }
    if (name === 'unit') {
      // keep the "per <unit>" labels honest, and pens hold less insulin than vials
      if (F.vals.kind === 'insulin' && !F.touched.has('pu.insulin_units')) {
        const u = el.value.trim().toLowerCase();
        if (u === 'pen') F.vals.perUnit.insulin_units = '300';
        else if (u === 'vial') F.vals.perUnit.insulin_units = '1000';
      }
      const focused = document.activeElement === el;
      paintDynamic();
      if (focused) el.focus();
      return;
    }
    if (name === 'bleachOz' || name === 'bleachPct') {
      const oz = Number(F.vals.bleachOz);
      if (oz > 0) {
        F.vals.perUnit.treat_gal = String(Math.round(oz * (F.vals.bleachPct === '8.25' ? 64 : 48)));
        const out = q('[data-pu="treat_gal"]');
        if (out) out.value = F.vals.perUnit.treat_gal;
      }
    }
    if (name === 'name' && F.vals.category === 'food') showSuggestions(el.value);
  }

  function onChange(e) {
    const name = e.target.dataset.f;
    if (name === 'category') {
      F.vals.category = e.target.value;
      F.vals.kind = defaultKindFor(F.vals.category);
      applyKindDefaults();
      syncStatic(); paintDynamic();
    } else if (name === 'kind') {
      F.vals.kind = e.target.value;
      applyKindDefaults();
      syncStatic(); paintDynamic();
    } else if (name === 'storage' || name === 'bleachPct' || name === 'insulinType') {
      onInput(e);
    }
  }

  // ---------- staples autocomplete ----------
  async function showSuggestions(text) {
    const box = q('[data-suggest]');
    const term = text.trim().toLowerCase();
    if (!term) { box.hidden = true; return; }
    const staples = await loadStaples();
    const hits = staples.filter((s) => s.name.toLowerCase().includes(term)).slice(0, 8);
    F.hits = hits;
    if (!hits.length) { box.hidden = true; return; }
    box.innerHTML = hits.map((s, i) =>
      `<button type="button" class="sug" data-sug="${i}"><span>${esc(s.name)}</span><small>${esc(String(s.kcal))} kcal / ${esc(s.unit)}</small></button>`).join('');
    box.hidden = false;
  }

  function applyStaple(s) {
    const v = F.vals;
    v.category = 'food';
    v.kind = 'food'; // only the "food" kind counts toward calories
    v.name = s.name;
    v.unit = s.unit;
    v.perUnit.kcal = String(s.kcal);
    v.perUnit.protein_g = String(s.protein_g);
    v.storage = s.storage || 'pantry';
    v.expires = s.shelfLifeMonths ? addMonths(new Date(), s.shelfLifeMonths) : '';
    F.hints.expires = '';
    const note = 'Nutrition values approximate (USDA).';
    if (!v.notes.includes(note)) v.notes = v.notes ? `${v.notes}\n${note}` : note;
    for (const t of ['name', 'unit', 'storage', 'pu.kcal', 'pu.protein_g']) F.touched.add(t);
    syncStatic(); paintDynamic(); paintHints();
    q('[data-suggest]').hidden = true;
  }

  // ---------- save ----------
  function buildItem() {
    const v = F.vals;
    const k = KINDS[v.kind];
    const name = v.name.trim();
    const qty = Number(v.qty);
    if (!name) return { error: 'Please enter a name.' };
    if (v.qty === '' || !Number.isFinite(qty) || qty < 0) return { error: 'Quantity must be 0 or more.' };
    const perUnit = {};
    for (const f of k ? k.fields : []) {
      const raw = v.perUnit[f];
      if (raw !== undefined && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0) perUnit[f] = Number(raw);
    }
    // keep numbers the form can't show (e.g. an old item whose kind changed to "Other")
    const existing = opts.existing;
    if (existing && existing.kind === v.kind) {
      for (const [f, val] of Object.entries(existing.perUnit || {})) if (!(f in perUnit) && !(k && k.fields.includes(f))) perUnit[f] = val;
    }
    const item = {
      ...(existing || {}),
      ...(opts.extra || {}),
      id: existing ? existing.id : newId(),
      name, category: v.category, kind: v.kind, qty, unit: v.unit.trim() || (k ? k.unit : 'each'),
      storage: v.storage, location: v.location.trim(), expires: v.expires || null, opened: !!v.opened,
      notes: v.notes, instructions: v.instructions,
      medName: v.kind === 'med' ? v.medName.trim() : '',
      insulinType: v.kind === 'insulin' ? v.insulinType : '',
      perUnit, photoId: (existing && existing.photoId) ?? (opts.extra && opts.extra.photoId) ?? null,
    };
    delete item.bleachOz; delete item.bleachPct;
    if (v.kind === 'bleach' && Number(v.bleachOz) > 0) { item.bleachOz = Number(v.bleachOz); item.bleachPct = v.bleachPct; }
    return { item };
  }

  async function onSubmit(e) {
    e.preventDefault();
    const again = e.submitter && e.submitter.dataset.after === 'again';
    const err = q('[data-error]');
    const { item, error } = buildItem();
    if (error) {
      err.textContent = error; err.hidden = false;
      field(error.startsWith('Please') ? 'name' : 'qty').focus();
      return;
    }
    err.hidden = true;
    try {
      await opts.onSave(item, { again });
    } catch (ex) {
      err.textContent = `Could not save: ${ex.message}`; err.hidden = false;
    }
  }

  function onClick(e) {
    const sug = e.target.closest('[data-sug]');
    if (sug) { applyStaple(F.hits[Number(sug.dataset.sug)]); return; }
    const act = e.target.closest('[data-action]');
    if (act) { if (opts.onAction) opts.onAction(act.dataset.action); return; }
    if (!e.target.closest('.name-wrap')) {
      const box = q('[data-suggest]');
      if (box) box.hidden = true;
    }
  }

  root.innerHTML = formHtml();
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('click', onClick);

  return {
    destroy() {
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onChange);
      root.removeEventListener('submit', onSubmit);
      root.removeEventListener('click', onClick);
    },
    // "Save & add another": clear the form but keep the category and kind
    reset(category, kind) {
      F.vals = blankVals(category, kind);
      F.touched = new Set();
      F.hints = {};
      applyKindDefaults();
      syncStatic(); paintDynamic(); paintHints();
      q('[data-error]').hidden = true;
    },
    focusName() { field('name').focus(); },
    getQty() { return Number(F.vals.qty); },
  };
}
