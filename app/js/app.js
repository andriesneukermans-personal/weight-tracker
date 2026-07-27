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
