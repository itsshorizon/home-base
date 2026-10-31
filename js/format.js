// Number / date / text helpers. Pure (no DOM), safe to import anywhere.

export function fmtNum(n, maxFrac) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  n = Number(n);
  const abs = Math.abs(n);
  const frac = maxFrac ?? (abs >= 100 ? 0 : abs >= 10 ? 1 : 2);
  return n.toLocaleString('en-US', { maximumFractionDigits: frac });
}

export function fmtDays(d) {
  if (d === null || d === undefined) return '—';
  if (d < 1) return '<1 day';
  if (d < 365) {
    const f = Math.floor(d);
    return f === 1 ? '1 day' : `${f} days`;
  }
  return `${(d / 365).toFixed(1)} yr`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM-DD' -> "Nov 3, 2026" (parsed by hand so time zones can't shift the day)
export function fmtDate(iso) {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return String(iso);
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Whole calendar days from `now`'s local date to the date `iso` (negative = already past).
export function daysUntil(iso, now) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target - today) / 86400000);
}

// today + N months (decimals allowed) as YYYY-MM-DD
export function addMonths(now, months) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const whole = Math.floor(months);
  d.setMonth(d.getMonth() + whole);
  const restDays = Math.round((months - whole) * 30.44);
  d.setDate(d.getDate() + restDays);
  return toISODate(d);
}

export function fmtHM(hours) {
  const totalMin = Math.max(0, Math.floor(hours * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

// Escape user text before putting it in an HTML string.
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const PLURAL_OK = new Set(['can', 'bag', 'box', 'jar', 'bottle', 'pack', 'canister', 'cylinder', 'vial', 'pen', 'roll', 'pouch',
  'carton', 'bar', 'tube', 'jug', 'tin', 'packet', 'loaf', 'case', 'kit', 'tank', 'drum', 'bucket', 'pail', 'tub', 'cup', 'sleeve']);

// "12 cans", "1 can", "5 lb", "3 × 15 oz can"
export function fmtQty(qty, unit) {
  const q = fmtNum(qty);
  const u = String(unit || '').trim();
  if (!u) return q;
  if (/^\d/.test(u)) return `${q} × ${u}`;
  if (Number(qty) !== 1 && PLURAL_OK.has(u.toLowerCase())) {
    return `${q} ${/(x|ch|sh|s)$/.test(u) ? `${u}es` : `${u}s`}`;
  }
  return `${q} ${u}`;
}
