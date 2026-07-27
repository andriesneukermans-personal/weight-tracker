import { movingAverage, addDays, kgToLbs, sortByDate } from './logic.js';

function dayNum(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round(new Date(y, m - 1, d).getTime() / 86400000);
}

export function renderChartSVG({ entries, goalKg = null, unit = 'kg', rangeDays = 90, width = 360, height = 220 }) {
  if (entries.length === 0) {
    return `<svg viewBox="0 0 ${width} ${height}" class="chart empty"></svg>`;
  }
  const disp = (kg) => (unit === 'lbs' ? kgToLbs(kg) : kg);
  const sorted = sortByDate(entries);
  const lastDate = sorted[sorted.length - 1].date;
  const fromDate = rangeDays ? addDays(lastDate, -(rangeDays - 1)) : sorted[0].date;
  const visible = sorted.filter((e) => e.date >= fromDate);
  const trend = movingAverage(sorted).filter((t) => t.date >= fromDate);

  const pad = { top: 12, right: 12, bottom: 24, left: 40 };
  const x0 = dayNum(visible[0].date);
  const x1 = Math.max(dayNum(lastDate), x0 + 1);
  const ys = visible.map((e) => e.weightKg).concat(goalKg !== null ? [goalKg] : []);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (yMax - yMin < 2) { yMin -= 1; yMax += 1; }
  const spread = yMax - yMin;
  yMin -= spread * 0.08;
  yMax += spread * 0.08;

  const X = (dateStr) => pad.left + ((dayNum(dateStr) - x0) / (x1 - x0)) * (width - pad.left - pad.right);
  const Y = (kg) => pad.top + (1 - (kg - yMin) / (yMax - yMin)) * (height - pad.top - pad.bottom);

  const dots = visible
    .map((e) => `<circle cx="${X(e.date).toFixed(1)}" cy="${Y(e.weightKg).toFixed(1)}" r="3" class="dot"/>`)
    .join('');
  const line = trend.map((t) => `${X(t.date).toFixed(1)},${Y(t.avgKg).toFixed(1)}`).join(' ');
  const goal = goalKg !== null
    ? `<line x1="${pad.left}" y1="${Y(goalKg).toFixed(1)}" x2="${width - pad.right}" y2="${Y(goalKg).toFixed(1)}" class="goal" stroke-dasharray="4 4"/>`
    : '';
  const labels =
    `<text x="4" y="${(pad.top + 8).toFixed(1)}" class="axis">${disp(yMax).toFixed(1)}</text>` +
    `<text x="4" y="${(height - pad.bottom).toFixed(1)}" class="axis">${disp(yMin).toFixed(1)}</text>` +
    `<text x="${pad.left}" y="${height - 6}" class="axis">${visible[0].date}</text>` +
    `<text x="${width - pad.right}" y="${height - 6}" text-anchor="end" class="axis">${lastDate}</text>`;
  return `<svg viewBox="0 0 ${width} ${height}" class="chart">${goal}<polyline points="${line}" class="trend" fill="none"/>${dots}${labels}</svg>`;
}
