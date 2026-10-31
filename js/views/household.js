// Household: people and pets (#/household, #/person/<id>, #/pet/<id>).
import { getAll, get, put, del, newId, getSettings } from '../db.js';
import { ROOM_TEMP_DAYS, ROOM_TEMP_LABELS } from '../categories.js';
import { defaultKcal } from '../runway.js';
import { esc, fmtNum } from '../format.js';

const toast = (message) => window.dispatchEvent(new CustomEvent('hb:toast', { detail: { message } }));

let cleanup = null;
export function destroy() { if (cleanup) cleanup(); cleanup = null; }

export async function render(container, params) {
  if (params.name === 'person') return renderPerson(container, params.id);
  if (params.name === 'pet') return renderPet(container, params.id);
  return renderList(container);
}

// ---------------- list ----------------
async function renderList(container) {
  const [people, pets, settings] = await Promise.all([getAll('people'), getAll('pets'), getSettings()]);
  const personRow = (p) => {
    const kcal = defaultKcal(p);
    const water = p.waterGalPerDay ?? settings.waterGalPerPersonDay;
    const meds = (p.meds || []).filter((m) => m.name).length;
    return `<a class="card row-link" href="#/person/${esc(p.id)}">
      <div><div class="row-title">${esc(p.name)}${p.age !== null && p.age !== undefined && p.age !== '' ? `, ${esc(p.age)}` : ''}</div>
        <div class="muted small">${fmtNum(kcal)} kcal/day · ${fmtNum(water)} gal water/day</div></div>
      <div class="badges">${p.t1d ? '<span class="badge red">T1D</span>' : ''}${meds ? `<span class="badge">${meds} med${meds === 1 ? '' : 's'}</span>` : ''}</div></a>`;
  };
  const petRow = (p) => `<a class="card row-link" href="#/pet/${esc(p.id)}">
      <div><div class="row-title">${esc(p.name)}</div>
        <div class="muted small">${esc(p.species || 'Pet')} · ${fmtNum(p.kcalPerDay || 0)} kcal/day · ${fmtNum(p.waterGalPerDay || 0)} gal/day</div></div></a>`;
  container.innerHTML = `
    <a class="back" href="#/more">← More</a>
    <h1>Household</h1>
    <div class="row-between"><h2>People</h2><a class="btn small primary" href="#/person/new">+ Add person</a></div>
    ${people.length ? people.map(personRow).join('') : '<div class="card empty"><p>No one added yet. Add each person so calories, water and medicine are counted correctly.</p></div>'}
    <div class="row-between"><h2>Pets</h2><a class="btn small primary" href="#/pet/new">+ Add pet</a></div>
    ${pets.length ? pets.map(petRow).join('') : '<div class="card empty"><p class="muted">No pets.</p></div>'}`;
}

// ---------------- person form ----------------
const T1D_DEFAULTS = {
  basalUnits: 20, bolusUnits: 20, usesPump: true, pumpType: 'tubeless', pumpChangeDays: 3,
  usesCGM: true, cgmDays: 10, stripsPerDay: 2, ketoneStripsPerDay: 0, injectionsPerDay: 0,
  rapidInsulin: 'humalog', basalInsulin: 'lantus',
};

function medRow(m = { name: '', dose: '', perDay: 1 }) {
  return `<div class="med-row">
    <input type="text" class="med-name" placeholder="Name" aria-label="Medication name" value="${esc(m.name)}">
    <input type="text" class="med-dose" placeholder="Dose" aria-label="Dose" value="${esc(m.dose || '')}">
    <input type="number" class="med-perday" inputmode="decimal" step="any" min="0" aria-label="Doses per day" title="Doses per day" value="${esc(m.perDay ?? 1)}">
    <button type="button" class="icon-btn" data-rm-med aria-label="Remove medication">✕</button>
  </div>`;
}

function insulinOptions(selected) {
  return Object.keys(ROOM_TEMP_DAYS).filter((k) => k !== 'other')
    .map((k) => `<option value="${k}"${k === selected ? ' selected' : ''}>${esc(ROOM_TEMP_LABELS[k])}</option>`).join('');
}

