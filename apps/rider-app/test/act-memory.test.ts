import { describe, expect, it } from 'vitest';
import { forgetActs, loadActMemory, rememberAct, type ActMemoryStore } from '../src/net/act-memory';
import { append, restore, type OutboxEntry, type OutboxStore } from '../src/offline/outbox';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SE-LIVE-4c-ix · what the phone remembers about a custody act.
 *
 * FOUNDER RULING (2026-08-07): « persisting act on the phone » — the close for
 * verifier blocker A6, where an OS kill between an accepted verification and
 * the seal left the package unsealable, because the pickup code was already
 * spent and nothing on the phone remembered that the ledger had accepted.
 *
 * The tests that matter most here are the ones about what is NOT written.
 */

function fakeStore(initial: string | null = null): ActMemoryStore & { readonly bytes: () => string | null } {
  let held = initial;
  return {
    async read() { return held; },
    async write(s: string) { held = s; },
    bytes: () => held,
  };
}

const PICKUP_CODE = 'PICKUP-SECRET-XYZ';
const SEAL_ID = 'SEAL-SECRET-ABC';
const RIDER_CODE = 'SR-ABCD-EFGH-JKMN';

describe('a killed app puts the rider back where they were', () => {
  it('remembers that the LEDGER accepted the verification', async () => {
    const store = fakeStore();
    await rememberAct(store, { orderId: 'ord-1', stage: 'verification_accepted' });
    const back = await loadActMemory(store, 'ord-1');
    expect(back?.stage).toBe('verification_accepted');
    // ⚠ `attemptIds` USED TO BE ASSERTED HERE, with a comment claiming a retry
    // after relaunch replayed the same command. It never could: `attemptFor`
    // keys an attempt by CONTENT, and that content includes the pickup code
    // (which this file must never hold) and the photo ref (which changes the
    // moment the rider retakes it). Nothing ever read the field back either.
    // The field is gone; what a relaunched rider gets is the STAGE, which is
    // the thing that actually puts them back where they were.
  });

  it('⚠ never restores one order’s stage onto another', async () => {
    // Showing a seal screen for goods the rider never verified would be the
    // worst possible use of a memory.
    const store = fakeStore();
    await rememberAct(store, { orderId: 'ord-1', stage: 'verification_accepted' });
    expect(await loadActMemory(store, 'ord-2')).toBeNull();
  });

  it('unreadable or absent memory is simply no memory — never a crash on launch', async () => {
    expect(await loadActMemory(fakeStore(null), 'ord-1')).toBeNull();
    expect(await loadActMemory(fakeStore(''), 'ord-1')).toBeNull();
    expect(await loadActMemory(fakeStore('{not json'), 'ord-1')).toBeNull();
    expect(await loadActMemory(fakeStore('null'), 'ord-1')).toBeNull();
    expect(await loadActMemory(fakeStore('{"custody-act-memory.v1":"nonsense"}'), 'ord-1')).toBeNull();
  });

  it('an unknown stage degrades to none rather than inventing progress', async () => {
    const store = fakeStore('{"custody-act-memory.v1":{"orderId":"ord-1","stage":"almost_sealed"}}');
    expect((await loadActMemory(store, 'ord-1'))?.stage).toBe('none');
  });

  it('shares the store without clobbering what else lives there', async () => {
    const store = fakeStore('{"other":"kept"}');
    await rememberAct(store, { orderId: 'ord-1', stage: 'custody_taken' });
    expect(JSON.parse(store.bytes() ?? '{}')['other']).toBe('kept');
    expect((await loadActMemory(store, 'ord-1'))?.stage).toBe('custody_taken');
  });

  it('signing out forgets the acts but leaves the rest of the store alone', async () => {
    const store = fakeStore('{"other":"kept"}');
    await rememberAct(store, { orderId: 'ord-1', stage: 'custody_taken' });
    await forgetActs(store);
    expect(await loadActMemory(store, 'ord-1')).toBeNull();
    expect(JSON.parse(store.bytes() ?? '{}')['other']).toBe('kept');
  });
});

