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
  // the merge normalizes entries with their derived id before saving/pushing
  assert.deepEqual(h.calls.saved.at(-1), [{ ...e, id: e.date }]);
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
