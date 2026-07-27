// Chart geometry and SVG for the trend chart (viewBox 330×190, Clai design).
// computeChart is pure: alive entries in, geometry out. The caller applies
// any tag filter before calling, so the trend line reflects the filter.

import { movingAverage, kgToLbs, sortByDate, addDays, dayNum, timeFrac, shortDate } from './logic.js';

export const RANGE_KEYS = [['1W', '1W'], ['1M', '1M'], ['3M', '3M'], ['6M', '6M'], ['1Y', '1Y'], ['All', 'All'], ['Custom', 'C']];
const RANGE_DAYS = { '1W': 7, '1M': 30, '3M': 91, '6M': 183, '1Y': 365, All: 1e9 };

export function computeChart({ entries, goalKg = null, unit = 'kg', rangeKey = '3M', cFrom = null, cTo = null }) {
  const base = sortByDate(entries);
  if (base.length < 2) return { empty: true };
  const disp = (kg) => (unit === 'lbs' ? kgToLbs(kg) : kg);
  const trendAll = movingAverage(base);
  const lastDate = base[base.length - 1].date;

  let vis;
  if (rangeKey === 'C' && cFrom && cTo) {
    vis = base.filter((e) => e.date >= cFrom && e.date <= cTo);
  } else {
    const from = addDays(lastDate, -(RANGE_DAYS[rangeKey] ?? 91));
    vis = base.filter((e) => e.date >= from);
  }
  if (vis.length < 2) vis = base.slice(-7);
  const i0 = base.indexOf(vis[0]);
  const visTrend = trendAll.slice(i0, i0 + vis.length).map((t) => t.avgKg);

  // x = day number + time-of-day fraction, so zoomed views place points
  // at their actual time
  const W = 330, H = 190, pL = 32, pR = 8, pT = 12, pB = 24;
  const tf = (e) => dayNum(e.date) + timeFrac(e.time);
  const t0 = tf(vis[0]), t1 = tf(vis[vis.length - 1]);
  let lo = Math.min(...vis.map((e) => e.weightKg), ...visTrend);
  let hi = Math.max(...vis.map((e) => e.weightKg), ...visTrend);
  if (goalKg != null && goalKg > lo - 2 && goalKg < hi + 2) {
    lo = Math.min(lo, goalKg);
    hi = Math.max(hi, goalKg);
  }
  lo -= 0.6; hi += 0.6;
  const X = (v) => pL + (v - t0) / (t1 - t0 || 1) * (W - pL - pR);
  const Y = (kg) => pT + (hi - kg) / (hi - lo) * (H - pT - pB);
  const pts = vis.map((e, i) => ({ x: X(tf(e)), y: Y(e.weightKg), ty: Y(visTrend[i]), e }));
  const line = (get) => pts.map((p, i) => (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + get(p).toFixed(1)).join(' ');
  const rawPath = line((p) => p.y);
  const trendPath = line((p) => p.ty);
  const areaPath = trendPath + ' L' + pts[pts.length - 1].x.toFixed(1) + ',' + (H - pB) + ' L' + pts[0].x.toFixed(1) + ',' + (H - pB) + ' Z';
  const showGoal = goalKg != null && goalKg >= lo && goalKg <= hi;
  const goalY = goalKg != null ? Y(goalKg) : 0;
  const yTicks = [hi - 0.6, (hi + lo) / 2, lo + 0.6].map((kg) => ({
    y: +Y(kg).toFixed(1), ty: +(Y(kg) + 3).toFixed(1), label: disp(kg).toFixed(1),
  }));
  const xi = [...new Set([0, Math.floor(pts.length / 2), pts.length - 1])];
  const xLabels = xi.map((i) => ({ x: +Math.min(Math.max(pts[i].x, 20), 310).toFixed(1), label: shortDate(vis[i].date) }));
  const showDots = pts.length <= 40;
  // per-point times only when zoomed in far enough to read them
  let timeLabels = [];
  if (t1 - t0 <= 8 && pts.length <= 14) {
    timeLabels = pts.filter((p) => p.e.time).map((p) => ({
      x: +Math.min(Math.max(p.x, 44), 312).toFixed(1),
      y: +(p.y - 9 < 10 ? p.y + 16 : p.y - 9).toFixed(1),
      label: p.e.time,
    }));
  }
  return {
    empty: false, pts, rawPath, trendPath, areaPath,
    showGoal, goalY: +goalY.toFixed(1), goalTextY: +(goalY - 5).toFixed(1),
    goalLabel: goalKg != null ? disp(goalKg).toFixed(1) : '',
    yTicks, xLabels, timeLabels, showDots,
    dots: pts.map((p) => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1) })),
  };
}

export function chartSVG(c, accent = '#ff4d8b') {
  if (c.empty) return '';
  return `<svg id="chart" viewBox="0 0 330 190">
    ${c.yTicks.map((tk) => `<line x1="32" x2="324" y1="${tk.y}" y2="${tk.y}" stroke="#f0ead9" stroke-width="1"/><text x="2" y="${tk.ty}" class="tick">${tk.label}</text>`).join('')}
    ${c.showGoal ? `<line x1="32" x2="324" y1="${c.goalY}" y2="${c.goalY}" stroke="#1a3a3a" stroke-width="1.5" stroke-dasharray="5 4" opacity="0.5"/><text x="36" y="${c.goalTextY}" class="goal-lbl">GOAL ${c.goalLabel}</text>` : ''}
    <path d="${c.areaPath}" fill="${accent}" opacity="0.10"/>
    <path d="${c.rawPath}" fill="none" stroke="#c9c2ae" stroke-width="1.5" opacity="0.85"/>
    <path d="${c.trendPath}" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    ${c.showDots ? c.dots.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3.4" fill="#fffaf0" stroke="${accent}" stroke-width="2"/>`).join('') : ''}
    <line id="scrub-line" x1="0" x2="0" y1="8" y2="168" stroke="#0a0a0a" stroke-width="1" opacity="0.3" style="display:none"/>
    <circle id="scrub-dot" cx="0" cy="0" r="5.5" fill="${accent}" stroke="#fffaf0" stroke-width="2.5" style="display:none"/>
    ${c.timeLabels.map((tl) => `<text x="${tl.x}" y="${tl.y}" class="time-lbl" text-anchor="middle">${tl.label}</text>`).join('')}
    ${c.xLabels.map((xl) => `<text x="${xl.x}" y="187" class="tick" text-anchor="middle">${xl.label}</text>`).join('')}
  </svg>`;
}
