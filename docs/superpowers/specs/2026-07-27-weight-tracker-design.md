# Weight Tracker: Design

Date: 2026-07-27
Status: approved by Andries (pending spec review)

## Purpose

A personal, single-user app for Andries to log daily weight from his phone and see the trend over time. Optimized for zero maintenance and no data loss; not a product, not multi-user.

## Decision summary

- **Stack: offline-first PWA hosted on GitHub Pages, with a private GitHub repo as the durable datastore.**
- Alternatives considered: Claude Artifact + Notion datastore (rejected: cannot work offline, ties daily use to claude.ai login); browser-only localStorage (rejected: single device, data loss on browser wipe); self-hosted server (rejected: maintenance overkill for one user).
- Deciding factors: offline logging must work, data must survive device loss, and Andries prefers a standard stack he owns end to end.

## Architecture

Two GitHub repos:

1. **App repo** (`weight-tracker`): static HTML/CSS/JS, PWA manifest, service worker. Deployed via GitHub Pages. Contains no secrets; safe to be public.
   - The service worker caches **same-origin app-shell assets only** (HTML, CSS, JS, manifest, icons). It never intercepts cross-origin requests, so all `api.github.com` traffic always hits the live network and is never served from or stored in the SW cache.
2. **Data repo** (`weight-tracker-data`, private): holds a single `data.json` with all entries. Git history doubles as versioned backup.

On the phone, IndexedDB is the source of truth. The app is fully functional with no network. A sync layer reconciles IndexedDB with `data.json` over the GitHub Contents API.

No external dependencies: no frameworks, no chart libraries, no third-party scripts. Every byte served is code written in this project. This is both a simplicity choice and the XSS mitigation that makes the token handling acceptable.

## Data model

Entry (stored in IndexedDB and in `data.json`):

```json
{
  "date": "2026-07-27",
  "weightKg": 82.4,
  "note": "after holiday",
  "updatedAt": "2026-07-27T08:12:00Z"
}
```

- One entry per calendar date; logging again on the same date overwrites that date's entry.
- The entry date is the **local** calendar date, built from `getFullYear()`/`getMonth()+1`/`getDate()`. Never derive it via `toISOString()`, which shifts to UTC and near midnight stamps the wrong day.
- Weight is always stored in kg. Display unit (kg/lbs) is a client-side preference.
- `note` is optional. `updatedAt` drives merge resolution.
- Optional `"deleted": true` marks a tombstone (created only by hand-editing `data.json`); tombstones merge like normal entries, may omit `weightKg`, and are hidden by the UI.
- Sync writes into IndexedDB atomically merge with the store's current contents in one transaction (never a blind replace), so an entry logged while a sync is in flight cannot be clobbered by the sync's stale snapshot.

Local-only settings (localStorage, deliberately not synced because they are trivially re-enterable): goal weight, display unit, GitHub token, data repo name.

## Sync

- **Pull on app open** (when online): fetch `data.json`, merge into IndexedDB per date with newest `updatedAt` wins.
- **Push after every local write** (when online): write the full merged dataset back as one commit. Use the file `sha` from the last read; on a 409 conflict, re-pull, re-merge, retry once.
- **Offline**: writes land in IndexedDB and are flagged dirty; the next successful pull-merge-push cycle flushes them. A visible indicator shows synced / pending / sync off.
- Full-file replacement is acceptable: single user, one small JSON file, at most a handful of writes per day.

## Auth

- Fine-grained GitHub personal access token, scoped to the data repo only, permission: Contents read/write.
- Entered once per device on a settings screen; stored in localStorage; sent only over HTTPS to `api.github.com`.
- Missing/expired/revoked token degrades to offline-only mode with the "sync off" indicator. Logging is never blocked by auth problems.
- Threat model accepted: token on a lost unlocked phone or leaked token exposes read/write on one private repo of weight numbers; recovery is one-click revocation.

## UI

Single mobile-first screen, top to bottom:

1. **Entry form**: weight input (numeric keypad, decimal), date defaulting to today, optional note field, save button.
2. **Trend chart**: hand-rolled inline SVG. Raw entries as dots, 7-day moving average as the trend line, horizontal goal line when a goal is set. Time range toggle (30d / 90d / all).
   - The moving average windows over the trailing **7 calendar days**, not the last 7 array entries; after logging gaps it averages only the entries that actually fall inside the window (a single entry in the window means the trend equals that entry).
