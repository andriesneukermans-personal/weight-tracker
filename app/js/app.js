// UI layer (Clai design): four screens behind a tab bar, rendered from an
// in-memory copy of the IndexedDB entries. Weights are stored in kg; display
// converts to the configured unit. Sync stays pull-merge-push via GitHub.

import {
  todayLocal, addDays, sortByDate, parseWeightToKg, kgToLbs, mergeEntries,
  movingAverage, dayMeans, streakOf, forecast, suggestTags, NOTE_CHIPS,
  shortDate, parseDateLocal, dayNum, hhmm, entryId, fmtWeight, kgLost,
} from './logic.js';
import { computeChart, chartSVG, RANGE_KEYS } from './chart.js';
import { computeRoad } from './road.js';
import { mountRoad, suspendRoad, scrollRoadToAvatar } from './roadview.js';
import { openDB, getAllEntries, putEntry, mergeReplaceEntries } from './store.js';
import { pullData, pushData } from './github.js';
import { runSync } from './sync.js';

const CONFIG_KEY = 'wt.config';
const UI_KEY = 'wt.ui';
const ACCENT = '#ff4d8b';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let db;
let config = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
let alive = []; // sorted, non-deleted entries; refreshed after every mutation and sync
let syncState = { state: 'off', msg: '' };

const savedUi = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
const state = {
  screen: 'home', scrub: null, draft: '', note: '', tags: [], suggested: [],
  celeb: null, tagFilter: [], logOpen: false, tagEdit: false, newTag: null,
  editing: null, pendingTag: null, ruleTime: null, ruleDays: null, confirmDelete: false,
  range: savedUi.range || '3M',
  cFrom: savedUi.cFrom || addDays(todayLocal(), -56),
  cTo: savedUi.cTo || todayLocal(),
  logDate: todayLocal(),
};

function saveConfig() { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); }
function saveUi() { localStorage.setItem(UI_KEY, JSON.stringify({ range: state.range, cFrom: state.cFrom, cTo: state.cTo })); }

function set(patch) {
  Object.assign(state, patch);
  saveUi();
  render();
}

function unit() { return config.unit === 'lbs' ? 'lbs' : 'kg'; }
function disp(kg) { return unit() === 'lbs' ? kgToLbs(kg) : kg; }
function fmt(kg) { return fmtWeight(disp(kg)); }
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening';
}
function allTags() {
  const present = new Set();
  alive.forEach((e) => (e.tags || []).forEach((t) => present.add(t)));
  return NOTE_CHIPS.filter((t) => present.has(t)).concat([...present].filter((t) => !NOTE_CHIPS.includes(t)));
}

/* The pickable tag palette: defaults, device-local custom tags, and any tag
   ever used in the (synced) entries, minus locally removed ones. Removing a
   tag hides it from pickers but never rewrites history. */
function tagPalette() {
  const custom = config.customTags || [];
  const hidden = new Set(config.hiddenTags || []);
  const used = new Set();
  alive.forEach((e) => (e.tags || []).forEach((t) => used.add(t)));
  const rest = [...used].filter((t) => !NOTE_CHIPS.includes(t) && !custom.includes(t));
  return [...new Set([...NOTE_CHIPS, ...custom, ...rest])].filter((t) => !hidden.has(t));
}

function commitNewTag() {
  if (state.newTag == null) return;
  const name = state.newTag.trim();
  if (!name) { set({ newTag: null }); return; }
  if (tagPalette().includes(name)) {
    set({ newTag: null, tags: state.tags.includes(name) ? state.tags : state.tags.concat(name), suggested: [] });
    return;
  }
  set({ newTag: null, pendingTag: name, ruleTime: null, ruleDays: null });
}

function finalizeNewTag(withRule) {
  const name = state.pendingTag;
  if (!name) return;
  config.customTags = config.customTags || [];
  config.hiddenTags = (config.hiddenTags || []).filter((t) => t !== name);
  if (!config.customTags.includes(name)) config.customTags.push(name);
  if (withRule && (state.ruleTime || state.ruleDays)) {
    config.tagRules = config.tagRules || {};
    config.tagRules[name] = { time: state.ruleTime, days: state.ruleDays, since: todayLocal() };
  }
  saveConfig();
  set({ pendingTag: null, ruleTime: null, ruleDays: null, tags: state.tags.concat(name), suggested: [] });
}

function removeTag(label) {
  config.customTags = (config.customTags || []).filter((t) => t !== label);
  config.hiddenTags = config.hiddenTags || [];
  if (!config.hiddenTags.includes(label)) config.hiddenTags.push(label);
  if (config.tagRules) delete config.tagRules[label];
  saveConfig();
  set({ tags: state.tags.filter((t) => t !== label), suggested: [] });
}

