import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kgToLbs, lbsToKg, parseWeightToKg } from '../app/js/logic.js';

test('kg/lbs conversion round trip', () => {
  assert.ok(Math.abs(kgToLbs(80) - 176.37) < 0.01);
  assert.ok(Math.abs(lbsToKg(kgToLbs(82.4)) - 82.4) < 1e-9);
});

test('parseWeightToKg accepts comma decimals', () => {
  assert.deepEqual(parseWeightToKg('82,4', 'kg'), { ok: true, kg: 82.4 });
});

test('parseWeightToKg converts lbs to canonical kg', () => {
  const r = parseWeightToKg('180', 'lbs');
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.kg - 81.65) < 0.01);
});

test('parseWeightToKg rounds to 2 decimals', () => {
  assert.deepEqual(parseWeightToKg('82.456', 'kg'), { ok: true, kg: 82.46 });
});

test('parseWeightToKg rejects junk and out-of-range values', () => {
  assert.equal(parseWeightToKg('abc', 'kg').ok, false);
  assert.equal(parseWeightToKg('', 'kg').ok, false);
  assert.equal(parseWeightToKg('12', 'kg').ok, false);
  assert.equal(parseWeightToKg('500', 'kg').ok, false);
  assert.equal(parseWeightToKg('50', 'lbs').ok, false); // 22.7 kg, below floor
});
