import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { offUrl, mapOffProduct, normalizeBarcode, sameBarcode, isValidBarcode, NOT_FOUND_MESSAGE } from '../js/off.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('offUrl builds the v2 product URL with the field list', () => {
  const u = offUrl('0051000012616');
  assert.ok(u.startsWith('https://world.openfoodfacts.org/api/v2/product/0051000012616.json?fields='));
  for (const f of ['product_name', 'brands', 'quantity', 'product_quantity', 'nutriments', 'serving_quantity', 'image_front_small_url']) assert.ok(u.includes(f), f);
  assert.ok(offUrl('051000012616').includes('/0051000012616.json'), '12-digit UPC-A is padded to EAN-13');
});

test('real fixture (Campbell\'s Cream of Mushroom, 0051000012616): kcal = round(kcal_100g x qty / 100)', () => {
  const json = fixture('off-0051000012616-campbells-mushroom-soup.json');
  const p = json.product;
  const { found, item } = mapOffProduct(json, '0051000012616');
  assert.equal(found, true);
  assert.equal(item.name, p.product_name);
  assert.equal(item.brand, "Campbell's");
  assert.equal(item.packageSize, p.quantity);
  assert.equal(item.kind, 'food');
  assert.equal(item.category, 'food');
  assert.equal(item.unit, 'each');
  assert.equal(item.qty, 1);
  assert.equal(item.nutritionSource, 'label');
  assert.equal(item.barcode, '0051000012616');
  assert.equal(p.product_quantity_unit, 'g');
  assert.equal(item.perUnit.kcal, Math.round((p.nutriments['energy-kcal_100g'] * Number(p.product_quantity)) / 100));
  assert.equal(item.perUnit.protein_g, Math.round(((p.nutriments.proteins_100g * Number(p.product_quantity)) / 100) * 10) / 10);
  assert.ok(item.perUnit.kcal > 150 && item.perUnit.kcal < 350, 'a can of soup is a few hundred kcal');
  assert.deepEqual(item.warnings, []);
});

test('not-found fixture (status 0) gives an empty draft with the barcode and the friendly message', () => {
  const json = fixture('off-0078742013589-not-found.json');
  assert.equal(json.status, 0);
  const r = mapOffProduct(json, '0078742013589');
  assert.equal(r.found, false);
  assert.equal(r.message, NOT_FOUND_MESSAGE);
  assert.equal(r.item.name, '');
  assert.equal(r.item.barcode, '0078742013589');
  assert.equal(mapOffProduct({ status: 1, product: { product_name: '  ' } }, '123').found, false);
  assert.equal(mapOffProduct(null, '123').found, false);
});

test('serving-only fixture (no package size): per-serving values and a warning', () => {
  const json = fixture('off-0070038323006-serving-only.json');
  assert.equal(json.product.product_quantity, undefined);
  const { found, item } = mapOffProduct(json, '0070038323006');
  assert.equal(found, true);
  assert.equal(item.perUnit.kcal, json.product.nutriments['energy-kcal_serving']);
  assert.equal(item.perUnit.protein_g, 0);
  assert.equal(item.warnings.length, 1);
  assert.match(item.warnings[0], /per serving/i);
});

test('package units other than g/ml are not used for the per-100 maths', () => {
  const json = { status: 1, product: { product_name: 'X', product_quantity: '2', product_quantity_unit: 'kg', nutriments: { 'energy-kcal_100g': 100 } } };
  assert.equal(mapOffProduct(json, '1').item.perUnit.kcal, undefined);
  const noUnit = { status: 1, product: { product_name: 'X', product_quantity: '200', nutriments: { 'energy-kcal_100g': 100 } } };
  assert.equal(mapOffProduct(noUnit, '1').item.perUnit.kcal, 200);
});

test('barcode helpers', () => {
  assert.equal(normalizeBarcode(' 0 51000 012616 '), '0051000012616');
  assert.equal(normalizeBarcode('051000012616'), '0051000012616');
  assert.equal(sameBarcode('051000012616', '0051000012616'), true);
  assert.equal(sameBarcode('051000012616', '0039400016113'), false);
  assert.equal(sameBarcode('', ''), false);
  assert.equal(isValidBarcode('1234567'), false);
  assert.equal(isValidBarcode('0051000012616'), true);
});
