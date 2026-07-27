# Weight Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An offline-first PWA for logging daily weight on a phone, with a private GitHub repo as the durable datastore.

**Architecture:** Static vanilla-JS app served from GitHub Pages. IndexedDB on the device is the source of truth; a sync layer reconciles it with a single `data.json` in a private GitHub repo via the Contents API. Pure logic lives in dependency-free ES modules tested with Node's built-in test runner.

**Tech Stack:** HTML/CSS/vanilla JS (ES modules), IndexedDB, Service Worker, GitHub Contents API, GitHub Pages, Node >= 18 for tests (`node --test`), `gh` CLI for deployment.

**Spec:** `docs/superpowers/specs/2026-07-27-weight-tracker-design.md`

## Global Constraints

- Zero runtime dependencies. No frameworks, no chart libraries, no third-party scripts, no build step. Every byte served is code written in this project.
- Weights are stored canonically in **kg**, rounded to 2 decimals. Valid input range: **30 to 300 kg**.
- `entry.date` is the **local** calendar date `"YYYY-MM-DD"` built from `getFullYear()/getMonth()+1/getDate()`. `toISOString()` is **forbidden** for calendar dates. It IS the correct choice for the `updatedAt` timestamp (a point in time, not a calendar date).
- Merge rule: one entry per date; on collision the newest `updatedAt` wins.
- Moving average windows over the trailing **7 calendar days**, never the last 7 array entries.
- The service worker caches **same-origin GET app-shell requests only** and never intercepts cross-origin requests (`api.github.com` always hits the live network).
- `data.json` in the data repo has the shape `{"entries": [...]}`.
- No secrets ever enter the app repo. The token lives only in the browser's localStorage.
- Entry object shape everywhere: `{ date: "YYYY-MM-DD", weightKg: number, note: string, updatedAt: ISO-8601 string }`.
- Tests run from the project root: `npm test` (pins `TZ=America/New_York` so UTC-shift bugs surface).
- Project layout: `app/` is the deployable site root; `tests/` and `scripts/` stay outside it.

---

### Task 1: Scaffold + date logic

**Files:**
- Create: `package.json`
- Create: `app/js/logic.js`
- Test: `tests/logic.dates.test.mjs`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `formatDateLocal(d: Date): string`, `todayLocal(now?: Date): string`, `addDays(dateStr: string, days: number): string`, `sortByDate(entries): entries` (new sorted array, ascending by `date`)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "weight-tracker",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "TZ=America/New_York node --test tests/"
  }
}
```

- [ ] **Step 2: Verify Node version**

Run: `node --version`
Expected: v18 or higher. If lower, stop and report.

- [ ] **Step 3: Write the failing test**

`tests/logic.dates.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateLocal, todayLocal, addDays, sortByDate } from '../app/js/logic.js';

test('formatDateLocal uses local components, not UTC', () => {
  // 2026-01-01T04:30Z is 2025-12-31 23:30 in America/New_York (the test TZ)
  const d = new Date('2026-01-01T04:30:00Z');
  assert.equal(formatDateLocal(d), '2025-12-31');
  assert.notEqual(formatDateLocal(d), d.toISOString().slice(0, 10));
});

test('formatDateLocal pads month and day', () => {
  assert.equal(formatDateLocal(new Date(2026, 2, 5)), '2026-03-05');
});

test('todayLocal formats a provided now', () => {
  assert.equal(todayLocal(new Date(2026, 6, 27, 23, 55)), '2026-07-27');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-07-27', -6), '2026-07-21');
});

test('sortByDate returns a new ascending array', () => {
  const a = [{ date: '2026-07-27' }, { date: '2026-07-25' }];
  const s = sortByDate(a);
  assert.deepEqual(s.map((e) => e.date), ['2026-07-25', '2026-07-27']);
  assert.notEqual(s, a);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find module `app/js/logic.js`.

- [ ] **Step 5: Write minimal implementation**

`app/js/logic.js`:

```js
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
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json app/js/logic.js tests/logic.dates.test.mjs
git commit -m "feat: scaffold weight tracker with local-date logic"
```

---

### Task 2: Units and input validation

**Files:**
- Modify: `app/js/logic.js`
- Test: `tests/logic.units.test.mjs`

**Interfaces:**
- Consumes: nothing new
- Produces: `KG_PER_LB` (0.45359237), `kgToLbs(kg): number`, `lbsToKg(lbs): number`, `parseWeightToKg(raw: string, unit: 'kg'|'lbs'): {ok:true, kg:number} | {ok:false, error:string}`

- [ ] **Step 1: Write the failing test**

`tests/logic.units.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kgToLbs, lbsToKg, parseWeightToKg } from '../app/js/logic.js';

test('kg/lbs conversion round trip', () => {
  assert.ok(Math.abs(kgToLbs(80) - 176.37) < 0.01);
  assert.ok(Math.abs(lbsToKg(kgToLbs(82.4)) - 82.4) < 1e-9);
});

test('parseWeightToKg accepts comma decimals', () => {
  assert.deepEqual(parseWeightToKg('82,4', 'kg'), { ok: true, kg: 82.4 });
});

test('parseWeightToKg converts lbs to canonical kg', () => {
  const r = parseWeightToKg('180', 'lbs');
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.kg - 81.65) < 0.01);
});

test('parseWeightToKg rounds to 2 decimals', () => {
  assert.deepEqual(parseWeightToKg('82.456', 'kg'), { ok: true, kg: 82.46 });
});

test('parseWeightToKg rejects junk and out-of-range values', () => {
  assert.equal(parseWeightToKg('abc', 'kg').ok, false);
  assert.equal(parseWeightToKg('', 'kg').ok, false);
  assert.equal(parseWeightToKg('12', 'kg').ok, false);
  assert.equal(parseWeightToKg('500', 'kg').ok, false);
  assert.equal(parseWeightToKg('50', 'lbs').ok, false); // 22.7 kg, below floor
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, `kgToLbs` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `app/js/logic.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/logic.js tests/logic.units.test.mjs
git commit -m "feat: unit conversion and weight input validation"
```

---

### Task 3: Merge logic

**Files:**
- Modify: `app/js/logic.js`
- Test: `tests/logic.merge.test.mjs`

**Interfaces:**
- Consumes: `sortByDate` from Task 1
- Produces: `entriesEqual(a, b): boolean` (order-insensitive), `mergeEntries(local, remote): { merged: Entry[], pushNeeded: boolean }` where `merged` is date-ascending and `pushNeeded` is true iff `merged` differs from `remote`

- [ ] **Step 1: Write the failing test**

`tests/logic.merge.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeEntries, entriesEqual } from '../app/js/logic.js';

const E = (date, kg, at, note = '') => ({ date, weightKg: kg, note, updatedAt: at });

test('newest updatedAt wins per date', () => {
  const local = [E('2026-07-27', 82.4, '2026-07-27T08:00:00Z')];
  const remote = [E('2026-07-27', 82.1, '2026-07-27T09:00:00Z')];
  const { merged, pushNeeded } = mergeEntries(local, remote);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].weightKg, 82.1);
  assert.equal(pushNeeded, false); // merged equals remote already
});

