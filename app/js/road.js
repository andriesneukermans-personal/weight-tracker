// Journey road for the Goal screen (Clai design): a serpentine staircase of
// quarter-kg clay tiles climbing from the starting weight (bottom) up to the
// goal (top), with the traveler's position driven by the 7-day trend. Pure
// like chart.js: computeRoad is geometry in, model out; roadSVG turns the
// model into a string. The avatar is NOT rendered here — roadview.js overlays
// it as a positioned div so animations survive re-renders.

import { fmtWeight, kgToLbs } from './logic.js';

const STEP_KG = 0.25;
const EPS = 1e-9;
const W = 330;
const Y0 = 50; // topmost node's y (the goal)
const DY = 52; // vertical gap per tile
const XMID = 165, XAMP = 76, PERIOD = 8; // x = XMID + XAMP·sin(k·2π/PERIOD)

const isWholeKg = (w) => Math.abs(w - Math.round(w)) < 1e-6;

/* Per-edge cubic Bézier segments of a Catmull-Rom spline through pts,
   each computed with full-neighbor context so any prefix of segments
   overlays the full path exactly (doneD must sit on pathD). */
function catmullSegments(pts) {
  const at = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    segs.push(`C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`);
  }
  return segs;
}

export function computeRoad({ startKg = null, goalKg = null, trendKg = null, unit = 'kg' } = {}) {
  const sig = `${startKg}|${goalKg}|${unit}`;
  if (startKg == null || trendKg == null) return { state: 'noEntries', sig };
  if (goalKg == null) return { state: 'noGoal', sig };
  if (goalKg >= startKg - EPS) return { state: 'gaining', sig };

  // tiles anchored to the goal so whole-kg checkpoints land on tiles even
  // when the start is off-grid (the first tile is then a partial step)
  const steps = Math.ceil((startKg - goalKg) / STEP_KG - EPS);
  const weights = [startKg];
  for (let i = 1; i <= steps; i++) weights.push(goalKg + (steps - i) * STEP_KG);

  const reached = trendKg <= goalKg + EPS;
  const state = reached ? 'reached' : 'ok';

  // done nodes form a prefix (weights strictly decrease); d = last done
  let d = 0;
  for (let i = 0; i <= steps; i++) if (trendKg <= weights[i] + EPS) d = i;
  if (trendKg > weights[0] + EPS) d = 0; // above the start: pinned to node 0
  let frac = 0;
  if (!reached && d < steps && trendKg <= weights[0] + EPS) {
    frac = Math.max(0, Math.min(1, (weights[d] - trendKg) / (weights[d] - weights[d + 1])));
    if (frac >= 1) frac = 0; // trend exactly on the next tile counts as done there
  }
  const avatarPos = reached ? steps : d + frac;
  const avatarNode = Math.floor(avatarPos);

  const label = (w) => (unit === 'kg' ? `${Math.round(w)} kg` : `${Math.round(kgToLbs(w))} lbs`);
  const disp = (w) => fmtWeight(unit === 'kg' ? w : kgToLbs(w));
  const nodes = weights.map((w, k) => {
    // climb: the start sits at the bottom, the goal at the top
    const kind = k === 0 ? 'start' : k === steps ? 'goal' : isWholeKg(w) ? 'checkpoint' : 'step';
    const n = {
      x: XMID + XAMP * Math.sin(k * 2 * Math.PI / PERIOD),
      y: Y0 + (steps - k) * DY,
      w, kind,
      status: reached || trendKg <= w + EPS || k === 0 ? 'done' : 'todo',
    };
    if (kind === 'checkpoint') n.label = label(w);
    if (kind === 'start') n.under = `Start ${disp(w)}`;
    if (kind === 'goal') n.under = `Goal ${disp(w)}`;
    if (k === avatarNode + 1 && frac > 0) n.arcFrac = frac;
    return n;
  });

  const segs = catmullSegments(nodes);
  const start = `M${nodes[0].x.toFixed(1)},${nodes[0].y.toFixed(1)}`;
  return {
    state, W, H: nodes[0].y + Y0,
    pathD: start + ' ' + segs.join(' '),
    doneD: avatarNode > 0 ? start + ' ' + segs.slice(0, avatarNode).join(' ') : '',
    nodes, steps, avatarPos, avatarNode, sig,
  };
}

