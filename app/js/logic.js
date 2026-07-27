// Pure logic shared by browser and Node tests. No DOM, no I/O.

export function formatDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayLocal(now = new Date()) {
  return formatDateLocal(now);
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return formatDateLocal(new Date(y, m - 1, d + days));
}

export function sortByDate(entries) {
  return [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export const KG_PER_LB = 0.45359237;

export function kgToLbs(kg) {
  return kg / KG_PER_LB;
}

export function lbsToKg(lbs) {
  return lbs * KG_PER_LB;
}

export function parseWeightToKg(raw, unit) {
  const n = Number(String(raw).trim().replace(',', '.'));
  if (!Number.isFinite(n) || String(raw).trim() === '') {
    return { ok: false, error: 'Enter a number' };
  }
  const kg = unit === 'lbs' ? lbsToKg(n) : n;
  if (kg < 30 || kg > 300) {
    return { ok: false, error: 'Weight out of range (30 to 300 kg)' };
  }
  return { ok: true, kg: Math.round(kg * 100) / 100 };
}

export function entriesEqual(a, b) {
  if (a.length !== b.length) return false;
  const sa = sortByDate(a);
  const sb = sortByDate(b);
  return sa.every((e, i) =>
    e.date === sb[i].date &&
    e.weightKg === sb[i].weightKg &&
    (e.note || '') === (sb[i].note || '') &&
    e.updatedAt === sb[i].updatedAt
  );
}

export function mergeEntries(local, remote) {
  const byDate = new Map();
  for (const e of remote) byDate.set(e.date, e);
  for (const e of local) {
    const r = byDate.get(e.date);
    if (!r || e.updatedAt > r.updatedAt) byDate.set(e.date, e);
  }
  const merged = sortByDate([...byDate.values()]);
  return { merged, pushNeeded: !entriesEqual(merged, remote) };
}

export function movingAverage(entries, windowDays = 7) {
  const sorted = sortByDate(entries);
  return sorted.map((e) => {
    const from = addDays(e.date, -(windowDays - 1));
    const inWindow = sorted.filter((x) => x.date >= from && x.date <= e.date);
    const avg = inWindow.reduce((s, x) => s + x.weightKg, 0) / inWindow.length;
    return { date: e.date, avgKg: Math.round(avg * 100) / 100 };
  });
}

export function computeStats(entries, goalKg) {
  if (entries.length === 0) return null;
  const trend = movingAverage(entries);
  const current = trend[trend.length - 1];
  const cutoff = addDays(current.date, -30);
  const past = [...trend].reverse().find((t) => t.date <= cutoff) || null;
  const round = (n) => Math.round(n * 100) / 100;
  return {
    trendKg: current.avgKg,
    change30dKg: past ? round(current.avgKg - past.avgKg) : null,
    toGoalKg: goalKg == null ? null : round(current.avgKg - goalKg),
  };
}
