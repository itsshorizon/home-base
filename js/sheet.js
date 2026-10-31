// A bottom sheet (modal). Used for "add your API key" and "you already have this".
// openSheet(html, { onAction(name, closeFn), onClose }) -> { el, close }
// Any element in `html` with data-sheet="name" calls onAction(name). data-sheet="close" just closes.
export function openSheet(html, { onAction, onClose } = {}) {
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    back.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', (e) => {
    if (e.target === back) { close(); return; }
    const btn = e.target.closest('[data-sheet]');
    if (!btn) return;
    const name = btn.dataset.sheet;
    if (name === 'close') { close(); return; }
    if (onAction) onAction(name, close, btn);
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(back);
  const first = back.querySelector('[data-sheet], a, button, input');
  if (first) first.focus();
  return { el: back, close };
}
