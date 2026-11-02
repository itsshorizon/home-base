// One guide (#/guide/<id>): renders every block type from the guide JSON.
import { getAll } from '../db.js';
import { loadGuide, guideHtml, getChecked, setChecked, bleachResultHtml } from '../guides.js';
import { esc } from '../format.js';

let V = null;

function onChange(e) {
  const box = e.target.closest('[data-check]');
  if (!box || !V) return;
  const set = getChecked(V.guideId);
  if (box.checked) set.add(box.dataset.check); else set.delete(box.dataset.check);
  setChecked(V.guideId, set);
}

function paintCalc() {
  const q = (id) => V.root.querySelector(id);
  const out = q('#calc-out');
  if (!out) return;
  out.innerHTML = bleachResultHtml(q('#calc-gal').value, q('#calc-pct').value, q('#calc-cloudy').value === '1');
}

// Tap a diagram: show it full screen on a dark overlay. Tap anywhere, press the close button or Escape to close.
function openFigure(img) {
  const ov = document.createElement('div');
  ov.className = 'lightbox fig-lightbox';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', 'Diagram, full screen');
  const big = document.createElement('img');
  big.src = img.currentSrc || img.src;
  big.alt = img.alt;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'fig-close';
  close.textContent = '✕ Close';
  const done = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (ev) => { if (ev.key === 'Escape') done(); };
  ov.addEventListener('click', done);
  document.addEventListener('keydown', onKey);
  ov.append(big, close);
  document.body.appendChild(ov);
  close.focus();
}

function onClick(e) {
  const fig = e.target.closest('[data-fig-zoom]');
  if (fig && fig.querySelector('img')) { openFigure(fig.querySelector('img')); return; }
  if (!e.target.closest('[data-reset-checklist]') || !V) return;
  setChecked(V.guideId, new Set());
  V.root.querySelectorAll('[data-check]').forEach((b) => { b.checked = false; });
}

function onInput(e) {
  if (e.target.closest('[data-calc]')) paintCalc();
}

export async function render(container, params) {
  const guide = await loadGuide(params.id);
  if (!guide) {
    container.innerHTML = `<a class="back" href="#/guides">← Guides</a>
      <div class="card empty"><p><b>Guide not found</b></p><p class="muted">"${esc(params.id)}" hasn't been downloaded yet.</p></div>`;
    return;
  }
  const needsPeople = guide.blocks.some((b) => b && b.type === 't1dplan');
  const [people, items] = await Promise.all([needsPeople ? getAll('people') : [], getAll('items')]);
  container.innerHTML = guideHtml(guide, { people, items, online: navigator.onLine !== false });
  V = { root: container, guideId: guide.id };
  container.addEventListener('change', onChange);
  container.addEventListener('click', onClick);
  container.addEventListener('input', onInput);
  container.addEventListener('change', onInput); // selects fire "change"
}

export function destroy() {
  if (V) {
    V.root.removeEventListener('change', onChange);
    V.root.removeEventListener('click', onClick);
    V.root.removeEventListener('input', onInput);
    V.root.removeEventListener('change', onInput);
  }
  document.querySelectorAll('.fig-lightbox').forEach((el) => el.remove());
  V = null;
}