function num(v) { return v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v); }

async function renderPerson(container, id) {
  const isNew = id === 'new';
  const [existing, settings] = await Promise.all([isNew ? null : get('people', id), getSettings()]);
  if (!isNew && !existing) {
    container.innerHTML = '<a class="back" href="#/household">← Household</a><div class="card empty"><p>That person no longer exists.</p></div>';
    return;
  }
  const p = existing || { name: '', age: '', sex: 'M', weightLb: null, kcalPerDay: null, waterGalPerDay: null, bloodType: '', allergies: '', conditions: '', meds: [], t1d: null };
  const t = p.t1d || T1D_DEFAULTS;
  const val = (v) => esc(v ?? '');
  container.innerHTML = `
    <a class="back" href="#/household">← Household</a>
    <h1>${isNew ? 'Add person' : esc(p.name || 'Person')}</h1>
    <form id="pf" class="card form" novalidate autocomplete="off">
      <label class="field"><span>Name</span><input type="text" id="p-name" value="${val(p.name)}" required autocapitalize="words"></label>
      <div class="field-pair">
        <label class="field"><span>Age</span><input type="number" id="p-age" inputmode="numeric" min="0" max="120" value="${val(p.age)}"></label>
        <label class="field"><span>Sex</span><select id="p-sex"><option value="M"${p.sex === 'M' ? ' selected' : ''}>Male</option><option value="F"${p.sex === 'F' ? ' selected' : ''}>Female</option></select></label>
      </div>
      <label class="field"><span>Weight (lb, optional)</span><input type="number" id="p-weight" inputmode="decimal" min="0" value="${val(p.weightLb)}"></label>
      <div class="field-pair">
        <label class="field"><span>Calories/day override</span><input type="number" id="p-kcal" inputmode="numeric" min="0" value="${val(p.kcalPerDay)}" placeholder=""></label>
        <label class="field"><span>Water gal/day override</span><input type="number" id="p-water" inputmode="decimal" step="any" min="0" value="${val(p.waterGalPerDay)}" placeholder="${esc(settings.waterGalPerPersonDay)}"></label>
      </div>
      <div class="field-pair">
        <label class="field"><span>Blood type</span><input type="text" id="p-blood" value="${val(p.bloodType)}"></label>
        <label class="field"><span>Allergies</span><input type="text" id="p-allergies" value="${val(p.allergies)}"></label>
      </div>
      <label class="field"><span>Conditions</span><input type="text" id="p-conditions" value="${val(p.conditions)}"></label>

      <h2>Medications</h2>
      <div class="med-head muted small"><span>Name</span><span>Dose</span><span>Per day</span><span></span></div>
      <div id="meds">${(p.meds || []).map(medRow).join('')}</div>
      <button type="button" class="btn small" id="add-med">+ Add medication</button>

      <label class="switch t1d-switch"><input type="checkbox" id="p-t1d"${p.t1d ? ' checked' : ''}><span class="track"><span class="thumb"></span></span><span class="switch-label">Has Type 1 diabetes</span></label>
      <div id="t1d-fields" ${p.t1d ? '' : 'hidden'}>
        <div class="field-pair">
          <label class="field"><span>Basal units/day</span><input type="number" id="t-basal" inputmode="decimal" step="any" min="0" value="${val(t.basalUnits)}"></label>
          <label class="field"><span>Bolus units/day</span><input type="number" id="t-bolus" inputmode="decimal" step="any" min="0" value="${val(t.bolusUnits)}"></label>
        </div>
        <label class="switch"><input type="checkbox" id="t-pump"${t.usesPump ? ' checked' : ''}><span class="track"><span class="thumb"></span></span><span class="switch-label">Uses an insulin pump</span></label>
        <div class="field-pair">
          <label class="field"><span>Pump type</span><select id="t-pumptype"><option value="tubeless"${t.pumpType === 'tubeless' ? ' selected' : ''}>Tubeless (Omnipod)</option><option value="tubed"${t.pumpType === 'tubed' ? ' selected' : ''}>Tubed (Tandem/Medtronic)</option></select></label>
          <label class="field"><span>Change every (days)</span><input type="number" id="t-pumpdays" inputmode="decimal" step="any" min="1" value="${val(t.pumpChangeDays)}"></label>
        </div>
        <label class="switch"><input type="checkbox" id="t-cgm"${t.usesCGM ? ' checked' : ''}><span class="track"><span class="thumb"></span></span><span class="switch-label">Uses a CGM</span></label>
        <label class="field"><span>Sensor lasts (days)</span><input type="number" id="t-cgmdays" inputmode="decimal" step="any" min="1" value="${val(t.cgmDays)}"></label>
        <div class="field-pair">
          <label class="field"><span>Fingersticks/day</span><input type="number" id="t-strips" inputmode="decimal" step="any" min="0" value="${val(t.stripsPerDay)}"></label>
          <label class="field"><span>Ketone strips/day</span><input type="number" id="t-keto" inputmode="decimal" step="any" min="0" value="${val(t.ketoneStripsPerDay)}"></label>
        </div>
        <label class="field"><span>Injections/day</span><input type="number" id="t-inj" inputmode="decimal" step="any" min="0" value="${val(t.injectionsPerDay)}"><small class="hint">For MDI or pump backup.</small></label>
        <div class="field-pair">
          <label class="field"><span>Rapid insulin</span><select id="t-rapid">${insulinOptions(t.rapidInsulin)}</select></label>
          <label class="field"><span>Basal insulin</span><select id="t-basalins">${insulinOptions(t.basalInsulin)}</select></label>
        </div>
      </div>
      <p class="error" id="p-error" role="alert" hidden></p>
      <div class="btn-row">
        <button type="submit" class="btn primary">Save</button>
        ${isNew ? '' : '<button type="button" class="btn danger" id="p-del">Delete</button>'}
      </div>
    </form>`;

  const $ = (sel) => container.querySelector(sel);
  const updatePlaceholder = () => {
    const age = num($('#p-age').value);
    $('#p-kcal').placeholder = `${fmtNum(defaultKcal({ age, sex: $('#p-sex').value }))} (default)`;
  };
  updatePlaceholder();

  const onClick = async (e) => {
    if (e.target.closest('#add-med')) {
      $('#meds').insertAdjacentHTML('beforeend', medRow());
      $('#meds').lastElementChild.querySelector('.med-name').focus();
    } else if (e.target.closest('[data-rm-med]')) {
      e.target.closest('.med-row').remove();
    } else if (e.target.closest('#p-del')) {
      if (!confirm(`Delete ${p.name || 'this person'}?`)) return;
      await del('people', existing.id);
      toast('Deleted');
      location.hash = '#/household';
    }
  };
  const onInput = (e) => { if (e.target.id === 'p-age' || e.target.id === 'p-sex') updatePlaceholder(); };
  const onChange = (e) => { if (e.target.id === 'p-t1d') $('#t1d-fields').hidden = !e.target.checked; };
  const onSubmit = async (e) => {
    e.preventDefault();
    const err = $('#p-error');
    const name = $('#p-name').value.trim();
    if (!name) { err.textContent = 'Please enter a name.'; err.hidden = false; $('#p-name').focus(); return; }
    const meds = [...container.querySelectorAll('.med-row')].map((r) => ({
      name: r.querySelector('.med-name').value.trim(),
      dose: r.querySelector('.med-dose').value.trim(),
      perDay: num(r.querySelector('.med-perday').value) ?? 1,
    })).filter((m) => m.name);
    const rec = {
      ...(existing || {}), id: existing ? existing.id : newId(),
      name, age: num($('#p-age').value), sex: $('#p-sex').value, weightLb: num($('#p-weight').value),
      kcalPerDay: num($('#p-kcal').value), waterGalPerDay: num($('#p-water').value),
      bloodType: $('#p-blood').value.trim(), allergies: $('#p-allergies').value.trim(), conditions: $('#p-conditions').value.trim(),
      meds,
      t1d: $('#p-t1d').checked ? {
        basalUnits: num($('#t-basal').value) ?? 0, bolusUnits: num($('#t-bolus').value) ?? 0,
        usesPump: $('#t-pump').checked, pumpType: $('#t-pumptype').value, pumpChangeDays: num($('#t-pumpdays').value) ?? 3,
        usesCGM: $('#t-cgm').checked, cgmDays: num($('#t-cgmdays').value) ?? 10,
        stripsPerDay: num($('#t-strips').value) ?? 0, ketoneStripsPerDay: num($('#t-keto').value) ?? 0,
        injectionsPerDay: num($('#t-inj').value) ?? 0,
        rapidInsulin: $('#t-rapid').value, basalInsulin: $('#t-basalins').value,
      } : null,
    };
    try { await put('people', rec); } catch (ex) { err.textContent = `Could not save: ${ex.message}`; err.hidden = false; return; }
    toast('Saved');
    location.hash = '#/household';
  };
  container.addEventListener('click', onClick);
  container.addEventListener('input', onInput);
  container.addEventListener('change', onChange);
  container.addEventListener('submit', onSubmit);
  cleanup = () => {
    container.removeEventListener('click', onClick);
    container.removeEventListener('input', onInput);
    container.removeEventListener('change', onChange);
    container.removeEventListener('submit', onSubmit);
  };
}