/* Derive everything the screens need. Handles 0 and 1 entries gracefully. */
function compute() {
  const todayIso = todayLocal();
  const todayN = dayNum(todayIso);
  const goal = Number.isFinite(config.goalKg) ? config.goalKg : null;
  const es = alive;
  const last = es[es.length - 1] || null;
  const first = es[0] || null;
  const trend = es.length ? movingAverage(es) : [];
  const trLast = trend.length ? trend[trend.length - 1].avgKg : null;

  // week-over-week delta of the trend line
  let weekDeltaText = '', weekDeltaColor = '#9a9a9a';
  if (trend.length) {
    const cutoff = addDays(last.date, -7);
    const past = [...trend].reverse().find((t) => t.date <= cutoff);
    const wd = disp(trLast - (past ? past.avgKg : trLast));
    const rounded = fmtWeight(Math.abs(wd));
    if (rounded === '0.0') {
      weekDeltaText = '· flat this week';
    } else {
      weekDeltaText = (wd < 0 ? '▼ ' : '▲ ') + rounded + ' ' + unit() + ' this week';
      weekDeltaColor = wd < 0 ? '#1a8a4a' : '#ef4444';
    }
  }

  const f = es.length ? forecast(es, goal) : { kind: 'empty' };
  const predictText = {
    onTrack: f.date ? `On track to hit ${goal != null ? fmt(goal) : ''} ${unit()} by ${shortDate(f.date)}` : '',
    slow: 'Trend is slow; forecast beyond a year',
    atGoal: 'You are at your goal, maintain it!',
    flat: 'Trend is flat; log a few more weigh-ins for a forecast',
    noGoal: 'Set a goal to unlock a forecast',
    empty: 'Log your first weigh-in to get started',
  }[f.kind];

  const streak = streakOf(es, todayIso);
  const logged30 = new Set(es.filter((e) => dayNum(e.date) > todayN - 30).map((e) => e.date)).size;
  const startW = first ? first.weightKg : null;
  // achievements follow the CURRENT weight: regain the kilos and the
  // checkmarks (and the "kg down" stat) drop back until they are re-lost
  const doneK = startW != null ? kgLost(startW, last.weightKg) : 0;

  // chart, optionally narrowed to the selected tag filters
  const chartBase = state.tagFilter.length
    ? es.filter((e) => (e.tags || []).some((t) => state.tagFilter.includes(t)))
    : es;
  const chart = computeChart({
    entries: chartBase, goalKg: goal, unit: unit(),
    rangeKey: state.range, cFrom: state.cFrom, cTo: state.cTo,
  });
  const chartEmptyMsg = es.length < 2
    ? 'Log a couple of weigh-ins to see your trend'
    : 'Not enough weigh-ins with these tags';

  // log screen draft
  const parsed = parseWeightToKg(state.draft, unit());
  const valid = state.draft !== '' && parsed.ok;
  let draftDelta = 'Enter the weight', draftDeltaColor = '#9a9a9a';
  if (valid && last) {
    const dd = disp(parsed.kg - last.weightKg);
    draftDelta = (dd <= 0 ? '▼ ' : '▲ ') + fmtWeight(Math.abs(dd)) + ' ' + unit() + ' vs last weigh-in';
    draftDeltaColor = dd <= 0 ? '#1a8a4a' : '#ef4444';
  } else if (valid) {
    draftDelta = 'First weigh-in!';
    draftDeltaColor = '#1a8a4a';
  } else if (state.draft !== '' && !parsed.ok) {
    draftDelta = parsed.error;
    draftDeltaColor = '#ef4444';
  }

  // history grouped by week (0 = this week); one row per weigh-in,
  // deltas compare against the previous day's mean
  const means = dayMeans(es);
  const meanDates = means.map((m) => m.date);
  const meanByDate = new Map(means.map((m) => [m.date, m.meanKg]));
  const prevDayMean = (date) => {
    const i = meanDates.indexOf(date);
    return i > 0 ? meanByDate.get(meanDates[i - 1]) : null;
  };
  const byWeek = {};
  [...es].reverse().forEach((e) => {
    const wk = Math.floor((todayN - dayNum(e.date)) / 7);
    (byWeek[wk] = byWeek[wk] || []).push(e);
  });
  const historyWeeks = Object.keys(byWeek).map(Number).sort((a, b) => a - b).slice(0, 12).map((wk) => {
    const rows = byWeek[wk];
    const wkDates = [...new Set(rows.map((e) => e.date))];
    const avg = wkDates.reduce((s, d) => s + meanByDate.get(d), 0) / wkDates.length;
    const label = wk === 0 ? 'THIS WEEK'
      : wk === 1 ? 'LAST WEEK'
      : (shortDate(rows[rows.length - 1].date) + ' – ' + shortDate(rows[0].date)).toUpperCase();
    return {
      label, avg: fmt(avg),
      rows: rows.map((e) => {
        const prev = prevDayMean(e.date);
        const d = prev != null ? disp(e.weightKg - prev) : null;
        const date = parseDateLocal(e.date);
        return {
          id: e.id || entryId(e),
          day: DOW[date.getDay()], date: shortDate(e.date), time: e.time || '',
          w: fmt(e.weightKg),
          delta: d == null ? '·' : (d <= 0 ? '−' : '+') + fmtWeight(Math.abs(d)),
          dcol: d == null ? '#9a9a9a' : d <= 0 ? '#1a8a4a' : '#ef4444',
          note: e.note || '', tags: e.tags || [],
        };
      }),
    };
  });

  // journey road (replaces the old milestones list); driven by the 7-day
  // trend, unlike the save() celebration which keys off raw new lows —
  // intentional divergence, not a bug
  const road = computeRoad({ startKg: startW, goalKg: goal, trendKg: trLast, unit: unit() });

  const pct = goal != null && startW != null && startW > goal
    ? Math.max(0, Math.min(1, (startW - last.weightKg) / (startW - goal)))
    : null;
  const today = parseDateLocal(todayIso);

  return {
    chart, chartEmptyMsg,
    todayLong: DOW_LONG[today.getDay()] + ', ' + shortDate(todayIso),
    showReminder: !last || last.date !== todayIso,
    reminderTitle: last ? "Today's weigh-in is waiting" : 'Log your first weigh-in',
    reminderSub: streak > 0 ? `Keep the ${streak}-day streak alive` : 'Start your streak today',
    currentW: last ? fmt(last.weightKg) : '––.–',
    weekDeltaText, weekDeltaColor,
    isCustom: state.range === 'C',
    streak, loggedPct: Math.round(logged30 / 30 * 100) + '%',
    bestMilestone: unit() === 'kg' ? doneK : Math.round(disp(doneK)),
    sinceLabel: first ? 'since ' + shortDate(first.date) : 'no data yet',
    predictText,
    valid, parsedKg: valid ? parsed.kg : null,
    draftShow: state.draft || '––.–', draftDelta, draftDeltaColor,
    saveBg: valid ? ACCENT : '#d8d2c0',
    entryCount: es.length, historyWeeks,
    goalDisplay: goal != null ? fmt(goal) : '—',
    startLabel: startW != null ? fmt(startW) : '—',
    pctW: pct != null ? Math.round(pct * 100) + '%' : '0%',
    pctLabel: pct != null ? Math.round(pct * 100) + '% there' : '—',
    road,
  };
}