// Floating isometric clay tiles from the Clai design handoff: rounded
// square squashed by scale(1 0.62) rotate(45), a 0.72-darkened extruded
// side offset below, and a soft ground shadow. The dotted path winds
// through the tile centers; scenery fills the serpentine pockets.
const SZ = { start: 34, step: 34, checkpoint: 34, goal: 40 };
const MINT = '#a4d4c5', PINK = '#ff4d8b', GOLD = '#e8b94a', FUTURE = '#f5f0e0';

const darken = (h, f = 0.72) =>
  '#' + [1, 3, 5].map((p) => Math.round(parseInt(h.slice(p, p + 2), 16) * f).toString(16).padStart(2, '0')).join('');

function isoTile(n, fill, stroke) {
  const s = SZ[n.kind], hs = (-s / 2).toFixed(1), sw = s.toFixed(1);
  const x = n.x.toFixed(1), y = n.y.toFixed(1);
  const lift = n.kind === 'goal' ? 7 : 6;
  const rect = (ty, f, st) => `<rect x="${hs}" y="${hs}" width="${sw}" height="${sw}" rx="8"
    transform="translate(${x} ${ty}) scale(1 0.62) rotate(45)" fill="${f}"${st ? ` stroke="${st}" stroke-width="2"` : ''}/>`;
  return `<ellipse cx="${x}" cy="${(n.y + 16).toFixed(1)}" rx="${(s * 0.78).toFixed(1)}" ry="5.5" fill="rgba(10,10,10,0.10)"/>` +
    rect((n.y + lift).toFixed(1), darken(fill)) + rect(y, fill, stroke);
}

function nodeSVG(n, i, next) {
  const done = n.status === 'done';
  const isNext = i === next;
  const fill = done ? MINT : isNext ? PINK : n.kind === 'goal' ? GOLD : FUTURE;
  const stroke = done || isNext ? '#fffaf0' : '#e0d9c4';
  let mark = '', markC = '#9a9a9a', fs = 13;
  if (done) { mark = '✓'; markC = '#0a1a1a'; fs = n.kind === 'goal' ? 16 : 13; }
  else if (n.kind === 'goal') { mark = '★'; markC = '#6a4a10'; fs = 16; }
  else if (n.kind === 'checkpoint') { mark = n.label.split(' ')[0]; markC = isNext ? '#ffffff' : '#9a9a9a'; }
  const texts =
    (mark ? `<text class="rmark" x="${n.x.toFixed(1)}" y="${(n.y + 4.5).toFixed(1)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${markC}">${mark}</text>` : '') +
    (n.under ? `<text class="runder" x="${n.x.toFixed(1)}" y="${(n.y + 31).toFixed(1)}" text-anchor="middle">${n.under}</text>` : '');
  return `<g class="rnode rnode-${n.kind} ${n.status}" data-i="${i}">${isoTile(n, fill, stroke)}${texts}</g>`;
}

/* Clay scenery from the design handoff, recentered so each piece sits on
   (0,0) at its ground line; placed in the pockets the serpentine leaves
   open (tiles at the right extreme free the left margin and vice versa). */
