import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEntries, entriesEqual } from '../app/js/logic.js';

const E = (date, kg, at, note = '') => ({ date, weightKg: kg, note, updatedAt: at });

test('newest updatedAt wins per date', () => {
  const local = [E('2026-07-27', 82.4, '2026-07-27T08:00:00Z')];
  const remote = [E('2026-07-27', 82.1, '2026-07-27T09:00:00Z')];
  const { merged, pushNeeded } = mergeEntries(local, remote);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].weightKg, 82.1);
  assert.equal(pushNeeded, false); // merged equals remote already
});

test('union of local-only and remote-only dates, sorted', () => {
  const local = [E('2026-07-27', 82.4, '2026-07-27T08:00:00Z')];
  const remote = [E('2026-07-25', 82.8, '2026-07-25T08:00:00Z')];
  const { merged, pushNeeded } = mergeEntries(local, remote);
  assert.deepEqual(merged.map((e) => e.date), ['2026-07-25', '2026-07-27']);
  assert.equal(pushNeeded, true);
});

test('identical datasets need no push', () => {
  const a = [E('2026-07-25', 82.8, '2026-07-25T08:00:00Z'), E('2026-07-26', 82.6, '2026-07-26T08:00:00Z')];
  const { pushNeeded } = mergeEntries(a, [...a].reverse());
  assert.equal(pushNeeded, false);
});

test('two weigh-ins on the same date both survive the merge', () => {
  const T = (date, time, kg, at) => ({ id: `${date}#${time}`, date, time, weightKg: kg, updatedAt: at });
  const local = [T('2026-07-27', '07:10', 82.4, '2026-07-27T07:10:00Z')];
  const remote = [T('2026-07-27', '19:30', 83.1, '2026-07-27T19:30:00Z')];
  const { merged } = mergeEntries(local, remote);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((e) => e.time), ['07:10', '19:30']);
});

test('legacy entries without ids merge stably by their derived id', () => {
  const local = [{ date: '2026-07-27', weightKg: 82.4, updatedAt: '2026-07-27T08:00:00Z' }];
  const remote = [{ date: '2026-07-27', weightKg: 82.1, updatedAt: '2026-07-27T09:00:00Z' }];
  const { merged } = mergeEntries(local, remote);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].weightKg, 82.1);
  assert.equal(merged[0].id, '2026-07-27');
});

test('entriesEqual treats missing note as empty', () => {
  assert.ok(entriesEqual(
    [{ date: '2026-07-27', weightKg: 82.4, updatedAt: 'x' }],
    [{ date: '2026-07-27', weightKg: 82.4, note: '', updatedAt: 'x' }]
  ));
});