/* ---------- templates ---------- */

function unitToggle() {
  const on = (k) => unit() === k;
  return `<div class="seg">
    <button data-action="unit:kg" class="seg-btn" style="background:${on('kg') ? '#0a0a0a' : 'transparent'};color:${on('kg') ? '#ffffff' : '#6a6a6a'}">kg</button>
    <button data-action="unit:lbs" class="seg-btn" style="background:${on('lbs') ? '#0a0a0a' : 'transparent'};color:${on('lbs') ? '#ffffff' : '#6a6a6a'}">lbs</button>
  </div>`;
}

function chartCard(V) {
  const pills = RANGE_KEYS.map(([label, key]) => {
    const on = state.range === key;
    return `<button data-action="range:${key}" class="pill" style="background:${on ? '#0a0a0a' : 'transparent'};color:${on ? '#ffffff' : '#6a6a6a'}">${label}</button>`;
  }).join('');
  const custom = V.isCustom ? `
    <div class="custom-dates">
      <input type="date" id="cfrom" value="${state.cFrom}">
      <span>to</span>
      <input type="date" id="cto" value="${state.cTo}">
    </div>` : '';
  const tags = allTags();
  const tagPills = tags.length ? `<div class="pills">${tags.map((tg, i) => {
    const on = state.tagFilter.includes(tg);
    return `<button data-action="tfilter:${i}" class="pill pill-sm" style="background:${on ? '#0a0a0a' : '#f5f0e0'};color:${on ? '#ffffff' : '#3a3a3a'}">${esc(tg)}</button>`;
  }).join('')}</div>` : '';
  return `<div class="card chart-card">
    <div class="pills">${pills}</div>
    ${custom}
    ${tagPills}
    <div class="chart-meta">
      <span id="readout" style="display:none"></span>
      <div id="legend">
        <span class="legend-item"><span class="legend-dot"></span>Daily</span>
        <span class="legend-item"><span class="legend-trend" style="background:${ACCENT}"></span>7-day trend</span>
        <span class="legend-item"><span class="legend-goal"></span>Goal</span>
      </div>
    </div>
    ${V.chart.empty ? `<div class="chart-empty">${V.chartEmptyMsg}</div>` : chartSVG(V.chart, ACCENT)}
  </div>`;
}

function syncChip() {
  const label = { syncing: 'syncing', synced: 'synced', pending: 'pending', off: 'sync off' }[syncState.state];
  return `<span id="sync-chip" data-state="${syncState.state}">${label}</span>`;
}

