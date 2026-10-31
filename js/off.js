// Open Food Facts barcode lookup. PURE: no DOM, no storage, Node-importable.

const FIELDS = 'product_name,brands,quantity,product_quantity,product_quantity_unit,serving_size,serving_quantity,nutriments,categories_tags,image_front_small_url';
export const NOT_FOUND_MESSAGE = 'Not in the food database. Take a photo or type it in.';

// Digits only. A 12-digit UPC-A becomes a 13-digit EAN-13 (leading 0) because that is how Open Food Facts stores it.
export function normalizeBarcode(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.length === 12 ? `0${digits}` : digits;
}

export function isValidBarcode(raw) {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 14;
}

// UPC-A and EAN-13 versions of the same product differ only by leading zeros.
export function sameBarcode(a, b) {
  const x = String(a ?? '').replace(/\D/g, '').replace(/^0+/, '');
  const y = String(b ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return x !== '' && x === y;
}

export function offUrl(code) {
  return `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(normalizeBarcode(code))}.json?fields=${FIELDS}`;
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Nutrient for the WHOLE package. Prefer per-100 x package size; fall back to the per-serving value.
function perPackage(p, per100Key, perServingKey) {
  const n = p.nutriments || {};
  const size = num(p.product_quantity);
  const unit = String(p.product_quantity_unit || '').trim().toLowerCase();
  const v100 = num(n[per100Key]);
  if (v100 !== null && size !== null && size > 0 && (unit === '' || unit === 'g' || unit === 'ml')) {
    return { value: (v100 * size) / 100, perServing: false };
  }
  const vServing = num(n[perServingKey]);
  if (vServing !== null && num(p.serving_quantity)) return { value: vServing, perServing: true };
  return null;
}

export function emptyDraft(code = '') {
  return {
    name: '', brand: null, packageSize: null, category: 'food', kind: 'food', qty: 1, unit: 'each', storage: 'pantry',
    perUnit: {}, nutritionSource: 'none', insulinType: null, expires: null, shelfLifeMonths: null, confidence: 'low',
    instructions: null, notes: null, barcode: code ? normalizeBarcode(code) : null, warnings: [],
  };
}

// json: the Open Food Facts response. Returns { found, item, message }.
export function mapOffProduct(json, code = '') {
  const p = json && json.product;
  const name = p && typeof p.product_name === 'string' ? p.product_name.trim() : '';
  if (!json || json.status === 0 || !p || !name) {
    return { found: false, item: emptyDraft(code), message: NOT_FOUND_MESSAGE };
  }
  const item = emptyDraft(code || json.code);
  item.name = name;
  item.brand = typeof p.brands === 'string' && p.brands.trim() ? p.brands.split(',')[0].trim() : null;
  item.packageSize = typeof p.quantity === 'string' && p.quantity.trim() ? p.quantity.trim() : null;
  item.confidence = 'high';

  const kcal = perPackage(p, 'energy-kcal_100g', 'energy-kcal_serving');
  const protein = perPackage(p, 'proteins_100g', 'proteins_serving');
  if (kcal) item.perUnit.kcal = Math.round(kcal.value);
  if (protein) item.perUnit.protein_g = Math.round(protein.value * 10) / 10;
  if (kcal || protein) item.nutritionSource = 'label';
  if ((kcal && kcal.perServing) || (protein && protein.perServing)) {
    item.warnings.push('Nutrition is per serving. The database has no package size, so set the quantity to match.');
  }
  return { found: true, item, message: null };
}
