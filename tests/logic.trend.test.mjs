import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movingAverage, computeStats } from '../app/js/logic.js';

const E = (date, kg) => ({ date, weightKg: kg, note: '', updatedAt: `${date}T08:00:00Z` });

test('moving average windows over calendar days, not array offsets', () => {
  const entries = [E('2026-01-01', 80), E('2026-01-02', 81), E('2026-01-03', 82), E('2026-01-20', 90)];
  const trend = movingAverage(entries);
  assert.deepEqual(trend.map((t) => t.date), ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-20']);
  assert.equal(trend[1].avgKg, 80.5); // (80+81)/2, both within Jan 2 window
  assert.equal(trend[2].avgKg, 81);   // (80+81+82)/3
  // After a 17-day gap the window contains only the Jan 20 entry.
  // An index-based implementation would blend in the January 1-3 entries.
  assert.equal(trend[3].avgKg, 90);
});

test('computeStats: trend, 30-day change, distance to goal', () => {
  const entries = [E('2026-01-01', 90), E('2026-02-15', 85)];
  const s = computeStats(entries, 80);
  assert.equal(s.trendKg, 85);        // trailing window at Feb 15 holds only that entry
  assert.equal(s.change30dKg, -5);    // vs trend point at/before Jan 16, which is Jan 1
  assert.equal(s.toGoalKg, 5);        // 85 - 80
});

test('computeStats handles missing history and goal', () => {
  assert.equal(computeStats([], 80), null);
  const s = computeStats([E('2026-07-27', 82.4)], null);
  assert.equal(s.change30dKg, null);
  assert.equal(s.toGoalKg, null);
});

test('computeStats treats goalKg 0 as a real goal, not missing', () => {
  const s = computeStats([E('2026-07-27', 82.4)], 0);
  assert.equal(s.toGoalKg, 82.4);
});