function homeHtml(V) {
  return `<div class="col screen screen-home">
    <div class="row between home-header">
      <div class="col" style="gap:2px">
        <span class="sub13">${V.todayLong} · ${syncChip()}</span>
        <span class="h1">${greeting()}, Andries</span>
      </div>
      <button class="avatar" data-action="settings" aria-label="Settings">A</button>
    </div>
    ${V.showReminder ? `
    <div class="reminder">
      <div class="col" style="gap:3px">
        <span class="reminder-title">${V.reminderTitle}</span>
        <span class="reminder-sub">${V.reminderSub}</span>
      </div>
      <button class="reminder-btn" data-action="nav:log">Log now</button>
    </div>` : ''}
    <div class="row between home-current" style="align-items:flex-end;padding:2px 4px">
      <div class="col" style="gap:2px">
        <span class="kicker">CURRENT</span>
        <div class="row baseline" style="gap:6px">
          <span class="bignum">${V.currentW}</span>
          <span class="bignum-unit">${unit()}</span>
        </div>
      </div>
      <span style="font:600 14px Inter;color:${V.weekDeltaColor};padding-bottom:6px">${V.weekDeltaText}</span>
    </div>
    ${chartCard(V)}
    <div class="stat-grid">
      <div class="stat" style="background:#e8b94a">
        <span class="stat-num">${V.streak}</span>
        <span class="stat-label">day streak</span>
        <span class="stat-sub">Logged ${V.loggedPct} of the last 30 days</span>
      </div>
      <div class="stat" style="background:#b8a4ed">
        <span class="stat-num">${V.bestMilestone}</span>
        <span class="stat-label">${unit()} down</span>
        <span class="stat-sub">${V.sinceLabel}</span>
      </div>
    </div>
    <button class="banner" data-action="nav:goal">
      <span class="banner-text">${V.predictText}</span>
      <span class="banner-arrow">→</span>
    </button>
  </div>`;
}

function logHtml(V) {
  const palette = tagPalette();
  const chips = palette.map((label, i) => {
    if (state.tagEdit) {
      return `<button data-action="tagrm:${i}" class="chip" style="background:#f5f0e0;color:#3a3a3a">${esc(label)} <span class="chip-rm">×</span></button>`;
    }
    const on = state.tags.includes(label);
    return `<button data-action="tag:${i}" class="chip" style="background:${on ? '#0a0a0a' : '#f5f0e0'};color:${on ? '#ffffff' : '#3a3a3a'}">${esc(label)}</button>`;
  }).join('');
  const newChip = state.newTag != null
    ? `<input id="newtag" class="chip chip-input" value="${esc(state.newTag)}" maxlength="30" placeholder="tag name">`
    : state.pendingTag == null
      ? `<button data-action="tagnew" class="chip chip-add">+ New</button>`
      : '';
  const ruleChip = (action, label, on) =>
    `<button data-action="${action}" class="chip" style="background:${on ? '#0a0a0a' : '#f5f0e0'};color:${on ? '#ffffff' : '#3a3a3a'}">${label}</button>`;
  const rulePicker = state.pendingTag == null ? '' : `
      <div class="col" style="gap:8px">
        <span class="suggest-hint">When would you use “${esc(state.pendingTag)}”?</span>
        <div class="chips">
          ${ruleChip('ruletime:morning', 'Morning', state.ruleTime === 'morning')}
          ${ruleChip('ruletime:afternoon', 'Afternoon', state.ruleTime === 'afternoon')}
          ${ruleChip('ruletime:evening', 'Evening', state.ruleTime === 'evening')}
          ${ruleChip('ruletime:night', 'Night', state.ruleTime === 'night')}
          ${ruleChip('ruletime:any', 'Anytime', !state.ruleTime)}
        </div>
        <div class="chips">
          ${ruleChip('ruledays:weekday', 'Weekdays', state.ruleDays === 'weekday')}
          ${ruleChip('ruledays:weekend', 'Weekend', state.ruleDays === 'weekend')}
          ${ruleChip('ruledays:any', 'Any day', !state.ruleDays)}
        </div>
        <div class="row" style="gap:8px;justify-content:flex-end">
          <button class="tag-edit-btn" data-action="ruleskip">Skip</button>
          <button class="tag-edit-btn rule-done" data-action="ruledone">Done</button>
        </div>
      </div>`;
  const dateLabel = state.logDate === todayLocal() ? 'Today' : shortDate(state.logDate);
  const tagSummary = state.tags.length ? state.tags.join(', ') : 'no tags';
  const pad = PAD_KEYS.map((k) => `<button data-action="pad:${k}" class="pad">${k}</button>`).join('');
  return `<div class="col screen screen-log">
    <div class="row between log-header">
      <div class="col" style="gap:2px">
        <span class="h1">${state.editing ? 'Edit weigh-in' : 'Log weigh-in'}</span>
        <span class="sub13">${state.editing ? DOW_LONG[parseDateLocal(state.logDate).getDay()] + ', ' + shortDate(state.logDate) : V.todayLong}</span>
      </div>
      ${unitToggle()}
    </div>
    <div class="draft-card">
      <div class="row baseline" style="gap:8px">
        <span class="draft-num">${V.draftShow}</span>
        <span class="draft-unit">${unit()}</span>
      </div>
      <span class="draft-delta" style="color:${V.draftDeltaColor}">${V.draftDelta}</span>
    </div>
    <input id="note" class="log-note" value="${esc(state.note)}" maxlength="120" placeholder="Add a note (optional)">
    <div class="col log-fold${state.logOpen ? ' fold-open' : ''}">
      <button class="fold-row" data-action="fold">
        <span class="fold-sum">${esc(dateLabel)} · ${esc(tagSummary)}${state.suggested.length ? ' ✦' : ''}</span>
        <span class="fold-chev">▾</span>
      </button>
      ${state.logOpen ? `
      <div class="fold-body">
        <div class="row between" style="gap:8px">
          <span class="kicker-sm" style="align-self:center">DATE</span>
          <input type="date" id="logdate" value="${state.logDate}" max="${todayLocal()}">
        </div>
        <div class="row between">
          <span class="kicker-sm">TAGS</span>
          <button class="tag-edit-btn" data-action="tagedit">${state.tagEdit ? 'Done' : 'Edit'}</button>
        </div>
        <div class="chips">${chips}${newChip}</div>
        ${rulePicker}
        ${state.suggested.length ? '<span class="suggest-hint">✦ Suggested from your usual pattern, tap to adjust</span>' : ''}
      </div>` : ''}
    </div>
    <div class="pad-grid">${pad}</div>
    <button class="save-btn" data-action="save" style="background:${V.saveBg}">${state.editing ? 'Update weigh-in' : 'Save weigh-in'}</button>
    ${state.editing ? `<div class="log-del">${state.confirmDelete
      ? `<span class="del-sure">Delete this weigh-in?</span>
         <button class="del-confirm" data-action="delyes">Delete</button>
         <button class="del-keep" data-action="delno">Keep</button>`
      : '<button class="del-link" data-action="delask">Delete this weigh-in</button>'}</div>` : ''}
  </div>`;
}

