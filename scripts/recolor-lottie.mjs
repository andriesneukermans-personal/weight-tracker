// Recolor a Lottie JSON to the Clai palette at build time. Walks every
// solid fill/stroke (static and keyframed) and maps the source color to
// the nearest entry in MAP; exact hits use the explicit pair, misses fall
// back to nearest-by-RGB-distance among MAP keys, so a re-export with a
// slightly different yellow still lands on the same Clai color.
// Usage: node scripts/recolor-lottie.mjs in.json out.json
import { readFileSync, writeFileSync } from 'node:fs';

// source → Clai. Keys come from the shipped Zubulig files; values only
// use app palette colors and shades derived from them.
const MAP = {
  '#faac0f': '#ffb084', // body yellow → peach (reminder card)
  '#fabb0f': '#ffb084',
  '#ffc832': '#ffc9a8', // light yellow → light peach
  '#ffde00': '#ffc9a8', // celebration bits → light peach
  '#eb8928': '#e8946a', // shadow orange → deep peach
  '#e50069': '#ff4d8b', // magenta → Clai pink
  '#260826': '#1a3a3a', // dark purple lines → dark teal
  '#333333': '#1a3a3a',
  '#666666': '#6a6a6a',
  '#fff8da': '#fffaf0', // pale cream → Clai cream
  '#ffffff': '#fffaf0',
};

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const ENTRIES = Object.entries(MAP).map(([src, dst]) => ({ src: hex2rgb(src), dst: hex2rgb(dst) }));

function mapColor(rgb) {
  let best = null, bd = Infinity;
  for (const e of ENTRIES) {
    const d = e.src.reduce((s, c, i) => s + (c - rgb[i]) ** 2, 0);
    if (d < bd) { bd = d; best = e.dst; }
  }
  return best;
}

const isRGB = (k) => Array.isArray(k) && k.length >= 3 && k.slice(0, 3).every((x) => typeof x === 'number');

function recolorProp(c) {
  if (!c || typeof c !== 'object') return;
  if (c.a === 1 && Array.isArray(c.k)) {
    for (const kf of c.k) {
      for (const key of ['s', 'e']) {
        if (isRGB(kf[key])) kf[key] = [...mapColor(kf[key]), ...kf[key].slice(3)];
      }
    }
  } else if (isRGB(c.k)) {
    c.k = [...mapColor(c.k), ...c.k.slice(3)];
  }
}

let solids = 0, gradients = 0;
function walk(o) {
  if (Array.isArray(o)) { o.forEach(walk); return; }
  if (!o || typeof o !== 'object') return;
  if (o.ty === 'fl' || o.ty === 'st') { recolorProp(o.c); solids++; }
  if (o.ty === 'gf' || o.ty === 'gs') gradients++; // none expected; flagged, not mapped
  for (const v of Object.values(o)) walk(v);
}

const [, , inFile, outFile] = process.argv;
if (!inFile || !outFile) { console.error('usage: recolor-lottie.mjs in.json out.json'); process.exit(1); }
const doc = JSON.parse(readFileSync(inFile, 'utf8'));
walk(doc.layers ?? []);
walk(doc.assets ?? []);
writeFileSync(outFile, JSON.stringify(doc));
console.log(`recolored ${solids} solid fills/strokes → ${outFile}${gradients ? ` (WARNING: ${gradients} gradients untouched)` : ''}`);
