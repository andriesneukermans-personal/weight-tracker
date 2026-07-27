import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateLocal, todayLocal, addDays, sortByDate } from '../app/js/logic.js';

test('formatDateLocal uses local components, not UTC', () => {
  // 2026-01-01T04:30Z is 2025-12-31 23:30 in America/New_York (the test TZ)
  const d = new Date('2026-01-01T04:30:00Z');
  assert.equal(formatDateLocal(d), '2025-12-31');
  assert.notEqual(formatDateLocal(d), d.toISOString().slice(0, 10));
});

test('formatDateLocal pads month and day', () => {
  assert.equal(formatDateLocal(new Date(2026, 2, 5)), '2026-03-05');
});

test('todayLocal formats a provided now', () => {
  assert.equal(todayLocal(new Date(2026, 6, 27, 23, 55)), '2026-07-27');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-07-27', -6), '2026-07-21');
});

test('sortByDate returns a new ascending array', () => {
  const a = [{ date: '2026-07-27' }, { date: '2026-07-25' }];
  const s = sortByDate(a);
  assert.deepEqual(s.map((e) => e.date), ['2026-07-25', '2026-07-27']);
  assert.notEqual(s, a);
});