function historyHtml(V) {
  if (!V.entryCount) {
    return `<div class="col screen screen-history">
      <div class="col" style="gap:2px">
        <span class="h1">History</span>
        <span class="sub13">No weigh-ins yet</span>
      </div>
      <div class="card chart-empty">Your weigh-ins will appear here, week by week</div>
    </div>`;
  }
  const weeks = V.historyWeeks.map((wk) => `
    <div class="col" style="gap:8px">
      <div class="row between">
        <span class="kicker" style="letter-spacing:1.2px">${wk.label}</span>
        <span class="wk-badge">avg ${wk.avg}</span>
      </div>
      <div class="card wk-card">
        ${wk.rows.map((row) => `
        <div class="wk-row" data-action="edit:${esc(row.id)}">
          <div class="wk-day"><b>${row.day}</b><span>${row.date}</span></div>
          <div class="wk-main">
            <span class="wk-w">${row.w} ${unit()}${row.time ? ` <span class="wk-time">· ${row.time}</span>` : ''}</span>
            ${row.note ? `<span class="wk-note">${esc(row.note)}</span>` : ''}
            ${row.tags.length ? `<div class="wk-tags">${row.tags.map((tg) => `<span class="wk-tag">${esc(tg)}</span>`).join('')}</div>` : ''}
          </div>
          <span class="wk-delta" style="color:${row.dcol}">${row.delta}</span>
        </div>`).join('')}
      </div>
    </div>`).join('');
  return `<div class="col screen screen-history">
    <div class="col" style="gap:2px">
      <span class="h1">History</span>
      <span class="sub13">${V.entryCount} weigh-ins ${V.sinceLabel}</span>
    </div>
    ${weeks}
  </div>`;
}