const PROPS = [
  `<g class="rprop"><ellipse rx="28" ry="7" fill="#eee7d2"/><rect x="-4.5" y="-30" width="9" height="28" rx="4" fill="#b8865a"/>
    <circle cy="-46" r="22" fill="#7fbfa5"/><circle cx="-16" cy="-33" r="12" fill="#a4d4c5"/><circle cx="17" cy="-35" r="11" fill="#a4d4c5"/>
    <circle cx="-9" cy="-50" r="3" fill="#ff4d8b"/><circle cx="7" cy="-56" r="3" fill="#ff4d8b"/><circle cx="10" cy="-40" r="2.5" fill="#fffaf0"/></g>`,
  `<g class="rprop"><ellipse rx="40" ry="16" fill="#aed0e6"/><ellipse cy="-3" rx="27" ry="10" fill="#c9e0ef"/>
    <circle cx="12" cy="-6" r="4" fill="#7fbfa5"/><path d="M-34 -8 q-3 -14 2 -22" stroke="#7fbfa5" stroke-width="3" fill="none" stroke-linecap="round"/>
    <path d="M-26 -6 q3 -12 -1 -20" stroke="#a4d4c5" stroke-width="3" fill="none" stroke-linecap="round"/></g>`,
  `<g class="rprop"><rect x="-6" y="-10" width="6" height="10" rx="3" fill="#fffaf0" stroke="#e0d9c4" stroke-width="1"/>
    <path d="M-14 -8 q11 -16 22 0 Z" fill="#e8b94a"/><rect x="10" y="-6" width="5" height="8" rx="2.5" fill="#fffaf0" stroke="#e0d9c4" stroke-width="1"/>
    <path d="M4 -4 q8 -12 17 0 Z" fill="#e8b94a"/></g>`,
  `<g class="rprop"><ellipse rx="30" ry="7" fill="#eee7d2"/><circle cx="-12" cy="-18" r="16" fill="#a4d4c5"/>
    <circle cx="10" cy="-14" r="12" fill="#7fbfa5"/><circle cx="-2" cy="-27" r="3" fill="#ff4d8b"/><circle cx="11" cy="-20" r="2.5" fill="#ff4d8b"/></g>`,
];

function scenery(m) {
  const out = [];
  let p = 0;
  for (let k = 0; k < m.nodes.length; k++) {
    const phase = k % PERIOD;
    if (phase !== 2 && phase !== 6) continue;
    if (k < 2 || k > m.nodes.length - 2) continue;
    const cx = phase === 2 ? 52 : 278; // tiles sit at the opposite extreme
    out.push(`<g transform="translate(${cx} ${(m.nodes[k].y + 14).toFixed(1)})">${PROPS[p++ % PROPS.length]}</g>`);
  }
  // confetti around the goal tile
  const g = m.nodes[m.nodes.length - 1];
  out.push(`<g class="rprop" transform="translate(${g.x.toFixed(1)} ${g.y.toFixed(1)})">
    <circle cx="-62" cy="-12" r="2.5" fill="#e8b94a"/><circle cx="55" cy="8" r="2.5" fill="#b8a4ed"/>
    <circle cx="-38" cy="-30" r="3" fill="#ff4d8b"/><rect x="38" y="-32" width="6" height="6" rx="1.5" fill="#e8b94a" transform="rotate(20 41 -29)"/>
    <rect x="-70" y="18" width="6" height="6" rx="1.5" fill="#a4d4c5" transform="rotate(-15 -67 21)"/></g>`);
  return out.join('');
}

export function roadSVG(m) {
  if (m.state !== 'ok' && m.state !== 'reached') return '';
  const next = m.state === 'ok' ? m.nodes.findIndex((n) => n.status === 'todo') : -1;
  // paint back-to-front: the goal is farthest away, the start nearest
  const tiles = m.nodes.map((n, i) => nodeSVG(n, i, next)).reverse().join('');
  return `<svg class="road-svg" viewBox="0 0 ${m.W} ${m.H}">
    <path d="${m.pathD}" stroke="#d8d2c0" stroke-width="3" stroke-dasharray="1 11" fill="none" stroke-linecap="round"/>
    ${scenery(m)}${tiles}</svg>`;
}
