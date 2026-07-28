import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streakOf, forecast, suggestTags, addDays } from '../app/js/logic.js';

const E = (date, kg, extra = {}) => ({ date, weightKg: kg, updatedAt: `${date}T08:00:00Z`, ...extra });

test('streakOf counts consecutive days ending at the last entry', () => {
  const entries = [E('2026-07-20', 83), E('2026-07-25', 82.9), E('2026-07-26', 82.8), E('2026-07-27', 82.7)];
  assert.equal(streakOf(entries, '2026-07-27'), 3);
});

test('streakOf allows yesterday as the last entry, but not older', () => {
  const entries = [E('2026-07-25', 82.9), E('2026-07-26', 82.8)];
  assert.equal(streakOf(entries, '2026-07-27'), 2);
  assert.equal(streakOf(entries, '2026-07-29'), 0);
  assert.equal(streakOf([], '2026-07-27'), 0);
});

test('forecast projects a steady downward trend onto the goal', () => {
  const entries = [];
  for (let i = 0; i < 60; i++) entries.push(E(addDays('2026-05-01', i), 84 - i * 0.05));
  const f = forecast(entries, 79);
  assert.equal(f.kind, 'onTrack');
  assert.ok(f.date > entries[entries.length - 1].date);
});

test('forecast reports flat, at-goal, and no-goal states', () => {
  const flat = [E('2026-07-01', 82), E('2026-07-15', 82.1), E('2026-07-27', 82)];
  assert.equal(forecast(flat, 78).kind, 'flat');
  assert.equal(forecast(flat, 83).kind, 'atGoal');
  assert.equal(forecast(flat, null).kind, 'noGoal');
  assert.equal(forecast([], 78).kind, 'flat');
});

test('suggestTags: early-morning default when history is thin', () => {
  const sug = suggestTags([], new Date(2026, 6, 27, 7, 0));
  assert.deepEqual(sug, ['First thing in the morning']);
  assert.deepEqual(suggestTags([], new Date(2026, 6, 27, 15, 0)), []);
});

test('suggestTags: a few recent consistent logs teach a time-of-day pattern', () => {
  const entries = [];
  for (let i = 1; i <= 5; i++) {
    entries.push(E(addDays('2026-07-27', -i), 82, { time: '18:0' + i, tags: ['After workout'] }));
  }
  const sug = suggestTags(entries, new Date(2026, 6, 27, 18, 15));
  assert.deepEqual(sug, ['After workout']);
});

test('suggestTags: weekday vote needs a real weekday effect, not a globally common tag', () => {
  // tag on two thirds of ALL days; at an unrelated afternoon hour nothing
  // should fire even though every weekday passes a naive 60% share
  const entries = [];
  for (let i = 1; i <= 30; i++) {
    entries.push(E(addDays('2026-07-27', -i), 82, {
      time: '07:00',
      tags: i % 3 === 0 ? [] : ['First thing in the morning'],
    }));
  }
  assert.deepEqual(suggestTags(entries, new Date(2026, 6, 27, 16, 40)), []);
});

test('suggestTags: a genuine weekday habit still fires', () => {
  // Traveling tagged on every Monday, rarely otherwise
  const entries = [];
  for (let i = 1; i <= 42; i++) {
    const date = addDays('2026-07-27', -i);
    const isMonday = new Date(date + 'T12:00:00').getDay() === 1;
    entries.push(E(date, 82, { time: '12:00', tags: isMonday ? ['Traveling'] : [] }));
  }
  const sug = suggestTags(entries, new Date(2026, 6, 27, 16, 40)); // a Monday
  assert.deepEqual(sug, ['Traveling']);
});

test('suggestTags: consistently untagged logging suppresses the morning default', () => {
  const entries = [];
  for (let i = 1; i <= 10; i++) {
    entries.push(E(addDays('2026-07-27', -i), 82, { time: '07:00', tags: [] }));
  }
  assert.deepEqual(suggestTags(entries, new Date(2026, 6, 27, 7, 0)), []);
});

test('suggestTags: a declared rule fires cold, within its window only', () => {
  const rules = { 'After sauna': { time: 'evening', days: null } };
  assert.deepEqual(suggestTags([], new Date(2026, 6, 27, 19, 0), rules), ['After sauna']);
  assert.deepEqual(suggestTags([], new Date(2026, 6, 27, 14, 0), rules), []);
});

test('suggestTags: a declared rule respects its day constraint', () => {
  const rules = { Traveling: { time: null, days: 'weekend' } };
  // 2026-07-27 is a Monday, 2026-07-26 a Sunday
  assert.deepEqual(suggestTags([], new Date(2026, 6, 27, 12, 0), rules), []);
  assert.deepEqual(suggestTags([], new Date(2026, 6, 26, 12, 0), rules), ['Traveling']);
});

test('suggestTags: untagged logging after tag creation silences a declared rule', () => {
  const rules = { 'After sauna': { time: 'evening', days: null, since: '2026-07-17' } };
  const entries = [];
  for (let i = 1; i <= 10; i++) {
    entries.push(E(addDays('2026-07-27', -i), 82, { time: '19:00', tags: [] }));
  }
  assert.deepEqual(suggestTags(entries, new Date(2026, 6, 27, 19, 0), rules), []);
});

test('suggestTags: history from before the tag existed does not silence its rule', () => {
  const rules = { 'After sauna': { time: 'evening', days: null, since: '2026-07-27' } };
  const entries = [];
  for (let i = 1; i <= 10; i++) {
    entries.push(E(addDays('2026-07-27', -i), 82, { time: '19:00', tags: [] }));
  }
  assert.deepEqual(suggestTags(entries, new Date(2026, 6, 27, 19, 0), rules), ['After sauna']);
});
