import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __dieAt, __files, __resetFiles, __seed, File, Paths, PhoneDied } from './doubles/expo-file-system';
import { createDocumentActMemoryStore, createDocumentOutboxStore, onFileKeptAside } from '../src/offline/documentStore';
import { append, flush, restore, type FlushOutcome, type OutboxEntry } from '../src/offline/outbox';
import { appendSosRaise, SOS_RAISE_KIND, type SosRaiseIntent } from '../src/offline/sos';
import { drainOnReconnect, stillPending } from '../src/offline/backlog';
import { httpSosSender } from '../src/net/sos-wire';
import { mintCommandId } from '../src/offline/commandId';
import { forgetActs, loadActMemory, rememberAct, type ActMemoryStore } from '../src/net/act-memory';

/**
 * ═══ A RIDER'S SOS IS NEVER LOST ON THE PHONE ═══
 *
 * Everything here runs on the app's REAL outbox, its REAL device store and its
 * REAL SOS sender. The only stand-ins are the network (a fetch that waits the
 * way a bad connection waits) and the file system — `doubles/expo-file-system`,
 * whose bounds are the installed native code's: a write truncates first, a
 * move deletes its destination before it renames, and the phone can die
 * between any two of those steps.
 *
 * Law 7: queued = pending, never done. PERF-BUDGETS: every queued action
 * survives app-kill AND device reboot.
 */

const CODE = 'SR-ABCD-EFGH-JKMN';
const intent: SosRaiseIntent = {
  riderId: 'rider-keep',
  hours: 'in_hours',
  onShift: true,
  activeCourseId: 'ord-keep-1',
  raisedAt: '2026-11-27T02:00:00.000Z',
};
const sos = (commandId: string): OutboxEntry =>
  ({ commandId, kind: SOS_RAISE_KIND, payload: intent, status: 'pending' }) as OutboxEntry;

/** Let queued promises run until `cond` holds — never a timer, never a guess. */
async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (cond()) return;
    await Promise.resolve();
  }
  throw new Error(`it never happened: ${what}`);
}