function goalHtml(V) {
  const journey = V.road.state === 'ok' || V.road.state === 'reached'
    ? '<div class="card road-card" id="road-host"></div>'
    : `<div class="card road-empty">${{
        noGoal: 'Set a goal to lay down the road',
        noEntries: 'Log your first weigh-in to start the journey',
        gaining: 'Set a goal below your starting weight to build the road',
      }[V.road.state]}</div>`;
  return `<div class="col screen screen-goal">
    <div class="row between">
      <span class="h1">Goal</span>
      ${unitToggle()}
    </div>
    <div class="goal-card" style="background:${ACCENT}">
      <span class="goal-kicker">GOAL WEIGHT</span>
      <div class="row" style="gap:18px">
        <button class="goal-step" data-action="goal:down">−</button>
        <div class="row baseline" style="gap:6px">
          <span class="goal-num">${V.goalDisplay}</span>
          <span class="goal-unit">${unit()}</span>
        </div>
        <button class="goal-step" data-action="goal:up">+</button>
      </div>
      ${config.goalKg == null ? '<span class="goal-hint">Tap − or + to set a goal</span>' : ''}
    </div>
    <div class="card progress-card">
      <div class="row between">
        <span style="font:600 13px Inter">Progress</span>
        <span style="font:600 13px Inter;color:#6a6a6a">${V.pctLabel}</span>
      </div>
      <div class="progress-track"><div class="progress-fill" style="background:${ACCENT};width:${V.pctW}"></div></div>
      <div class="progress-ends">
        <span>Start ${V.startLabel}</span>
        <span style="color:#0a0a0a;font-weight:600">Now ${V.currentW}</span>
        <span>Goal ${V.goalDisplay}</span>
      </div>
    </div>
    <div class="forecast-card">
      <span class="forecast-kicker">FORECAST</span>
      <span class="forecast-text">${V.predictText}</span>
      <span class="forecast-sub">Based on your 7-day trend, updated with every weigh-in</span>
    </div>
    <div class="col" style="gap:8px">
      <span class="kicker-sm">JOURNEY</span>
      ${journey}
    </div>
  </div>`;
}

function tabsHtml() {
  const C = (s) => state.screen === s ? '#0a0a0a' : '#9a9a9a';
  return `
    <button class="tab" data-action="nav:home">
      <span class="tab-dot" style="background:${C('home')}"></span>
      <span class="tab-label" style="color:${C('home')}">Home</span>
    </button>
    <button class="tab" data-action="nav:history">
      <span class="tab-sq" style="background:${C('history')}"></span>
      <span class="tab-label" style="color:${C('history')}">History</span>
    </button>
    <button class="tab-add" data-action="nav:log" style="background:${ACCENT}">+</button>
    <button class="tab" data-action="nav:goal">
      <span class="tab-diamond" style="background:${C('goal')}"></span>
      <span class="tab-label" style="color:${C('goal')}">Goal</span>
    </button>
    <span class="tab-spacer"></span>`;
}

function celebHtml() {
  return `<div class="celeb-back">
    <div class="celeb">
      <div class="confetti">
        <span style="border-radius:50%;background:#ff4d8b"></span>
        <span style="border-radius:3px;background:#e8b94a;transform:rotate(20deg)"></span>
        <span style="border-radius:50%;background:#b8a4ed"></span>
        <span style="border-radius:3px;background:#a4d4c5;transform:rotate(-15deg)"></span>
        <span style="border-radius:50%;background:#ffb084"></span>
      </div>
      <span class="celeb-title">${esc(state.celeb)}</span>
      <span class="celeb-sub">That calls for a little celebration. Your trend line is loving this.</span>
      <button class="celeb-btn" data-action="dismiss">Keep going</button>
    </div>
  </div>`;
}

/* ---------- render + events ---------- */

function render() {
  const V = compute();
  const scroll = $('#scroll');
  const sameScreen = scroll.dataset.screen === state.screen;
  const keepScroll = sameScreen ? scroll.scrollTop : 0;
  scroll.dataset.screen = state.screen;
  scroll.innerHTML =
    state.screen === 'home' ? homeHtml(V) :
    state.screen === 'log' ? logHtml(V) :
    state.screen === 'history' ? historyHtml(V) :
    goalHtml(V);
  scroll.scrollTop = keepScroll;
  $('#tabbar').innerHTML = tabsHtml();
  $('#overlay').innerHTML = state.celeb ? celebHtml() : '';
  bind(V);
}

let prevScreen = null;

function bind(V) {
  // journey road island: mount on the goal screen, pause elsewhere; scroll
  // to the avatar only when ENTERING the screen, so same-screen re-renders
  // (goal +/-, unit toggle) keep render()'s scroll preservation intact
  const roadHost = $('#road-host');
  if (roadHost) {
    mountRoad(roadHost, V.road);
    if (prevScreen !== 'goal') scrollRoadToAvatar($('#scroll'));
  } else {
    suspendRoad();
  }
  prevScreen = state.screen;
  const note = $('#note');
  if (note) note.addEventListener('input', (e) => { state.note = e.target.value; });
  const logdate = $('#logdate');
  if (logdate) logdate.addEventListener('change', (e) => { set({ logDate: e.target.value || todayLocal() }); });
  const newtag = $('#newtag');
  if (newtag) {
    newtag.focus();
    newtag.addEventListener('input', (e) => { state.newTag = e.target.value; });
    newtag.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitNewTag(); });
    newtag.addEventListener('blur', () => commitNewTag());
  }
  const cf = $('#cfrom'), ct = $('#cto');
  if (cf) cf.addEventListener('change', (e) => set({ cFrom: e.target.value, scrub: null }));
  if (ct) ct.addEventListener('change', (e) => set({ cTo: e.target.value, scrub: null }));
  bindChart(V);
}