describe('⚠ what is written to the phone contains NO secret', () => {
  it('neither custody secret nor the rider’s code ever reaches the bytes', async () => {
    // This is the line that lets act state be persisted at all. The custody
    // ACTS are deliberately not queued offline because the outbox writes its
    // payload to the document store in plaintext; remembering a secret here
    // would smuggle in exactly what that refusal prevents.
    const store = fakeStore();
    await rememberAct(store, {
      orderId: 'ord-1',
      stage: 'verification_accepted',
    });
    const bytes = store.bytes() ?? '';
    expect(bytes).not.toContain(PICKUP_CODE);
    expect(bytes).not.toContain(SEAL_ID);
    expect(bytes).not.toContain(RIDER_CODE);
    // Positively: the order and the stage, and NOTHING else. Stated as an
    // exact key set so a future field cannot be added to the phone quietly.
    expect(Object.keys(JSON.parse(bytes)['custody-act-memory.v1']).sort())
      .toEqual(['orderId', 'stage']);
  });

  it('the module cannot reach a persistence surface of its own', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(import.meta.dirname, '..', 'src/net/act-memory.ts'), 'utf8');
    // It takes an injected store; it must not open one, and must not log.
    expect(src).not.toMatch(/documentStore|FileSystem\.|AsyncStorage|SecureStore/);
    expect(src).not.toMatch(/\bconsole\.\w+\s*\(/);
  });
});


describe('⚠ THE ACT MEMORY DOES NOT LIVE IN THE OUTBOX\'S FILE (blocker A1)', () => {
  /**
   * ⚠ THE REAL FAILURE, REPRODUCED BEFORE IT WAS FIXED. The memory was pointed
   * at the OUTBOX's store, and the two write incompatible top-level shapes into
   * one file: the outbox a JSON ARRAY, the memory a JSON OBJECT. Measured
   * against the real modules:
   *
   *   memory first → `append` threw « existing is not iterable » → the SOS was
   *     never persisted and never sent, while the sheet said « Alerte en cours
   *     d'envoi… ». A dead safety button claiming to be in flight.
   *   outbox first → the stage was silently discarded, no error → a killed app
   *     put the rider back on a checklist against a spent pickup code.
   *
   * The old test asserted co-existence with `{"other":"kept"}` — a hypothetical
   * object-shaped neighbour that does not exist. The only real co-tenant writes
   * an array. The assertion landed next to the defect, not on it.
   */
  const shared = (): OutboxStore & { bytes: () => string | null } => {
    let held: string | null = null;
    return { async read() { return held; }, async write(s2) { held = s2; }, bytes: () => held };
  };
  const sos = { commandId: 'cmd-sos-1', kind: 'sos.raise', payload: {}, status: 'pending' } as unknown as OutboxEntry;

  it('the app gives them SEPARATE durable files', () => {
    const doc = readFileSync(join(import.meta.dirname, '..', 'src/offline/documentStore.ts'), 'utf8');
    expect(doc).toMatch(/const OUTBOX_FILE = 'sera-outbox\.json'/);
    expect(doc).toMatch(/const ACT_MEMORY_FILE = 'sera-act-memory\.json'/);
    const app = readFileSync(join(import.meta.dirname, '..', 'App.tsx'), 'utf8');
    expect(app).toMatch(/createDocumentActMemoryStore\(\)/);
    // …and the fusing helper is gone, so nothing can re-share them by accident.
    expect(app, 'the outbox store handed to the act memory').not.toMatch(/asActMemoryStore/);
  });

  it('⚠ refuses LOUDLY rather than eating a queue it does not own', async () => {
    // If anyone ever re-points it at the outbox, this must fail visibly — not
    // silently delete a rider’s pending emergency.
    const store = shared();
    await append(store, sos);
    await expect(
      rememberAct(store as ActMemoryStore, { orderId: 'ord-1', stage: 'verification_accepted' }),
    ).rejects.toThrow(/refusing to write over a non-memory store/);
    // The queue is intact — the SOS is still there to be sent.
    expect((await restore(store)).map((e) => e.commandId)).toEqual(['cmd-sos-1']);
  });

  it('⚠ and an SOS raised after a remembered stage still persists', async () => {
    // The other order of the same collision: this used to throw « existing is
    // not iterable » inside fireSos, so the alert never left the phone.
    const memory = shared();
    const outbox = shared();
    await rememberAct(memory as ActMemoryStore, { orderId: 'ord-1', stage: 'verification_accepted' });
    await append(outbox, sos);
    expect((await restore(outbox)).map((e) => e.commandId)).toEqual(['cmd-sos-1']);
    expect((await loadActMemory(memory as ActMemoryStore, 'ord-1'))?.stage).toBe('verification_accepted');
  });
});
