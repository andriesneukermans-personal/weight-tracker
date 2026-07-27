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