const okBody = (): Response =>
  new Response(JSON.stringify({ ok: true, duplicate: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  __resetFiles();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('⚠ a second SOS saved while the first is still being sent is never wiped', () => {
  it('the first send ends in the sender’s own 15 s deadline: the second SOS is still owed, then sent', async () => {
    vi.useFakeTimers();
    const store = createDocumentOutboxStore();
    const first = mintCommandId();
    const second = mintCommandId();
    await appendSosRaise(store, first, intent);

    const posted: string[] = [];
    let hang = true;
    // A dead zone: the request never answers, so only the sender's own abort
    // ends it — exactly what the real `httpSosSender` does on a phone.
    const fetchFn = (_url: string, init?: RequestInit): Promise<Response> => {
      posted.push(JSON.parse(String(init?.body))['command_id'] as string);
      if (!hang) return Promise.resolve(okBody());
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    };
    const send = httpSosSender('http://logistics.test', CODE, fetchFn);

    const draining = flush(store, send);
    await until(() => posted.length === 1, 'the first SOS is on the wire');
    // The rider presses again while the first is still in the air.
    await appendSosRaise(store, second, intent);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await draining).toEqual([{ commandId: first, outcome: 'collision-refused' }]);

    // A fresh store over the same file: what a relaunch would find.
    const afterwards = createDocumentOutboxStore();
    expect(await stillPending(afterwards, second), 'the second SOS was wiped by the first one’s send').toBe(true);
    expect(await stillPending(afterwards, first)).toBe(true);

    hang = false;
    await drainOnReconnect(afterwards, send);
    expect(posted.slice(1).sort()).toEqual([first, second].sort());
    expect(await restore(afterwards)).toEqual([]);
  });

  it('the first send ends in a 200: the second SOS is still owed, then sent', async () => {
    const store = createDocumentOutboxStore();
    const first = mintCommandId();
    const second = mintCommandId();
    await appendSosRaise(store, first, intent);

    const posted: string[] = [];
    const answer: { now?: () => void } = {};
    const fetchFn = (_url: string, init?: RequestInit): Promise<Response> => {
      posted.push(JSON.parse(String(init?.body))['command_id'] as string);
      if (posted.length > 1) return Promise.resolve(okBody());
      // A slow connection: the 200 arrives, but only after the rider pressed again.
      return new Promise((resolve) => {
        answer.now = () => resolve(okBody());
      });
    };
    const send = httpSosSender('http://logistics.test', CODE, fetchFn);

    const draining = flush(store, send);
    await until(() => answer.now !== undefined, 'the first SOS is on the wire');
    await appendSosRaise(store, second, intent);
    answer.now!();
    expect(await draining).toEqual([{ commandId: first, outcome: 'applied' }]);

    const afterwards = createDocumentOutboxStore();
    expect(await stillPending(afterwards, first), 'the server has the first one').toBe(false);
    expect(await stillPending(afterwards, second), 'the second SOS was wiped by the first one’s 200').toBe(true);

    await drainOnReconnect(afterwards, send);
    expect(posted).toEqual([first, second]);
    expect(await restore(afterwards)).toEqual([]);
  });

  it('a second SOS is sent while the first one’s send still hangs: it never waits behind it', async () => {
    const store = createDocumentOutboxStore();
    const first = mintCommandId();
    const second = mintCommandId();
    await appendSosRaise(store, first, intent);

    const posted: string[] = [];
    const held: { release?: () => void } = {};
    const fetchFn = (_url: string, init?: RequestInit): Promise<Response> => {
      const id = JSON.parse(String(init?.body))['command_id'] as string;
      posted.push(id);
      if (id !== first) return Promise.resolve(okBody());
      // A bad connection: a send of the first SOS waits until we let it go.
      return new Promise((resolve) => {
        held.release = () => resolve(okBody());
      });
    };
    const send = httpSosSender('http://logistics.test', CODE, fetchFn);

    const firstDrain = flush(store, send);
    await until(() => posted.length === 1, 'the first SOS is on the wire');
    // The rider presses again: the app saves the second SOS and drains at once.
    await appendSosRaise(store, second, intent);
    const secondDrain = flush(store, send);
    await until(() => posted.includes(second), 'the second SOS reached Séra while the first send still hung');
    expect(posted, 'the first SOS was sent a second time, ahead of the second').toEqual([first, second]);
    expect(await secondDrain).toEqual([{ commandId: second, outcome: 'applied' }]);
    // The first is still owed, and its own send settles it.
    expect(await stillPending(store, first)).toBe(true);
    held.release!();
    expect(await firstDrain).toEqual([{ commandId: first, outcome: 'applied' }]);
    expect(await restore(createDocumentOutboxStore())).toEqual([]);
  });

  it('a second SOS saved just as the first one’s 200 is being settled is kept, however close the two are', async () => {
    // The drain's removal re-reads the file and writes it back. If that ran
    // outside the one-at-a-time lane, a save landing in the few steps between
    // its read and its write would be erased. Every distance is tried.
    for (let k = 0; k <= 40; k += 1) {
      __resetFiles();
      const store = createDocumentOutboxStore();
      const first = mintCommandId();
      const second = mintCommandId();
      await appendSosRaise(store, first, intent);
      const answer: { now?: () => void } = {};
      const fetchFn = (): Promise<Response> =>
        new Promise((resolve) => {
          answer.now = () => resolve(okBody());
        });
      const draining = flush(store, httpSosSender('http://logistics.test', CODE, fetchFn));
      await until(() => answer.now !== undefined, 'the first SOS is on the wire');
      answer.now!();
      for (let i = 0; i < k; i += 1) await Promise.resolve();
      await appendSosRaise(store, second, intent);
      expect(await draining).toEqual([{ commandId: first, outcome: 'applied' }]);
      expect(await stillPending(store, second), `the second SOS, saved ${k} steps after the first one’s 200, was wiped`).toBe(true);
      expect(await stillPending(store, first)).toBe(false);
    }
  });

  it('two SOS saved in the same instant are both kept', async () => {
    const store = createDocumentOutboxStore();
    const a = mintCommandId();
    const b = mintCommandId();
    await Promise.all([appendSosRaise(store, a, intent), appendSosRaise(store, b, intent)]);
    const kept = (await restore(createDocumentOutboxStore())).map((e) => e.commandId);
    expect(kept.sort(), 'one of two simultaneous saves overwrote the other').toEqual([a, b].sort());
  });
});

describe('⚠ a file that does not read is kept aside, never trusted, never deleted', () => {
  const HALF = '[{"commandId":"7d0c5e1a-0000-4000-8000-000000000001","kind":"sos.raise","payload":{"riderId":"rid';

  it('half an outbox file: the new SOS is still saved, the damaged bytes are kept, and the SOS is sent', async () => {
    __seed('sera-outbox.json', HALF);
    const store = createDocumentOutboxStore();
    const id = mintCommandId();
    await appendSosRaise(store, id, intent);

    const aside = Object.entries(__files()).filter(([name]) => /^sera-outbox\.damaged-\d+\.json$/.test(name));
    expect(aside, 'the damaged bytes must be kept under a new name').toHaveLength(1);
    expect(aside[0]![1], 'kept byte for byte').toBe(HALF);

    const sent: string[] = [];
    const send = async (e: OutboxEntry): Promise<FlushOutcome> => {
      sent.push(e.commandId);
      return 'applied';
    };
    await drainOnReconnect(createDocumentOutboxStore(), send);
    expect(sent).toEqual([id]);
    // …and the kept bytes are still there after the drain: nothing deletes them.
    expect(Object.keys(__files()).filter((n) => n.startsWith('sera-outbox.damaged-'))).toHaveLength(1);
  });

  it('an outbox file in the old shared shape (an object) is kept aside too, so saving works again', async () => {
    const OLD = '{"custody-act-memory.v1":{"orderId":"ord-0","stage":"custody_taken"}}';
    __seed('sera-outbox.json', OLD);
    const store = createDocumentOutboxStore();
    const id = mintCommandId();
    await appendSosRaise(store, id, intent);
    expect((await restore(store)).map((e) => e.commandId)).toEqual([id]);
    expect(Object.entries(__files()).filter(([n]) => n.startsWith('sera-outbox.damaged-')).map(([, b]) => b)).toEqual([OLD]);
  });

  it('the rider is told when a file was kept aside', async () => {
    __seed('sera-outbox.json', HALF);
    let told = 0;
    const stop = onFileKeptAside(() => {
      told += 1;
    });
    await appendSosRaise(createDocumentOutboxStore(), mintCommandId(), intent);
    stop();
    expect(told).toBe(1);
  });

  it('an outbox file that exists but holds zero bytes is damaged too: kept, a fresh list starts, and the rider is told', async () => {
    // The app never writes zero bytes (an empty list is « [] »): an existing
    // empty file is what a dead in-place write or a power loss right after a
    // move leaves, and the SOS it held is gone. That must be said, not hidden.
    __seed('sera-outbox.json', '');
    let told = 0;
    const stop = onFileKeptAside(() => {
      told += 1;
    });
    expect(await restore(createDocumentOutboxStore())).toEqual([]);
    stop();
    const aside = Object.entries(__files()).filter(([name]) => /^sera-outbox\.damaged-\d+\.json$/.test(name));
    expect(aside.map(([, b]) => b), 'the empty file was read as an empty list, in silence').toEqual(['']);
    expect(__files()['sera-outbox.json']).toBe('[]');
    expect(told, 'the rider was not told').toBe(1);
  });

  it('no outbox file at all is simply a new phone: nothing is kept aside and nobody is told', async () => {
    let told = 0;
    const stop = onFileKeptAside(() => {
      told += 1;
    });
    expect(await restore(createDocumentOutboxStore())).toEqual([]);
    stop();
    expect(Object.keys(__files()).filter((n) => n.includes('.damaged-'))).toEqual([]);
    expect(told).toBe(0);
  });

  it('an act-memory file that exists but holds zero bytes is damaged too: kept, a fresh memory starts, and the rider is told', async () => {
    __seed('sera-act-memory.json', '');
    let told = 0;
    const stop = onFileKeptAside(() => {
      told += 1;
    });
    expect(await loadActMemory(createDocumentActMemoryStore(), 'ord-1')).toBeNull();
    stop();
    const aside = Object.entries(__files()).filter(([n]) => /^sera-act-memory\.damaged-\d+\.json$/.test(n));
    expect(aside.map(([, b]) => b), 'the empty memory was read as no memory, in silence').toEqual(['']);
    expect(__files()['sera-act-memory.json']).toBe('{}');
    expect(told, 'the rider was not told').toBe(1);
  });

  it('half an act-memory file: its bytes are kept, never overwritten, and the new stage is remembered', async () => {
    const HALF_MEMORY = '{"custody-act-memory.v1":{"orderId":"ord-1","sta';
    __seed('sera-act-memory.json', HALF_MEMORY);
    const memory = createDocumentActMemoryStore();
    // A damaged memory is no memory: never a guessed stage.
    expect(await loadActMemory(memory, 'ord-1')).toBeNull();
    await rememberAct(memory, { orderId: 'ord-1', stage: 'custody_taken' });
    const aside = Object.entries(__files()).filter(([n]) => /^sera-act-memory\.damaged-\d+\.json$/.test(n));
    expect(aside.map(([, b]) => b), 'the damaged memory was destroyed').toEqual([HALF_MEMORY]);
    expect((await loadActMemory(createDocumentActMemoryStore(), 'ord-1'))?.stage).toBe('custody_taken');
  });
});

describe('⚠ a phone that dies while saving keeps its list', () => {
  const before = mintCommandId();
  const next = mintCommandId();

  async function saved(): Promise<void> {
    await append(createDocumentOutboxStore(), sos(before));
  }
  const afterRelaunch = async (): Promise<string[]> =>
    (await restore(createDocumentOutboxStore())).map((e) => e.commandId);

  it('dies half-way through writing: the previous list is whole', async () => {
    await saved();
    __dieAt({ at: 'write-half', name: 'sera-outbox.json' });
    await expect(append(createDocumentOutboxStore(), sos(next))).rejects.toThrow(PhoneDied);
    expect(await afterRelaunch()).toEqual([before]);
  });

  it('dies after the new list is written but before it is moved into place: the previous list is whole', async () => {
    await saved();
    __dieAt({ at: 'move-before', name: 'sera-outbox.json' });
    await expect(append(createDocumentOutboxStore(), sos(next)), 'there was no move step at all').rejects.toThrow(PhoneDied);
    expect(await afterRelaunch()).toEqual([before]);
  });

  it('dies inside the move, after the old file was deleted and before the rename: the new list is read whole', async () => {
    await saved();
    __dieAt({ at: 'move-after-delete', name: 'sera-outbox.json' });
    await expect(append(createDocumentOutboxStore(), sos(next)), 'there was no move step at all').rejects.toThrow(PhoneDied);
    expect(await afterRelaunch()).toEqual([before, next]);
  });

  it('a first save refused before any byte leaves an empty .tmp: it is not a list, nothing is kept aside, and the next save works', async () => {
    // A full disk on a new phone: `create` succeeds and the truncating write
    // is refused, so an empty `.tmp` and no list are all that is left.
    __seed('sera-outbox.json.tmp', '');
    let told = 0;
    const stop = onFileKeptAside(() => {
      told += 1;
    });
    const store = createDocumentOutboxStore();
    expect(await store.read(), 'an empty .tmp was moved into place as if it were a list').toBeNull();
    expect(await restore(store)).toEqual([]);
    expect(Object.keys(__files()).filter((n) => n.includes('.damaged-')), 'an empty .tmp was kept aside as a damaged list').toEqual([]);
    expect(told, 'the rider was told a list was damaged when none ever existed').toBe(0);
    stop();
    await append(store, sos(next));
    expect(await afterRelaunch()).toEqual([next]);
  });

  it('after a death inside the move, the next save cannot destroy the only good copy', async () => {
    // As a phone that died in the native delete-then-rename gap leaves it:
    // no list, and a whole temporary file holding the newest one.
    __seed('sera-outbox.json.tmp', JSON.stringify([sos(before)]));
    __dieAt({ at: 'write-half', name: 'sera-outbox.json' });
    await expect(append(createDocumentOutboxStore(), sos(next))).rejects.toThrow(PhoneDied);
    expect(await afterRelaunch()).toEqual([before]);
  });
});

describe('⚠ one store object per file, for the life of the app', () => {
  it('each device factory hands back the same object on every call, and the two files never share one', () => {
    expect(createDocumentOutboxStore(), 'a second outbox object would get a lane of its own').toBe(createDocumentOutboxStore());
    expect(createDocumentActMemoryStore(), 'a second act-memory object would get a lane of its own').toBe(createDocumentActMemoryStore());
    expect(createDocumentOutboxStore()).not.toBe(createDocumentActMemoryStore());
  });

  it('two saves made through two calls of the factory, in the same instant, are both kept', async () => {
    const a = mintCommandId();
    const b = mintCommandId();
    await Promise.all([appendSosRaise(createDocumentOutboxStore(), a, intent), appendSosRaise(createDocumentOutboxStore(), b, intent)]);
    expect((await restore(createDocumentOutboxStore())).map((e) => e.commandId).sort()).toEqual([a, b].sort());
  });
});

describe('⚠ the act memory reads and writes one at a time too', () => {
  /** A memory whose every read and write takes a few turns, and says when it
   *  starts — so two calls started together really can overlap. */
  function slowMemory(): ActMemoryStore & { readonly log: string[] } {
    let held: string | null = null;
    const log: string[] = [];
    const turns = async (): Promise<void> => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    };
    return {
      log,
      async read() {
        log.push('read');
        await turns();
        return held;
      },
      async write(s: string) {
        log.push('write');
        await turns();
        held = s;
      },
      async keepAside() {
        log.push('keepAside');
      },
    };
  }

  it('a stage remembered and a load started in the same instant: the load sees the stage', async () => {
    const memory = slowMemory();
    const [, loaded] = await Promise.all([
      rememberAct(memory, { orderId: 'ord-1', stage: 'custody_taken' }),
      loadActMemory(memory, 'ord-1'),
    ]);
    expect(memory.log, 'the load read the memory in the middle of the save').toEqual(['read', 'write', 'read']);
    expect(loaded?.stage).toBe('custody_taken');
  });

  it('a stage remembered and a sign-out started in the same instant: the memory is forgotten', async () => {
    const memory = slowMemory();
    await Promise.all([rememberAct(memory, { orderId: 'ord-1', stage: 'custody_taken' }), forgetActs(memory)]);
    expect(memory.log, 'the sign-out read the memory in the middle of the save').toEqual(['read', 'write', 'read', 'write']);
    expect(await loadActMemory(memory, 'ord-1'), 'a stage survived the sign-out').toBeNull();
  });
});

describe('⚠ the stand-in phone is never kinder than the real one', () => {
  it('a move with overwrite whose source is missing has already deleted its destination when it fails', async () => {
    __seed('sera-outbox.json', '[]');
    const missing = new File(Paths.document, 'sera-outbox.json.tmp');
    await expect(missing.move(new File(Paths.document, 'sera-outbox.json'), { overwrite: true })).rejects.toThrow(/no source/);
    expect(Object.keys(__files()), 'the native code deletes the destination before it looks for the source').not.toContain('sera-outbox.json');
  });
});
