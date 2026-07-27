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