/* Scrub updates touch only the readout and marker nodes, so the svg element
   survives the drag and keeps receiving pointer events. */
function bindChart(V) {
  const svg = $('#chart');
  if (!svg || V.chart.empty) return;
  const pts = V.chart.pts;
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width * 330;
    let bi = 0, bd = 1e9;
    pts.forEach((p, i) => { const d = Math.abs(p.x - x); if (d < bd) { bd = d; bi = i; } });
    if (state.scrub !== bi) { state.scrub = bi; updateScrub(V); }
  };
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', () => { state.scrub = null; updateScrub(V); });
  if (state.scrub != null && state.scrub < pts.length) updateScrub(V);
  else state.scrub = null;
}

function updateScrub(V) {
  const line = $('#scrub-line'), dot = $('#scrub-dot');
  const readout = $('#readout'), legend = $('#legend');
  if (!line) return;
  const pts = V.chart.pts || [];
  const on = state.scrub != null && state.scrub < pts.length;
  line.style.display = dot.style.display = on ? '' : 'none';
  readout.style.display = on ? '' : 'none';
  legend.style.display = on ? 'none' : '';
  if (!on) return;
  const p = pts[state.scrub];
  line.setAttribute('x1', p.x.toFixed(1));
  line.setAttribute('x2', p.x.toFixed(1));
  dot.setAttribute('cx', p.x.toFixed(1));
  dot.setAttribute('cy', p.y.toFixed(1));
  const extra = [p.e.note, ...(p.e.tags || [])].filter(Boolean).map((x) => '· ' + x).join(' ');
  const when = shortDate(p.e.date) + (p.e.time ? ', ' + p.e.time : '');
  readout.innerHTML = `${fmt(p.e.weightKg)} ${unit()} · <span class="ro-date">${esc(when)}</span> <span class="ro-note">${esc(extra)}</span>`;
}

function padTap(k) {
  const d = state.draft;
  if (k === '⌫') return set({ draft: d.slice(0, -1) });
  if (k === '.' && (d.includes('.') || !d)) return;
  if (k !== '.') {
    if (d.replace('.', '').length >= 5) return;
    const dot = d.indexOf('.');
    if (dot !== -1 && d.length - dot - 1 >= 2) return;
  }
  set({ draft: d + k });
}

async function save() {
  const parsed = parseWeightToKg(state.draft, unit());
  if (state.draft === '' || !parsed.ok) return;
  const kg = parsed.kg;
  const date = state.logDate || todayLocal();
  const editing = state.editing;
  const isToday = date === todayLocal();
  let celeb = null;
  if (!editing && isToday && alive.length) {
    const prevMin = Math.min(...alive.map((e) => e.weightKg));
    const startW = alive[0].weightKg;
    const goal = Number.isFinite(config.goalKg) ? config.goalKg : null;
    if (goal != null && kg <= goal) celeb = 'Goal reached!';
    else if (kg < prevMin && Math.floor(startW - kg) > Math.floor(startW - prevMin)) {
      const down = Math.floor(startW - kg);
      celeb = (unit() === 'kg' ? down + ' kg' : Math.round(kgToLbs(down)) + ' lbs') + ' down!';
    }
  }
  const now = new Date().toISOString();
  const original = editing ? alive.find((e) => (e.id || entryId(e)) === editing) : null;
  const time = editing
    ? (original && original.time ? original.time : null)
    : (isToday ? hhmm() : null);
  const id = time ? `${date}#${time}` : date;
  // an edit that changes the entry's identity (date change) tombstones the original
  if (editing && original && id !== editing) {
    await putEntry(db, { id: editing, date: original.date, deleted: true, updatedAt: now });
  }
  await putEntry(db, {
    id, date, weightKg: kg,
    note: state.note.trim() || '',
    tags: state.tags,
    ...(time ? { time } : {}),
    updatedAt: now,
  });
  Object.assign(state, {
    draft: '', note: '', tags: [], suggested: [], editing: null, confirmDelete: false,
    screen: editing ? 'history' : 'home', scrub: null, celeb, logDate: todayLocal(),
  });
  await refresh();
  sync();
}

async function deleteEntry() {
  if (!state.editing) return;
  const original = alive.find((e) => (e.id || entryId(e)) === state.editing);
  await putEntry(db, {
    id: state.editing,
    date: original ? original.date : state.logDate,
    deleted: true,
    updatedAt: new Date().toISOString(),
  });
  Object.assign(state, {
    draft: '', note: '', tags: [], suggested: [], editing: null, confirmDelete: false,
    screen: 'history', scrub: null, logDate: todayLocal(),
  });
  await refresh();
  sync();
}

/* ---------- settings + sync ---------- */

function setStatus(s, msg = '') {
  syncState = { state: s, msg };
  const chip = $('#sync-chip');
  if (chip) {
    chip.dataset.state = s;
    chip.textContent = { syncing: 'syncing', synced: 'synced', pending: 'pending', off: 'sync off' }[s];
  }
  const m = $('#cfg-msg');
  if (m) m.textContent = msg;
}

