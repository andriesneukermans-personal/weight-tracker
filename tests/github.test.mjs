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

test('pullData maps unparseable content to SyncError kind data', async () => {
  const body = { sha: 'abc', content: '!!!not-base64!!!' };
  await assert.rejects(
    pullData({ repo: 'a/b', token: 't', fetchFn: async () => fakeRes(200, body) }),
    (e) => e instanceof SyncError && e.kind === 'data'
  );
});

test('pullData maps schema-corrupt data.json to SyncError kind data', async () => {
  const body = { sha: 'abc', content: encodeContent({ wrong: true }) };
  await assert.rejects(
    pullData({ repo: 'a/b', token: 't', fetchFn: async () => fakeRes(200, body) }),
    (e) => e instanceof SyncError && e.kind === 'data'
  );
});
