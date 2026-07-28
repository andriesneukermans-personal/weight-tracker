import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeChart, chartSVG } from '../app/js/chart.js';

const E = (date, kg, time) => ({ date, weightKg: kg, note: '', time, updatedAt: `${date}T08:00:00Z` });
const entries = [E('2026-07-01', 83.2), E('2026-07-10', 82.8), E('2026-07-20', 82.5), E('2026-07-27', 82.4)];

test('renders one dot per visible entry plus raw and trend paths', () => {
  const c = computeChart({ entries, rangeKey: 'All' });
  assert.equal(c.pts.length, 4);
  const svg = chartSVG(c);
  // 4 data dots + 1 hidden scrub dot
  assert.equal((svg.match(/<circle/g) || []).length, 5);
  assert.ok(c.rawPath.startsWith('M'));
  assert.ok(c.trendPath.startsWith('M'));
});

test('goal line renders only when a goal is set and in range', () => {
  assert.ok(chartSVG(computeChart({ entries, goalKg: 82.6, rangeKey: 'All' })).includes('stroke-dasharray'));
  assert.ok(!chartSVG(computeChart({ entries, rangeKey: 'All' })).includes('stroke-dasharray'));
  // far outside the visible band: no line
  assert.equal(computeChart({ entries, goalKg: 60, rangeKey: 'All' }).showGoal, false);
});

test('range keys clip old entries; All shows everything', () => {
  const withOld = [E('2026-01-01', 90), ...entries];
  assert.equal(computeChart({ entries: withOld, rangeKey: '3M' }).pts.length, 4);
  assert.equal(computeChart({ entries: withOld, rangeKey: 'All' }).pts.length, 5);
});

test('custom range filters between the two dates', () => {
  const c = computeChart({ entries, rangeKey: 'C', cFrom: '2026-07-05', cTo: '2026-07-21' });
  assert.equal(c.pts.length, 2);
});

test('fewer than 2 entries reports empty and renders no svg', () => {
  assert.equal(computeChart({ entries: [] }).empty, true);
  assert.equal(computeChart({ entries: entries.slice(0, 1) }).empty, true);
  assert.equal(chartSVG(computeChart({ entries: [] })), '');
});

test('lbs unit converts axis tick labels', () => {
  const c = computeChart({ entries, unit: 'lbs', rangeKey: 'All' });
  // 83.2 kg is ~183.4 lb; the top tick must be in the lb range, not kg
  assert.ok(c.yTicks.some((t) => /18\d\.\d/.test(t.label)));
});

test('time labels appear only when the visible span is short', () => {
  const week = [E('2026-07-21', 82.9, '07:10'), E('2026-07-23', 82.7, '18:05'), E('2026-07-26', 82.5, '06:55')];
  const zoomed = computeChart({ entries: week, rangeKey: '1W' });
  assert.equal(zoomed.timeLabels.length, 3);
  assert.ok(zoomed.timeLabels.some((t) => t.label === '18:05'));
  const wide = computeChart({ entries: [...entries, ...week], rangeKey: 'All' });
  assert.equal(wide.timeLabels.length, 0);
});

test('several weigh-ins on one day chart as distinct points, ordered by time', () => {
  const day = [
    E('2026-07-25', 82.9, '07:00'),
    E('2026-07-26', 82.2, '07:05'),
    E('2026-07-26', 83.0, '20:00'),
  ];
  const c = computeChart({ entries: day, rangeKey: '1W' });
  assert.equal(c.pts.length, 3);
  const [, morning, evening] = c.pts;
  assert.ok(morning.x < evening.x);
  // both same-day points share the day's trend value
  assert.equal(morning.ty, evening.ty);
});

test('entries without a time still chart (no label, day-start position)', () => {
  const week = [E('2026-07-24', 82.9), E('2026-07-26', 82.5, '06:55')];
  const c = computeChart({ entries: week, rangeKey: '1W' });
  assert.equal(c.pts.length, 2);
  assert.equal(c.timeLabels.length, 1);
});
