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

export function parseDateLocal(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dayNum(dateStr) {
  return Math.round(parseDateLocal(dateStr).getTime() / 86400000);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

export function hhmm(now = new Date()) {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

export function timeFrac(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h * 60 + m) / 1440;
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
    (e.time || '') === (sb[i].time || '') &&
    JSON.stringify(e.tags || []) === JSON.stringify(sb[i].tags || []) &&
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

// Streak of consecutive calendar days ending at the last entry; stale
// (last entry before yesterday) means the streak is over.
export function streakOf(entries, todayIso) {
  const sorted = sortByDate(entries);
  if (sorted.length === 0) return 0;
  const nums = sorted.map((e) => dayNum(e.date));
  if (nums[nums.length - 1] < dayNum(todayIso) - 1) return 0;
  let streak = 1;
  for (let i = nums.length - 2; i >= 0; i--) {
    if (nums[i + 1] - nums[i] === 1) streak++;
    else break;
  }
  return streak;
}

// Project the 7-day trend's slope over the last ~8 weeks onto the goal.
export function forecast(entries, goalKg) {
  if (entries.length < 2) return { kind: 'flat' };
  const trend = movingAverage(entries);
  const last = trend[trend.length - 1];
  if (goalKg == null) return { kind: 'noGoal' };
  if (last.avgKg <= goalKg) return { kind: 'atGoal' };
  const from = addDays(last.date, -55);
  const first = trend.find((t) => t.date >= from) || trend[0];
  const days = dayNum(last.date) - dayNum(first.date) || 1;
  const slope = (last.avgKg - first.avgKg) / days;
  if (slope < -0.004) {
    const need = (last.avgKg - goalKg) / -slope;
    if (need < 500) return { kind: 'onTrack', date: addDays(last.date, Math.round(need)) };
    return { kind: 'slow' };
  }
  return { kind: 'flat' };
}

export const NOTE_CHIPS = ['First thing in the morning', 'After workout', 'After partying', 'Traveling', 'Cheat day'];

/* Estimate tags for a new weigh-in — fully local, no network.
   Past weigh-ins vote for the tags they carry, weighted by recency
   (~3-week half-life) and by how close their time of day is to now
   (gaussian kernel, ±90 min window); a same-weekday vote runs alongside.
   A tag needs a weighted majority, so a handful of consistent recent logs
   trains a new pattern and consistently untagged logging unlearns one.
   A fixed early-morning default covers the cold start until there is
   enough history near that hour. Returns at most the two strongest. */
export function suggestTags(entries, now = new Date()) {
  const hour = now.getHours() + now.getMinutes() / 60;
  const dow = now.getDay();
  const todayN = dayNum(formatDateLocal(now));
  const recency = (e) => Math.pow(0.5, Math.max(0, todayN - dayNum(e.date)) / 21);
  const kernel = (d) => Math.exp(-((d / 0.75) ** 2));
  const present = new Set();
  for (const e of entries) for (const t of e.tags || []) present.add(t);
  const candidates = NOTE_CHIPS.filter((t) => present.has(t))
    .concat([...present].filter((t) => !NOTE_CHIPS.includes(t)));
  const scores = new Map();
  const add = (tag, s) => scores.set(tag, Math.max(scores.get(tag) || 0, s));

  let nearW = 0;
  const nearTagW = new Map();
  for (const e of entries) {
    if (!e.time) continue;
    const [h, m] = e.time.split(':').map(Number);
    let d = Math.abs(h + m / 60 - hour);
    d = Math.min(d, 24 - d);
    if (d > 1.5) continue;
    const w = recency(e) * kernel(d);
    nearW += w;
    for (const tag of e.tags || []) nearTagW.set(tag, (nearTagW.get(tag) || 0) + w);
  }
  const sameDow = entries.filter((e) => parseDateLocal(e.date).getDay() === dow);
  const dowW = sameDow.reduce((s, e) => s + recency(e), 0);
  const allW = entries.reduce((s, e) => s + recency(e), 0);
  for (const tag of candidates) {
    const nw = nearTagW.get(tag) || 0;
    const dw = sameDow.filter((e) => (e.tags || []).includes(tag)).reduce((s, e) => s + recency(e), 0);
    const gw = entries.filter((e) => (e.tags || []).includes(tag)).reduce((s, e) => s + recency(e), 0);
    if (nearW >= 1.5 && nw / nearW > 0.5) add(tag, nw);
    // weekday vote fires only on a real weekday habit: the tag must be a
    // minority overall yet at least twice as common on this weekday, else
    // globally frequent tags get suggested at any hour on noisy samples
    const gRate = gw / (allW || 1);
    if (dowW >= 2 && gRate < 0.5 && dw / dowW > 0.6 && dw / dowW > 2 * gRate) add(tag, dw);
  }
  if (nearW < 1.5 && hour >= 4.5 && hour < 10) add('First thing in the morning', 1);

  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t);
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