async function sync() {
  if (!config.repo || !config.token) { setStatus('off'); return; }
  if (!navigator.onLine) { setStatus('pending'); return; }
  await runSync({
    getLocal: () => getAllEntries(db),
    saveLocal: (entries) => mergeReplaceEntries(db, entries, mergeEntries),
    pull: () => pullData({ repo: config.repo, token: config.token }),
    push: (entries, sha) => pushData({ repo: config.repo, token: config.token, entries, sha }),
    onStatus: setStatus,
  });
  await refresh();
}

function openSettings() {
  $('#cfg-repo').value = config.repo || '';
  $('#cfg-token').value = config.token || '';
  $('#cfg-msg').textContent = syncState.msg || '';
  $('#settings').showModal();
}

function saveSettings() {
  config.repo = $('#cfg-repo').value.trim();
  config.token = $('#cfg-token').value.trim();
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

async function refresh() {
  const all = await getAllEntries(db);
  alive = sortByDate(all.filter((e) => !e.deleted));
  render();
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const sep = a.indexOf(':');
  const act = sep === -1 ? a : a.slice(0, sep);
  const arg = sep === -1 ? '' : a.slice(sep + 1);
  switch (act) {
    case 'nav': {
      const patch = { screen: arg, scrub: null };
      if (arg === 'log') {
        patch.logDate = todayLocal();
        patch.logOpen = false;
        patch.tagEdit = false;
        patch.newTag = null;
        patch.pendingTag = null;
        patch.confirmDelete = false;
        if (state.editing) {
          patch.editing = null;
          patch.draft = '';
          patch.note = '';
          patch.tags = [];
        }
        const draft = patch.draft != null ? patch.draft : state.draft;
        const tags = patch.tags || state.tags;
        if (!draft && !tags.length) {
          const sug = suggestTags(alive, new Date(), config.tagRules || {}).filter((t) => tagPalette().includes(t));
          if (sug.length) { patch.tags = sug; patch.suggested = sug; }
        }
      }
      set(patch);
      break;
    }
    case 'range': set({ range: arg, scrub: null }); break;
    case 'unit': config.unit = arg; saveConfig(); set({ draft: '' }); break;
    case 'pad': padTap(arg); break;
    case 'tag': {
      const label = tagPalette()[+arg];
      if (!label) break;
      set({ tags: state.tags.includes(label) ? state.tags.filter((x) => x !== label) : state.tags.concat(label), suggested: [] });
      break;
    }
    case 'tagrm': {
      const label = tagPalette()[+arg];
      if (label) removeTag(label);
      break;
    }
    case 'tagnew': set({ newTag: '' }); break;
    case 'ruletime': set({ ruleTime: arg === 'any' ? null : arg }); break;
    case 'ruledays': set({ ruleDays: arg === 'any' ? null : arg }); break;
    case 'ruledone': finalizeNewTag(true); break;
    case 'ruleskip': finalizeNewTag(false); break;
    case 'edit': {
      const e = alive.find((x) => (x.id || entryId(x)) === arg);
      if (!e) break;
      set({
        screen: 'log', editing: e.id || entryId(e), logDate: e.date,
        draft: String(Math.round(disp(e.weightKg) * 100) / 100), note: e.note || '', tags: [...(e.tags || [])],
        suggested: [], logOpen: false, tagEdit: false, newTag: null, pendingTag: null,
        confirmDelete: false, scrub: null,
      });
      break;
    }
    case 'delask': set({ confirmDelete: true }); break;
    case 'delno': set({ confirmDelete: false }); break;
    case 'delyes': deleteEntry(); break;
    case 'tagedit': set({ tagEdit: !state.tagEdit, newTag: null }); break;
    case 'fold': set({ logOpen: !state.logOpen, tagEdit: false, newTag: null }); break;
    case 'tfilter': {
      const label = allTags()[+arg];
      if (!label) break;
      set({ tagFilter: state.tagFilter.includes(label) ? state.tagFilter.filter((x) => x !== label) : state.tagFilter.concat(label), scrub: null });
      break;
    }
    case 'goal': {
      const base = Number.isFinite(config.goalKg) ? config.goalKg
        : alive.length ? Math.round(alive[alive.length - 1].weightKg * 2) / 2 : 75;
      config.goalKg = Math.round((base + (arg === 'up' ? 0.5 : -0.5)) * 10) / 10;
      saveConfig();
      render();
      break;
    }
    case 'save': save(); break;
    case 'dismiss': set({ celeb: null }); break;
    case 'settings': openSettings(); break;
    default: break;
  }
});

async function main() {
  db = await openDB();
  $('#save-settings').addEventListener('click', saveSettings);
  $('#export-btn').addEventListener('click', exportJson);
  window.addEventListener('online', sync);
  await refresh();
  sync();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

main();
