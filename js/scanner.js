// Barcode scanner. Uses the browser's BarcodeDetector when it can read EAN-13 (Chrome/Android),
// and the vendored html5-qrcode library otherwise (iOS Safari). The library is loaded only when the scanner opens.
import { isValidBarcode } from './off.js';

const LIB_SRC = 'vendor/html5-qrcode-2.3.8.min.js';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let active = null; // { stop() } for whichever engine is running

function loadLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script'); // classic script: the library defines a global
    s.src = LIB_SRC;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('The scanner library could not be loaded.'));
    document.head.appendChild(s);
  });
}

async function nativeSupported() {
  if (!('BarcodeDetector' in window)) return false;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('ean_13');
  } catch { return false; }
}

async function startNative(container, onCode) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  container.appendChild(video);
  await video.play();
  // Ask only for formats this browser supports (some report UPC-A under ean_13, and unknown formats throw)
  const supported = await window.BarcodeDetector.getSupportedFormats();
  const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'].filter((f) => supported.includes(f)) });
  let stopped = false;
  const timer = setInterval(async () => {
    if (stopped || video.readyState < 2) return;
    try {
      const found = await detector.detect(video);
      if (found.length && !stopped) onCode(found[0].rawValue);
    } catch { /* a bad frame: try the next one */ }
  }, 250);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      video.remove();
    },
  };
}

async function startLib(container, onCode) {
  await loadLib();
  const holder = document.createElement('div');
  holder.id = 'hb-qr-holder';
  container.appendChild(holder);
  const F = window.Html5QrcodeSupportedFormats;
  const qr = new window.Html5Qrcode('hb-qr-holder', {
    formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E], verbose: false,
  });
  await qr.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 140 } }, (text) => onCode(text), () => {});
  return {
    async stop() {
      try { await qr.stop(); } catch { /* already stopped */ }
      try { qr.clear(); } catch { /* ignore */ }
      holder.remove();
    },
  };
}

// Low-level: start the camera inside `container`. Rejects if there is no camera or permission is denied.
export async function startScanner(container, onCode) {
  await stopScanner();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser has no camera access.');
  active = (await nativeSupported()) ? await startNative(container, onCode) : await startLib(container, onCode);
}

export async function stopScanner() {
  const a = active;
  active = null;
  if (a) await a.stop();
}

// Full-screen overlay: camera, framing box, Cancel, and a "type the number" box for when the camera can't help.
// onCode(code) is called once with a valid code; the overlay and camera are already closed by then.
export function openScanner({ onCode }) {
  const el = document.createElement('div');
  el.className = 'scanner';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Scan a barcode');
  el.innerHTML = `
    <div class="scanner-video" data-video><div class="scanner-frame" aria-hidden="true"></div></div>
    <p class="scanner-msg" data-msg>Point the camera at the barcode.</p>
    <form class="scanner-type" data-form novalidate>
      <label class="field"><span>Or type the number under the barcode</span>
        <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-code placeholder="e.g. 0051000012616" aria-label="Barcode number"></label>
      <div class="btn-row">
        <button type="submit" class="btn primary">Look it up</button>
        <button type="button" class="btn" data-cancel>Cancel</button>
      </div>
    </form>`;
  document.body.appendChild(el);
  document.body.classList.add('no-scroll');
  const msg = el.querySelector('[data-msg]');
  const input = el.querySelector('[data-code]');
  let finished = false;

  async function close() {
    finished = true;
    document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onKey);
    el.remove();
    await stopScanner();
  }
  async function done(code) {
    if (finished) return;
    if (!isValidBarcode(code)) {
      msg.textContent = 'That does not look like a barcode number (8 to 14 digits).';
      return;
    }
    if (navigator.vibrate) navigator.vibrate(60);
    await close();
    onCode(String(code).replace(/\D/g, ''));
  }
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  el.querySelector('[data-cancel]').addEventListener('click', close);
  el.querySelector('[data-form]').addEventListener('submit', (e) => { e.preventDefault(); done(input.value); });

  startScanner(el.querySelector('[data-video]'), (code) => { if (isValidBarcode(code)) done(code); }).then(() => { if (finished) stopScanner(); }).catch((err) => {
    if (finished) return;
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    msg.innerHTML = `${esc(denied ? 'Camera permission was denied.' : 'The camera is not available here.')} Type the number below instead.`;
    el.classList.add('no-camera');
    input.focus();
  });
  return { close };
}
