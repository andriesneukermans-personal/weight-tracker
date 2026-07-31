import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kgToLbs, lbsToKg, parseWeightToKg, fmtWeight, kgLost } from '../app/js/logic.js';

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

test('fmtWeight shows hundredths but trims a trailing zero', () => {
  assert.equal(fmtWeight(82.15), '82.15');
  assert.equal(fmtWeight(82.5), '82.5');
  assert.equal(fmtWeight(82), '82.0');
  assert.equal(fmtWeight(0), '0.0');
  assert.equal(fmtWeight(102.05), '102.05');
  assert.equal(fmtWeight(-0.15), '-0.15');
});

test('kgLost tracks the current weight, not the historical minimum', () => {
  assert.equal(kgLost(84, 82.4), 1); // 1.6 kg down
  assert.equal(kgLost(84, 84.5), 0); // regained past the start
  assert.equal(kgLost(84, 79.9), 4);
  assert.equal(kgLost(84, 84), 0);
});

test('parseWeightToKg rejects junk and out-of-range values', () => {
  assert.equal(parseWeightToKg('abc', 'kg').ok, false);
  assert.equal(parseWeightToKg('', 'kg').ok, false);
  assert.equal(parseWeightToKg('12', 'kg').ok, false);
  assert.equal(parseWeightToKg('500', 'kg').ok, false);
  assert.equal(parseWeightToKg('50', 'lbs').ok, false); // 22.7 kg, below floor
});