test('union of local-only and remote-only dates, sorted', () => {
  const local = [E('2026-07-27', 82.4, '2026-07-27T08:00:00Z')];
  const remote = [E('2026-07-25', 82.8, '2026-07-25T08:00:00Z')];
  const { merged, pushNeeded } = mergeEntries(local, remote);
  assert.deepEqual(merged.map((e) => e.date), ['2026-07-25', '2026-07-27']);
  assert.equal(pushNeeded, true);
});

test('identical datasets need no push', () => {
  const a = [E('2026-07-25', 82.8, '2026-07-25T08:00:00Z'), E('2026-07-26', 82.6, '2026-07-26T08:00:00Z')];
  const { pushNeeded } = mergeEntries(a, [...a].reverse());
  assert.equal(pushNeeded, false);
});

test('entriesEqual treats missing note as empty', () => {
  assert.ok(entriesEqual(
    [{ date: '2026-07-27', weightKg: 82.4, updatedAt: 'x' }],
    [{ date: '2026-07-27', weightKg: 82.4, note: '', updatedAt: 'x' }]
  ));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, `mergeEntries` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `app/js/logic.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/logic.js tests/logic.merge.test.mjs
git commit -m "feat: date-keyed merge with newest-updatedAt-wins"
```

---

### Task 4: Trend math (moving average + stats)

**Files:**
- Modify: `app/js/logic.js`
- Test: `tests/logic.trend.test.mjs`

**Interfaces:**
- Consumes: `sortByDate`, `addDays` from Task 1
- Produces: `movingAverage(entries, windowDays = 7): Array<{date: string, avgKg: number}>` (one point per entry date, ascending), `computeStats(entries, goalKg: number|null): {trendKg, change30dKg: number|null, toGoalKg: number|null} | null`

- [ ] **Step 1: Write the failing test**

`tests/logic.trend.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, `movingAverage` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `app/js/logic.js`:

```js
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
    toGoalKg: goalKg ? round(current.avgKg - goalKg) : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/logic.js tests/logic.trend.test.mjs
git commit -m "feat: calendar-window moving average and stats"
```

---

### Task 5: GitHub Contents API client

**Files:**
- Create: `app/js/github.js`
- Test: `tests/github.test.mjs`

**Interfaces:**
- Consumes: nothing from other modules
- Produces: `class SyncError extends Error` with `kind: 'auth'|'conflict'|'network'|'data'`; `encodeContent(obj): string` (base64); `decodeContent(b64): object`; `pullData({repo, token, fetchFn?}): Promise<{entries: Entry[], sha: string|null}>` (404 means `{entries: [], sha: null}`); `pushData({repo, token, entries, sha, fetchFn?}): Promise<string>` (returns new sha)

- [ ] **Step 1: Write the failing test**

`tests/github.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pullData, pushData, encodeContent, decodeContent, SyncError } from '../app/js/github.js';

const fakeRes = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const E1 = { date: '2026-07-27', weightKg: 82.4, note: 'unicode test: 82°, café', updatedAt: '2026-07-27T08:00:00Z' };

test('encode/decode round-trips unicode', () => {
  assert.deepEqual(decodeContent(encodeContent({ entries: [E1] })), { entries: [E1] });
});

test('pullData returns empty dataset on 404 (first ever sync)', async () => {
  const r = await pullData({ repo: 'a/b', token: 't', fetchFn: async () => fakeRes(404, {}) });
  assert.deepEqual(r, { entries: [], sha: null });
});

test('pullData decodes content and returns sha', async () => {
  const body = { sha: 'abc', content: encodeContent({ entries: [E1] }) };
  const r = await pullData({ repo: 'a/b', token: 't', fetchFn: async () => fakeRes(200, body) });
  assert.equal(r.sha, 'abc');
  assert.deepEqual(r.entries, [E1]);
});

test('pullData maps 401 to SyncError kind auth', async () => {
  await assert.rejects(
    pullData({ repo: 'a/b', token: 't', fetchFn: async () => fakeRes(401, {}) }),
    (e) => e instanceof SyncError && e.kind === 'auth'
  );
});

test('pushData sends sha, auth header, and returns the new sha', async () => {
  let captured;
  const fetchFn = async (url, opts) => {
    captured = { url, opts };
    return fakeRes(200, { content: { sha: 'new' } });
  };
  const sha = await pushData({ repo: 'a/b', token: 'tok', entries: [E1], sha: 'old', fetchFn });
  assert.equal(sha, 'new');
  assert.ok(captured.url.endsWith('/repos/a/b/contents/data.json'));
  assert.equal(captured.opts.method, 'PUT');
  assert.equal(captured.opts.headers.Authorization, 'Bearer tok');
  const sent = JSON.parse(captured.opts.body);
  assert.equal(sent.sha, 'old');
  assert.deepEqual(decodeContent(sent.content), { entries: [E1] });
});

test('pushData omits sha when creating the file', async () => {
  let sent;
  const fetchFn = async (url, opts) => { sent = JSON.parse(opts.body); return fakeRes(201, { content: { sha: 's' } }); };
  await pushData({ repo: 'a/b', token: 't', entries: [], sha: null, fetchFn });
  assert.equal('sha' in sent, false);
});

test('pushData maps 409 and 422 to SyncError kind conflict', async () => {
  for (const status of [409, 422]) {
    await assert.rejects(
      pushData({ repo: 'a/b', token: 't', entries: [], sha: 'old', fetchFn: async () => fakeRes(status, {}) }),
      (e) => e instanceof SyncError && e.kind === 'conflict'
    );
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find module `app/js/github.js`.

- [ ] **Step 3: Write minimal implementation**

`app/js/github.js`:

```js
// GitHub Contents API client for data.json in the private data repo.
// fetchFn is injectable for tests; defaults to the global fetch.

const API = 'https://api.github.com';

export class SyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'SyncError';
    this.kind = kind; // 'auth' | 'conflict' | 'network' | 'data'
  }
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export function encodeContent(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj, null, 2));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decodeContent(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function classify(status) {
  if (status === 401 || status === 403) return new SyncError('auth', `GitHub auth failed (${status})`);
  if (status === 409 || status === 422) return new SyncError('conflict', `Stale sha (${status})`);
  return new SyncError('network', `GitHub responded ${status}`);
}

export async function pullData({ repo, token, fetchFn = fetch }) {
  const res = await fetchFn(`${API}/repos/${repo}/contents/data.json`, { headers: headers(token) });
  if (res.status === 404) return { entries: [], sha: null };
  if (!res.ok) throw classify(res.status);
  const body = await res.json();
  let data;
  try {
    data = decodeContent(body.content);
  } catch {
    throw new SyncError('data', 'data.json is not valid JSON; check the repo, git history has every prior version');
  }
  return { entries: Array.isArray(data.entries) ? data.entries : [], sha: body.sha };
}

export async function pushData({ repo, token, entries, sha, fetchFn = fetch }) {
  const res = await fetchFn(`${API}/repos/${repo}/contents/data.json`, {
    method: 'PUT',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `weight: ${entries.length} entries`,
      content: encodeContent({ entries }),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw classify(res.status);
  const body = await res.json();
  return body.content.sha;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/github.js tests/github.test.mjs
git commit -m "feat: GitHub Contents API client with typed sync errors"
```

---

### Task 6: Sync orchestration

**Files:**
- Create: `app/js/sync.js`
- Test: `tests/sync.test.mjs`

**Interfaces:**
- Consumes: `mergeEntries` (Task 3), `SyncError` (Task 5)
- Produces: `runSync({getLocal, saveLocal, pull, push, onStatus}): Promise<boolean>`. Dependency-injected: `getLocal(): Promise<Entry[]>`, `saveLocal(Entry[]): Promise<void>`, `pull(): Promise<{entries, sha}>`, `push(entries, sha): Promise<string>`, `onStatus(state: 'syncing'|'synced'|'pending'|'off', message?: string)` where `message` carries the failure reason on error states. Returns true on success. Dirty detection is implicit: the merge diff decides whether a push happens, so no dirty flag is stored (behavioral equivalent of the spec's dirty flag).

- [ ] **Step 1: Write the failing test**

`tests/sync.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSync } from '../app/js/sync.js';
import { SyncError } from '../app/js/github.js';

const E = (date, kg, at) => ({ date, weightKg: kg, note: '', updatedAt: at });

function harness({ local, remotes, pushImpls = [] }) {
  const calls = { saved: [], pushed: [], statuses: [] };
  let pullI = 0;
  let pushI = 0;
  return {
    calls,
    deps: {
      getLocal: async () => local,
      saveLocal: async (entries) => { calls.saved.push(entries); },
      pull: async () => {
        const r = remotes[Math.min(pullI, remotes.length - 1)];
        pullI += 1;
        if (r instanceof Error) throw r;
        return r;
      },
      push: async (entries, sha) => {
        calls.pushed.push({ entries, sha });
        const impl = pushImpls[Math.min(pushI, pushImpls.length - 1)];
        pushI += 1;
        if (impl instanceof Error) throw impl;
        return impl;
      },
      onStatus: (s) => calls.statuses.push(s),
    },
  };
}

test('no push when local already matches remote', async () => {
  const e = E('2026-07-27', 82.4, '2026-07-27T08:00:00Z');
  const h = harness({ local: [e], remotes: [{ entries: [e], sha: 's1' }] });
  assert.equal(await runSync(h.deps), true);
  assert.equal(h.calls.pushed.length, 0);
  assert.deepEqual(h.calls.statuses, ['syncing', 'synced']);
});

test('pushes local-only entries using the pulled sha', async () => {
  const e = E('2026-07-27', 82.4, '2026-07-27T08:00:00Z');
  const h = harness({ local: [e], remotes: [{ entries: [], sha: 's1' }], pushImpls: ['s2'] });
  assert.equal(await runSync(h.deps), true);
  assert.equal(h.calls.pushed.length, 1);
  assert.equal(h.calls.pushed[0].sha, 's1');
  assert.deepEqual(h.calls.saved.at(-1), [e]);
});

test('conflict triggers exactly one re-pull, re-merge, retry', async () => {
  const eL = E('2026-07-27', 82.4, '2026-07-27T08:00:00Z');
  const eR = E('2026-07-26', 82.6, '2026-07-26T08:00:00Z');
  const h = harness({
    local: [eL],
    remotes: [{ entries: [], sha: 's1' }, { entries: [eR], sha: 's2' }],
    pushImpls: [new SyncError('conflict', 'stale'), 's3'],
  });
  assert.equal(await runSync(h.deps), true);
  assert.equal(h.calls.pushed.length, 2);
  assert.equal(h.calls.pushed[1].sha, 's2');
  assert.deepEqual(h.calls.pushed[1].entries.map((x) => x.date), ['2026-07-26', '2026-07-27']);
  assert.equal(h.calls.statuses.at(-1), 'synced');
});

test('auth failure reports sync off and returns false', async () => {
  const h = harness({ local: [], remotes: [new SyncError('auth', 'bad token')] });
  assert.equal(await runSync(h.deps), false);
  assert.deepEqual(h.calls.statuses, ['syncing', 'off']);
});

test('network failure reports pending and returns false', async () => {
  const h = harness({ local: [], remotes: [new SyncError('network', '500')] });
  assert.equal(await runSync(h.deps), false);
  assert.deepEqual(h.calls.statuses, ['syncing', 'pending']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find module `app/js/sync.js`.

- [ ] **Step 3: Write minimal implementation**

`app/js/sync.js`:

```js
import { mergeEntries } from './logic.js';
import { SyncError } from './github.js';

// Pull, merge into local, push if the merge produced something remote lacks.
// On a stale-sha conflict: re-pull, re-merge, retry the push exactly once.
export async function runSync({ getLocal, saveLocal, pull, push, onStatus }) {
  onStatus('syncing');
  try {
    const local = await getLocal();
    const first = await pull();
    const m1 = mergeEntries(local, first.entries);
    await saveLocal(m1.merged);
    if (m1.pushNeeded) {
      try {
        await push(m1.merged, first.sha);
      } catch (e) {
        if (!(e instanceof SyncError) || e.kind !== 'conflict') throw e;
        const second = await pull();
        const m2 = mergeEntries(m1.merged, second.entries);
        await saveLocal(m2.merged);
        if (m2.pushNeeded) await push(m2.merged, second.sha);
      }
    }
    onStatus('synced');
    return true;
  } catch (e) {
    const state = e instanceof SyncError && e.kind === 'auth' ? 'off' : 'pending';
    onStatus(state, e.message);
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/sync.js tests/sync.test.mjs
git commit -m "feat: pull-merge-push sync with single conflict retry"
```

---

### Task 7: IndexedDB store

**Files:**
- Create: `app/js/store.js`
- Test: `tests/manual/store.html` (self-running browser test page)

**Interfaces:**
- Consumes: nothing from other modules
- Produces: `openDB(name = 'weight-tracker'): Promise<IDBDatabase>`, `getAllEntries(db): Promise<Entry[]>`, `putEntry(db, entry): Promise<void>` (keyPath `date`, so same-date put overwrites), `replaceAllEntries(db, entries): Promise<void>` (clear + bulk put, one transaction)

- [ ] **Step 1: Write the implementation**

`app/js/store.js`:

```js
// IndexedDB wrapper. Object store 'entries' is keyed by date, so one
// entry per calendar date is enforced by the storage layer itself.

export function openDB(name = 'weight-tracker') {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('entries', { keyPath: 'date' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(txn) {
  return new Promise((resolve, reject) => {
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
    txn.onabort = () => reject(txn.error);
  });
}

export function getAllEntries(db) {
  return new Promise((resolve, reject) => {
    const req = db.transaction('entries').objectStore('entries').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function putEntry(db, entry) {
  const txn = db.transaction('entries', 'readwrite');
  txn.objectStore('entries').put(entry);
  return done(txn);
}

export function replaceAllEntries(db, entries) {
  const txn = db.transaction('entries', 'readwrite');
  const os = txn.objectStore('entries');
  os.clear();
  for (const e of entries) os.put(e);
  return done(txn);
}
```

- [ ] **Step 2: Write the self-running browser test page**

`tests/manual/store.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>store.js test</title>
<pre id="out">running</pre>
<script type="module">
import { openDB, getAllEntries, putEntry, replaceAllEntries } from '../../app/js/store.js';
const out = document.getElementById('out');
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
try {
  await new Promise((res) => {
    const d = indexedDB.deleteDatabase('wt-test');
    d.onsuccess = d.onerror = d.onblocked = res;
  });
  const db = await openDB('wt-test');
  await putEntry(db, { date: '2026-07-27', weightKg: 82.4, note: '', updatedAt: '2026-07-27T08:00:00Z' });
  await putEntry(db, { date: '2026-07-27', weightKg: 82.1, note: 'x', updatedAt: '2026-07-27T09:00:00Z' });
  let all = await getAllEntries(db);
  assert(all.length === 1, 'same-date put must overwrite, got ' + all.length);
  assert(all[0].weightKg === 82.1, 'latest write must win');
  await replaceAllEntries(db, [
    { date: '2026-07-25', weightKg: 82.8, note: '', updatedAt: '2026-07-25T08:00:00Z' },
    { date: '2026-07-26', weightKg: 82.6, note: '', updatedAt: '2026-07-26T08:00:00Z' },
  ]);
  all = await getAllEntries(db);
  assert(all.length === 2, 'replaceAll must swap the dataset');
  out.textContent = 'PASS';
} catch (e) {
  out.textContent = 'FAIL: ' + e.message;
}
</script>
```

- [ ] **Step 3: Verify in a browser**

Run: `python3 -m http.server 8000` from the project root (background it), then open `http://localhost:8000/tests/manual/store.html` in a browser (Chrome DevTools MCP works for this).
Expected: page shows `PASS`.

- [ ] **Step 4: Commit**

```bash
git add app/js/store.js tests/manual/store.html
git commit -m "feat: IndexedDB entry store with browser test page"
```

---

### Task 8: SVG chart renderer

**Files:**
- Create: `app/js/chart.js`
- Test: `tests/chart.test.mjs`

**Interfaces:**
- Consumes: `movingAverage`, `addDays`, `kgToLbs`, `sortByDate` (Tasks 1, 2, 4)
- Produces: `renderChartSVG({entries, goalKg = null, unit = 'kg', rangeDays = 90, width = 360, height = 220}): string`. `rangeDays: 0` means all history. Trend is computed over ALL entries (so the window reaches back past the visible range) and then clipped for display.

- [ ] **Step 1: Write the failing test**

`tests/chart.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find module `app/js/chart.js`.

- [ ] **Step 3: Write minimal implementation**

`app/js/chart.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/js/chart.js tests/chart.test.mjs
git commit -m "feat: dependency-free SVG trend chart"
```

---

### Task 9: UI shell (HTML, CSS, app wiring)

**Files:**
- Create: `app/index.html`
- Create: `app/css/style.css`
- Create: `app/js/app.js`

**Interfaces:**
- Consumes: everything from Tasks 1 to 8: `todayLocal`, `parseWeightToKg`, `kgToLbs`, `computeStats` (logic.js); `renderChartSVG` (chart.js); `openDB`, `getAllEntries`, `putEntry`, `replaceAllEntries` (store.js); `pullData`, `pushData` (github.js); `runSync` (sync.js)
- Produces: the working app page. Config persisted at localStorage key `wt.config` as JSON `{repo, token, goalKg, unit}`.

- [ ] **Step 1: Write index.html**

`app/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Weight</title>
<meta name="theme-color" content="#0b1220">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="stylesheet" href="css/style.css">
</head>
<body>
<header>
  <h1>Weight</h1>
  <span id="sync-status" data-state="off">sync off</span>
  <button id="settings-btn" aria-label="Settings">&#9881;</button>
</header>
<main>
  <p id="sync-msg" role="status" hidden></p>
  <form id="entry-form" autocomplete="off">
    <input id="weight" inputmode="decimal" placeholder="82.4" aria-label="Weight" required>
    <span id="unit-label">kg</span>
    <input id="date" type="date" aria-label="Date">
    <input id="note" placeholder="note (optional)" maxlength="120" aria-label="Note">
    <button type="submit">Log</button>
    <p id="form-error" role="alert" hidden></p>
  </form>
  <p id="empty-hint" hidden>Log your first weight above; your trend will appear here.</p>
  <div id="chart-wrap"></div>
  <div id="range-row">
    <button type="button" data-range="30">30d</button>
    <button type="button" data-range="90" class="active">90d</button>
    <button type="button" data-range="0">all</button>
  </div>
  <div id="stats">
    <div><span id="stat-trend">&middot;</span><label>trend</label></div>
    <div><span id="stat-change">&middot;</span><label>30 days</label></div>
    <div><span id="stat-goal">&middot;</span><label>to goal</label></div>
  </div>
</main>
<dialog id="settings">
  <form method="dialog" id="settings-form">
    <h2>Settings</h2>
    <label>Goal weight (kg)
      <input id="cfg-goal" inputmode="decimal" placeholder="78">
    </label>
    <label>Unit
      <select id="cfg-unit">
        <option value="kg">kg</option>
        <option value="lbs">lbs</option>
      </select>
    </label>
    <label>Data repo (owner/name)
      <input id="cfg-repo" placeholder="you/weight-tracker-data">
    </label>
    <label>GitHub token (fine-grained, Contents read/write on the data repo only)
      <input id="cfg-token" type="password">
    </label>
    <div class="row">
      <button type="button" id="export-btn">Export JSON</button>
      <button id="save-settings" value="save">Save</button>
    </div>
  </form>
</dialog>
<script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write style.css**

`app/css/style.css`:

```css
:root {
  --bg: #0b1220;
  --surface: #131c2e;
  --border: #24304a;
  --text: #e6edf7;
  --muted: #8b98b3;
  --accent: #38bdf8;
  --good: #4ade80;
  --warn: #fbbf24;
  --danger: #f87171;
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body {
  margin: 0 auto;
  max-width: 480px;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.45 -apple-system, "SF Pro Text", "Segoe UI", sans-serif;
  padding: env(safe-area-inset-top) 16px calc(24px + env(safe-area-inset-bottom));
}
header { display: flex; align-items: center; gap: 10px; padding: 14px 0 6px; }
h1 { font-size: 20px; letter-spacing: 0.2px; margin: 0; flex: 1; }
#sync-status {
  font-size: 12px; color: var(--muted);
  border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px;
}
#sync-status[data-state="synced"] { color: var(--good); }
#sync-status[data-state="pending"] { color: var(--warn); }
#sync-status[data-state="syncing"] { color: var(--accent); }
#settings-btn { background: none; border: none; color: var(--muted); font-size: 20px; padding: 4px; cursor: pointer; }
#entry-form {
  display: grid; grid-template-columns: 1fr auto; gap: 10px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; padding: 14px; margin-top: 10px;
}
#weight {
  grid-column: 1; width: 100%;
  font-size: 32px; font-weight: 600;
  background: none; border: none; color: var(--text); outline: none;
}
#weight::placeholder { color: var(--border); }
#unit-label { align-self: center; color: var(--muted); font-size: 18px; }
#date, #note {
  grid-column: 1 / -1;
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); padding: 8px 10px; font-size: 14px;
  color-scheme: dark;
}
#entry-form button[type="submit"] {
  grid-column: 1 / -1;
  background: var(--accent); color: #06283d;
  font-weight: 700; font-size: 16px;
  border: none; border-radius: 10px; padding: 12px; cursor: pointer;
}
#form-error { grid-column: 1 / -1; color: var(--danger); font-size: 13px; margin: 0; }
#sync-msg { color: var(--warn); font-size: 12px; margin: 6px 0 0; text-align: center; }
#empty-hint { color: var(--muted); text-align: center; margin: 28px 0; }
.chart { width: 100%; height: auto; margin-top: 18px; }
.chart .dot { fill: var(--accent); opacity: 0.55; }
.chart .trend { stroke: var(--text); stroke-width: 2; }
.chart .goal { stroke: var(--good); stroke-width: 1.5; }
.chart .axis { fill: var(--muted); font-size: 10px; }
#range-row { display: flex; gap: 8px; justify-content: center; margin-top: 8px; }
#range-row button {
  background: none; border: 1px solid var(--border); color: var(--muted);
  border-radius: 999px; padding: 4px 14px; font-size: 13px; cursor: pointer;
}
#range-row button.active { color: var(--text); border-color: var(--accent); }
#stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 18px; }
#stats > div {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 12px; padding: 12px 8px; text-align: center;
}
#stats span { display: block; font-size: 17px; font-weight: 650; }
#stats label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
dialog {
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: 14px;
  width: min(92vw, 420px); padding: 18px;
}
dialog::backdrop { background: rgb(0 0 0 / 0.6); }
dialog h2 { margin: 0 0 12px; font-size: 17px; }
dialog label { display: block; font-size: 13px; color: var(--muted); margin-bottom: 10px; }
dialog input, dialog select {
  display: block; width: 100%; margin-top: 4px;
  background: var(--bg); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text); padding: 8px 10px; font-size: 15px;
}
dialog .row { display: flex; gap: 10px; margin-top: 14px; }
dialog .row button {
  flex: 1; border-radius: 10px; padding: 10px; cursor: pointer;
  border: 1px solid var(--border); background: none; color: var(--text);
}
dialog .row #save-settings { background: var(--accent); color: #06283d; border: none; font-weight: 700; }
```

- [ ] **Step 3: Write app.js**

`app/js/app.js`:

```js
import { todayLocal, parseWeightToKg, kgToLbs, computeStats } from './logic.js';
import { renderChartSVG } from './chart.js';
import { openDB, getAllEntries, putEntry, replaceAllEntries } from './store.js';
import { pullData, pushData } from './github.js';
import { runSync } from './sync.js';

const CONFIG_KEY = 'wt.config';
const $ = (id) => document.getElementById(id);

let db;
let config = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
let rangeDays = 90;

function saveConfig() {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function fmtWeight(kg) {
  return config.unit === 'lbs' ? `${kgToLbs(kg).toFixed(1)} lb` : `${kg.toFixed(1)} kg`;
}

function setStatus(state, msg = '') {
  const el = $('sync-status');
  el.dataset.state = state;
  el.textContent = { syncing: 'syncing', synced: 'synced', pending: 'pending', off: 'sync off' }[state];
  const m = $('sync-msg');
  m.textContent = msg;
  m.hidden = !msg;
}

async function render() {
  const entries = await getAllEntries(db);
  $('empty-hint').hidden = entries.length > 0;
  $('chart-wrap').innerHTML = entries.length
    ? renderChartSVG({ entries, goalKg: config.goalKg ?? null, unit: config.unit || 'kg', rangeDays })
    : '';
  const stats = computeStats(entries, config.goalKg ?? null);
  $('stat-trend').textContent = stats ? fmtWeight(stats.trendKg) : '·';
  $('stat-change').textContent = stats && stats.change30dKg !== null
    ? `${stats.change30dKg >= 0 ? '+' : '-'}${fmtWeight(Math.abs(stats.change30dKg))}`
    : '·';
  $('stat-goal').textContent = stats && stats.toGoalKg !== null
    ? `${fmtWeight(Math.abs(stats.toGoalKg))}${stats.toGoalKg > 0 ? '' : ' past'}`
    : '·';
  $('unit-label').textContent = config.unit === 'lbs' ? 'lb' : 'kg';
}

async function sync() {
  if (!config.token || !config.repo) { setStatus('off'); return; }
  if (!navigator.onLine) { setStatus('pending'); return; }
  const ok = await runSync({
    getLocal: () => getAllEntries(db),
    saveLocal: (entries) => replaceAllEntries(db, entries),
    pull: () => pullData({ repo: config.repo, token: config.token }),
    push: (entries, sha) => pushData({ repo: config.repo, token: config.token, entries, sha }),
    onStatus: (state, msg) => setStatus(state, msg),
  });
  if (ok) render();
}

function showFormError(msg) {
  const el = $('form-error');
  el.textContent = msg || '';
  el.hidden = !msg;
}

async function onSubmit(e) {
  e.preventDefault();
  const parsed = parseWeightToKg($('weight').value, config.unit || 'kg');
  if (!parsed.ok) { showFormError(parsed.error); return; }
  showFormError('');
  await putEntry(db, {
    date: $('date').value || todayLocal(),
    weightKg: parsed.kg,
    note: $('note').value.trim(),
    updatedAt: new Date().toISOString(),
  });
  $('weight').value = '';
  $('note').value = '';
  $('date').value = todayLocal();
  await render();
  sync();
}

function openSettings() {
  $('cfg-goal').value = config.goalKg ?? '';
  $('cfg-unit').value = config.unit || 'kg';
  $('cfg-repo').value = config.repo || '';
  $('cfg-token').value = config.token || '';
  $('settings').showModal();
}

function saveSettings() {
  const goal = Number(String($('cfg-goal').value).replace(',', '.'));
  config.goalKg = Number.isFinite(goal) && goal > 0 ? goal : null;
  config.unit = $('cfg-unit').value;
  config.repo = $('cfg-repo').value.trim();
  config.token = $('cfg-token').value.trim();
  saveConfig();
  render();
  sync();
}

async function exportJson() {
  const entries = await getAllEntries(db);
  const blob = new Blob([JSON.stringify({ entries }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `weight-export-${todayLocal()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function main() {
  db = await openDB();
  $('date').value = todayLocal();
  $('entry-form').addEventListener('submit', onSubmit);
  $('settings-btn').addEventListener('click', openSettings);
  $('save-settings').addEventListener('click', saveSettings);
  $('export-btn').addEventListener('click', exportJson);
  document.querySelectorAll('#range-row button').forEach((b) =>
    b.addEventListener('click', () => {
      rangeDays = Number(b.dataset.range);
      document.querySelectorAll('#range-row button').forEach((x) => x.classList.toggle('active', x === b));
      render();
    })
  );
  window.addEventListener('online', sync);
  await render();
  sync();
}

main();
```

- [ ] **Step 4: Verify in a browser**

Run: `python3 -m http.server 8000` from the project root, open `http://localhost:8000/app/`.

Checks (browser console or Chrome DevTools MCP):
1. Empty state hint is visible, stats show the placeholder dot, status pill says "sync off".
2. Log an entry: type a weight, press Log. Entry form clears, chart area appears (single dot), trend stat updates.
3. Seed history to exercise the chart, in the console:

```js
const { openDB, putEntry } = await import('./js/store.js');
const db = await openDB();
for (let i = 0; i < 60; i++) {
  const d = new Date(); d.setDate(d.getDate() - i);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await putEntry(db, { date, weightKg: 84 - i * 0.05 + (i % 3) * 0.3, note: '', updatedAt: new Date().toISOString() });
}
location.reload();
```

4. Chart shows dots, a smoother trend line, and range toggles change the visible span.
5. Set a goal in settings: goal line appears, "to goal" stat fills in.
6. Invalid input ("abc", "12") shows the inline error and saves nothing.
7. Export JSON downloads a file containing the entries.
8. Clean up seeded data: `indexedDB.deleteDatabase('weight-tracker')` in the console, reload.

- [ ] **Step 5: Commit**

```bash
git add app/index.html app/css/style.css app/js/app.js
git commit -m "feat: mobile-first UI shell wiring form, chart, stats, settings"
```

---

### Task 10: PWA layer (manifest, icons, service worker)

**Files:**
- Create: `app/manifest.webmanifest`
- Create: `scripts/make-icons.mjs`
- Create: `app/icons/icon-192.png`, `app/icons/icon-512.png`, `app/icons/apple-touch-icon.png` (generated)
- Create: `app/sw.js`
- Modify: `app/js/app.js` (register the service worker in `main()`)

**Interfaces:**
- Consumes: the asset paths created in Task 9
- Produces: installable PWA; offline app shell; guarantee that `api.github.com` is never intercepted

- [ ] **Step 1: Write the manifest**

`app/manifest.webmanifest`:

```json
{
  "name": "Weight",
  "short_name": "Weight",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#0b1220",
  "theme_color": "#0b1220",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: Write the icon generator**

Dependency-free PNG writer (no image libraries installed or wanted). Icon: dark background, ascending trend line with three dots.

`scripts/make-icons.mjs`:

```js
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function distToSeg(px, py, [x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function makePng(size) {
  const pts = [[0.24, 0.7], [0.5, 0.55], [0.76, 0.32]].map(([a, b]) => [a * size, b * size]);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter byte: none
    for (let x = 0; x < size; x++) {
      let px = [15, 23, 42]; // background #0f172a
      if (distToSeg(x, y, pts[0], pts[1]) < size * 0.04 || distToSeg(x, y, pts[1], pts[2]) < size * 0.04) {
        px = [56, 189, 248]; // accent line #38bdf8
      }
      for (const [cx, cy] of pts) {
        if ((x - cx) ** 2 + (y - cy) ** 2 < (size * 0.07) ** 2) px = [224, 242, 254]; // dots #e0f2fe
      }
      const o = row + 1 + x * 4;
      raw[o] = px[0];
      raw[o + 1] = px[1];
      raw[o + 2] = px[2];
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('app/icons', { recursive: true });
for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(`app/icons/${file}`, makePng(size));
  console.log(`wrote app/icons/${file}`);
}
```

- [ ] **Step 3: Generate and verify the icons**

Run: `node scripts/make-icons.mjs && file app/icons/*.png`
Expected: three lines of `PNG image data` with correct dimensions (192x192, 512x512, 180x180). Open one in a browser tab to eyeball it.

- [ ] **Step 4: Write the service worker**

`app/sw.js`:

```js
// App-shell cache, stale-while-revalidate. Cross-origin requests
// (api.github.com) are never intercepted: sync always hits the network.
const CACHE = 'wt-shell-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/logic.js',
  './js/chart.js',
  './js/store.js',
  './js/github.js',
  './js/sync.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const refresh = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || refresh;
    })
  );
});
```

- [ ] **Step 5: Register the service worker**

In `app/js/app.js`, add as the last lines of `main()` (after `sync();`):

```js
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
```

- [ ] **Step 6: Verify offline behavior**

With `python3 -m http.server 8000` running, in Chrome (or Chrome DevTools MCP):
1. Open `http://localhost:8000/app/`, confirm in DevTools > Application > Service Workers that `sw.js` is activated.
2. DevTools > Network > set Offline. Reload the page.
Expected: app loads from cache, entries render from IndexedDB, status pill shows "pending" or "sync off", no crash.
3. In DevTools > Application > Cache Storage > `wt-shell-v1`: confirm NO entry whose URL contains `api.github.com`.
4. Set Online again, reload, confirm normal load.

- [ ] **Step 7: Run full test suite (regression check)**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 8: Commit**

```bash
git add app/manifest.webmanifest scripts/make-icons.mjs app/icons app/sw.js app/js/app.js
git commit -m "feat: PWA layer with same-origin-only service worker"
```

---

### Task 11: Deployment and end-to-end verification

**Files:**
- Create: `.github/workflows/pages.yml`
- Also creates two GitHub repos under the `andriesneukermans-personal` account and deploys `app/` via GitHub Actions.

**Interfaces:**
- Consumes: the complete `app/` directory
- Produces: live site at `https://andriesneukermans-personal.github.io/weight-tracker/`, private repo `andriesneukermans-personal/weight-tracker-data`

**Note:** this project directory IS the app repo (`/Users/andries/Claude/weight-tracker`). Pages cannot serve an `/app` subfolder directly, so an Actions workflow publishes `app/` as the Pages artifact. Push to main = deploy. The user's SSH key belongs to a different GitHub account; all git/API auth for this account goes through `gh` (HTTPS).

- [ ] **Step 1: Preflight**

```bash
gh auth status
OWNER=$(gh api user --jq .login)
echo "$OWNER"
```

Expected: authenticated as `andriesneukermans-personal` and that login printed. If not authenticated or the wrong account, stop and ask the user to run `! gh auth login` (HTTPS protocol, the andriesneukermans-personal account, yes to configuring git credentials).

- [ ] **Step 2: Create the private data repo**

```bash
gh repo create "$OWNER/weight-tracker-data" --private --description "Weight tracker data" --add-readme
gh repo view "$OWNER/weight-tracker-data" --json visibility --jq .visibility
```

Expected: second command prints `PRIVATE`. Stop immediately if it does not.

- [ ] **Step 3: Add the Pages deploy workflow**

`.github/workflows/pages.yml`:

```yaml
name: Deploy Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: app
      - id: deployment
        uses: actions/deploy-pages@v4
```

```bash
git add .github/workflows/pages.yml
git commit -m "ci: deploy app/ to GitHub Pages"
```

- [ ] **Step 4: Create the app repo, enable workflow-based Pages, push, wait for deploy**

```bash
gh repo create "$OWNER/weight-tracker" --public --source . --push
gh api -X POST "repos/$OWNER/weight-tracker/pages" -f build_type=workflow
gh run watch --exit-status || { echo "Pages workflow failed"; gh run view --log-failed; }
curl -sI "https://$OWNER.github.io/weight-tracker/" | head -1
```

Expected: workflow completes successfully and the final curl prints `HTTP/2 200`. If the Pages API call says Pages is already enabled, that is fine. Future deploys are just `git push`.

- [ ] **Step 5: User creates the token (user action, blocked on them)**

Ask the user to create the token and paste it when running the E2E check:

> On github.com: Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token. Name: `weight-tracker`. Expiration: 1 year. Repository access: "Only select repositories" > `weight-tracker-data`. Permissions > Repository permissions > Contents: **Read and write**. Generate and copy it.

- [ ] **Step 6: End-to-end sync test**

1. Open `https://$OWNER.github.io/weight-tracker/` in a desktop browser.
2. Settings: repo `OWNER/weight-tracker-data`, paste the token, Save.
3. Log a test entry (for example weight `82.4`, note `e2e test`).
4. Verify the commit landed:

```bash
gh api "repos/$OWNER/weight-tracker-data/contents/data.json" --jq .content | base64 -d
```

Expected: JSON with the test entry.
5. Reload the app page: entry still there, status pill `synced`.
6. Remove the test entry by resetting `data.json`:

```bash
SHA=$(gh api "repos/$OWNER/weight-tracker-data/contents/data.json" --jq .sha)
gh api -X PUT "repos/$OWNER/weight-tracker-data/contents/data.json" \
  -f message="reset after e2e test" \
  -f content="$(printf '{\n  "entries": []\n}' | base64)" \
  -f sha="$SHA"
```

Then in the desktop browser: DevTools console `indexedDB.deleteDatabase('weight-tracker')`, reload, confirm the empty state (otherwise the next sync would push the test entry right back).

- [ ] **Step 7: Phone installation (user action)**

Ask the user to, on their iPhone: open the Pages URL in Safari, open Settings in the app, enter repo and token, Save; then Share > Add to Home Screen. Log a real first entry and confirm the status pill reaches `synced`.

- [ ] **Step 8: Commit any doc touch-ups and close out**

```bash
git add -A
git commit -m "chore: deployment notes after going live" || true
```

Report the live URL, both repo URLs, and token expiry date to the user.
