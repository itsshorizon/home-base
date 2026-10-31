// Browser-only image helpers: shrink a phone photo before it is stored or sent anywhere.
import { resizePlan, MAX_EDGE } from './ai.js';

async function loadBitmap(blob) {
  try {
    // 'from-image' applies the EXIF rotation so portrait photos are not sideways
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close && bmp.close() };
  } catch { /* older browsers: fall back to an <img> element */ }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close() {} };
  } finally {
    // the decoded image stays usable after the URL is revoked
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the photo.'))), 'image/jpeg', quality);
  });
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error || new Error('Could not read the photo.'));
    r.readAsDataURL(blob);
  });
}

async function draw(blob, maxEdge, quality) {
  const bmp = await loadBitmap(blob);
  try {
    const plan = resizePlan(bmp.width, bmp.height, maxEdge);
    if (!plan.width) throw new Error('That file does not look like a photo.');
    const canvas = document.createElement('canvas');
    canvas.width = plan.width;
    canvas.height = plan.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // JPEG has no transparency
    ctx.fillRect(0, 0, plan.width, plan.height);
    ctx.drawImage(bmp.source, 0, 0, plan.width, plan.height);
    return { blob: await canvasToBlob(canvas, quality), width: plan.width, height: plan.height };
  } finally {
    bmp.close();
  }
}

// file -> JPEG with the long edge at most maxEdge. base64 has no "data:" prefix.
export async function fileToJpeg(file, maxEdge = MAX_EDGE) {
  const { blob, width, height } = await draw(file, maxEdge, 0.85);
  return { blob, base64: await blobToBase64(blob), width, height };
}

export async function thumbnail(blob, maxEdge = 400) {
  return (await draw(blob, maxEdge, 0.75)).blob;
}