// ---------------- pet form ----------------
async function renderPet(container, id) {
  const isNew = id === 'new';
  const existing = isNew ? null : await get('pets', id);
  if (!isNew && !existing) {
    container.innerHTML = '<a class="back" href="#/household">← Household</a><div class="card empty"><p>That pet no longer exists.</p></div>';
    return;
  }
  const p = existing || { name: '', species: '', kcalPerDay: '', waterGalPerDay: '' };
  container.innerHTML = `
    <a class="back" href="#/household">← Household</a>
    <h1>${isNew ? 'Add pet' : esc(p.name || 'Pet')}</h1>
    <form id="pf" class="card form" novalidate autocomplete="off">
      <label class="field"><span>Name</span><input type="text" id="n" value="${esc(p.name)}" required></label>
      <label class="field"><span>Species</span><input type="text" id="sp" value="${esc(p.species)}" placeholder="Dog, cat..."></label>
      <div class="field-pair">
        <label class="field"><span>Calories/day</span><input type="number" id="k" inputmode="numeric" min="0" value="${esc(p.kcalPerDay ?? '')}"></label>
        <label class="field"><span>Water gal/day</span><input type="number" id="w" inputmode="decimal" step="any" min="0" value="${esc(p.waterGalPerDay ?? '')}"></label>
      </div>
      <p class="hint">A 50 lb dog ≈ 1,100 kcal and 0.2 gal per day.</p>
      <p class="error" id="p-error" role="alert" hidden></p>
      <div class="btn-row">
        <button type="submit" class="btn primary">Save</button>
        ${isNew ? '' : '<button type="button" class="btn danger" id="p-del">Delete</button>'}
      </div>
    </form>`;
  const onSubmit = async (e) => {
    e.preventDefault();
    const name = container.querySelector('#n').value.trim();
    const err = container.querySelector('#p-error');
    if (!name) { err.textContent = 'Please enter a name.'; err.hidden = false; return; }
    const rec = {
      ...(existing || {}), id: existing ? existing.id : newId(), name,
      species: container.querySelector('#sp').value.trim(),
      kcalPerDay: num(container.querySelector('#k').value) ?? 0,
      waterGalPerDay: num(container.querySelector('#w').value) ?? 0,
    };
    await put('pets', rec);
    toast('Saved');
    location.hash = '#/household';
  };
  const onClick = async (e) => {
    if (!e.target.closest('#p-del')) return;
    if (!confirm(`Delete ${p.name || 'this pet'}?`)) return;
    await del('pets', existing.id);
    toast('Deleted');
    location.hash = '#/household';
  };
  container.addEventListener('submit', onSubmit);
  container.addEventListener('click', onClick);
  cleanup = () => {
    container.removeEventListener('submit', onSubmit);
    container.removeEventListener('click', onClick);
  };
}
