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

// One weigh-in per (date, time); untimed entries (legacy or backdated)
// use the bare date as id, so old data keeps its identity.
export function entryId(e) {
  return e.id || (e.time ? `${e.date}#${e.time}` : e.date);
}

export function sortByDate(entries) {
  const key = (e) => e.date + '#' + (e.time || '');
  return [...entries].sort((a, b) => (key(a) < key(b) ? -1 : 1));
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
    entryId(e) === entryId(sb[i]) &&
    e.date === sb[i].date &&
    e.weightKg === sb[i].weightKg &&
    (e.note || '') === (sb[i].note || '') &&
    (e.time || '') === (sb[i].time || '') &&
    JSON.stringify(e.tags || []) === JSON.stringify(sb[i].tags || []) &&
    e.updatedAt === sb[i].updatedAt
  );
}

export function mergeEntries(local, remote) {
  const norm = (e) => (e.id ? e : { ...e, id: entryId(e) });
  const byId = new Map();
  for (const e of remote) { const n = norm(e); byId.set(n.id, n); }
  for (const e of local) {
    const n = norm(e);
    const r = byId.get(n.id);
    if (!r || n.updatedAt > r.updatedAt) byId.set(n.id, n);
  }
  const merged = sortByDate([...byId.values()]);
  return { merged, pushNeeded: !entriesEqual(merged, remote) };
}

// One trend point per day. Days with several weigh-ins contribute their
// mean, so a heavy-logging day counts the same as a single measurement.
export function dayMeans(entries) {
  const byDay = new Map();
  for (const e of sortByDate(entries)) {
    if (!byDay.has(e.date)) byDay.set(e.date, []);
    byDay.get(e.date).push(e.weightKg);
  }
  const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
  return [...byDay.entries()].map(([date, ws]) => ({ date, meanKg: mean(ws) }));
}

export function movingAverage(entries, windowDays = 7) {
  const days = dayMeans(entries);
  return days.map((d, i) => {
    const from = addDays(d.date, -(windowDays - 1));
    const win = days.filter((x) => x.date >= from && x.date <= d.date);
    const avg = win.reduce((s, x) => s + x.meanKg, 0) / win.length;
    return { date: d.date, avgKg: Math.round(avg * 100) / 100 };
  });
}

// Streak of consecutive calendar days ending at the last entry; stale
// (last entry before yesterday) means the streak is over.
export function streakOf(entries, todayIso) {
  const sorted = sortByDate(entries);
  if (sorted.length === 0) return 0;
  const nums = [...new Set(sorted.map((e) => dayNum(e.date)))];
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

// Declared tag rules ("when would you use this tag?") collected at tag
// creation. They are cold-start priors only: a rule fires when the current
// moment matches its window, and is silenced as soon as real logging
// history exists near that hour (same gate as the built-in morning default).
const RULE_HOURS = { morning: [4.5, 10], afternoon: [10, 17], evening: [17, 22], night: [22, 4.5] };

export function ruleMatches(rule, hour, dow) {
  if (rule.time) {
    const win = RULE_HOURS[rule.time];
    if (!win) return false;
    const [a, b] = win;
    const inWin = a < b ? hour >= a && hour < b : hour >= a || hour < b;
    if (!inWin) return false;
  }
  if (rule.days === 'weekday' && (dow === 0 || dow === 6)) return false;
  if (rule.days === 'weekend' && dow >= 1 && dow <= 5) return false;
  return true;
}

/* Estimate tags for a new weigh-in — fully local, no network.
   Past weigh-ins vote for the tags they carry, weighted by recency
   (~3-week half-life) and by how close their time of day is to now
   (gaussian kernel, ±90 min window); a same-weekday vote runs alongside.
   A tag needs a weighted majority, so a handful of consistent recent logs
   trains a new pattern and consistently untagged logging unlearns one.
   A fixed early-morning default covers the cold start until there is
   enough history near that hour. Returns at most the two strongest. */
export function suggestTags(entries, now = new Date(), rules = {}) {
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
  // declared rules are gated only by history logged AFTER the tag was
  // created; entries from before it existed cannot argue against it
  for (const [tag, rule] of Object.entries(rules)) {
    if (!rule || !ruleMatches(rule, hour, dow)) continue;
    let sinceW = 0;
    for (const e of entries) {
      if (!e.time) continue;
      if (rule.since && e.date < rule.since) continue;
      const [h, m] = e.time.split(':').map(Number);
      let d = Math.abs(h + m / 60 - hour);
      d = Math.min(d, 24 - d);
      if (d > 1.5) continue;
      sinceW += recency(e) * kernel(d);
    }
    if (sinceW < 1.5) add(tag, 1);
  }

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