3. **Stat row**: current trend weight, 30-day change, distance to goal.
4. **Settings** (behind a small gear): goal weight, kg/lbs toggle, GitHub token + repo, JSON export button as a belt-and-braces backup.

Empty state (no entries yet) explains the app in one line and points at the form. Corrections: re-log the same date to overwrite; deleting an entry is done by editing `data.json` in GitHub and setting `"deleted": true` on that entry (a tombstone). Simply removing the row does not work: the offline-first union merge cannot distinguish "deleted remotely" from "created locally while offline" and would resurrect it. The app hides tombstoned entries from the chart, stats, and trend but keeps them in the dataset. Explicit YAGNI: no in-app delete.

## Error handling

- GitHub API failure: non-blocking toast with the reason, entry stays saved locally, sync indicator goes to pending; retry happens on next write or app open.
- Merge conflict: automatic re-pull and retry once; if it still fails, keep local data, show pending.
- Corrupt/unparseable `data.json`: do not overwrite it; keep operating locally and surface an error telling the user to check the repo (git history makes recovery trivial).
- Invalid input: reject non-numeric or out-of-range weights (sanity bounds 30 to 300 kg) inline.

## Testing and verification

- Pure logic (merge, moving average, unit conversion, date handling) written as dependency-free functions with a small test suite run via Node. Tests must cover the near-midnight timezone case for date stamping and the logging-gap case for the moving average.
- Sync tested against the real data repo with a throwaway token before first deploy.
- Manual verification: desktop browser first (including offline mode via devtools), then deploy to Pages, install on the phone, log a real entry, confirm the commit lands in the data repo.

## Out of scope

Multi-user, accounts, native app, Apple Health integration, in-app entry deletion, reminders/notifications, any backend.

## 2026-07-27 addendum: Clai redesign

The UI was rebuilt to the "Clai" design (claude.ai/design project, cream surface `#fffaf0`, pink accent `#ff4d8b`, Inter, phone-sized shell with a bottom tab bar). Storage, sync, tombstones, PWA, and the pure-logic module layout are unchanged. What changed on top:

- **Four screens**: Home (reminder banner, current weight, week trend delta, chart, streak and kg-down stat cards, forecast banner), Log (number pad, backdate picker, tag chips, note, kg/lbs toggle, milestone celebration overlay), History (weekly groups with averages, per-entry deltas, notes, tags), Goal (stepper card, progress bar, forecast, milestone list). Settings (repo, token, export) live behind the avatar; the sync indicator is a chip in the header.
- **Entry schema gains optional fields**: `time` ("HH:MM", stamped when logging for today) and `tags` (string array). Entries without them keep working; the union merge compares them via `updatedAt` as before.
- **Chart**: range pills (1W to All plus custom dates), drag-to-scrub readout (weight, date, time, note, tags), tag-filter chips that recompute the trend from the filtered subset, goal line when in range, per-point time labels when the visible span is 8 days or less.
- **Derived logic** (pure, tested): `streakOf`, `forecast` (7-day-trend slope over the trailing ~8 weeks projected onto the goal), and `suggestTags` (local tag estimation: recency-weighted time-of-day kernel vote plus a weekday vote gated on a genuine weekday effect, with an early-morning cold-start default). Suggestions pre-select chips on the log screen and are dismissed by any manual tag change.
- **Responsive fit**: height-sensitive sizes (gaps, card paddings, hero numbers, keypad, tab bar, chart height) are fluid `clamp()` tokens driven by viewport height, tuned so Home and Log fit without scrolling from ~600px-tall viewports up to the 844px design baseline (list screens scroll naturally). When the weigh-in reminder is up on short screens, the chart cedes its height via `:has()`. Wide-and-short (landscape) viewports widen the app shell and switch Home and Log to two-column grids.
- **Editable tags + compact log screen** (same-day follow-up): the tag palette is user-editable; a "+ New" chip adds a tag inline and an Edit toggle removes chips (removals hide the tag from pickers via a local hidden list, history is never rewritten; palette = defaults + local customs + any tag in the synced entries). The log screen reorders to weight, note, then a collapsed "date · tags" row that expands on tap, keypad, save, so saving needs no scrolling.
