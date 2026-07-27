import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderChartSVG } from '../app/js/chart.js';

const E = (date, kg) => ({ date, weightKg: kg, note: '', updatedAt: `${date}T08:00:00Z` });
const entries = [E('2026-07-01', 83.2), E('2026-07-10', 82.8), E('2026-07-20', 82.5), E('2026-07-27', 82.4)];

test('renders one dot per visible entry plus a trend polyline', () => {
  const svg = renderChartSVG({ entries });
  assert.equal((svg.match(/<circle/g) || []).length, 4);
  assert.ok(svg.includes('<polyline'));
});

test('goal line renders only when a goal is set', () => {
  assert.ok(renderChartSVG({ entries, goalKg: 78 }).includes('stroke-dasharray'));
  assert.ok(!renderChartSVG({ entries }).includes('stroke-dasharray'));
});

test('rangeDays clips old entries; 0 shows all', () => {
  const withOld = [E('2026-01-01', 90), ...entries];
  assert.equal((renderChartSVG({ entries: withOld, rangeDays: 90 }).match(/<circle/g) || []).length, 4);
  assert.equal((renderChartSVG({ entries: withOld, rangeDays: 0 }).match(/<circle/g) || []).length, 5);
});

test('empty entries render an empty svg without crashing', () => {
  const svg = renderChartSVG({ entries: [] });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(!svg.includes('<circle'));
});

test('lbs unit converts axis labels', () => {
  const svg = renderChartSVG({ entries, unit: 'lbs' });
  // 83.2 kg is ~183.4 lb; axis max label must be in the lb range, not kg
  assert.ok(/18\d\.\d/.test(svg));
});
