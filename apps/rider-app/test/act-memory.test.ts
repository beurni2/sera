import { describe, expect, it } from 'vitest';
import { forgetActs, loadActMemory, rememberAct, type ActMemoryStore } from '../src/net/act-memory';

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
    await rememberAct(store, { orderId: 'ord-1', stage: 'verification_accepted', attemptIds: { verify: 'cmd-1' } });
    const back = await loadActMemory(store, 'ord-1');
    expect(back?.stage).toBe('verification_accepted');
    // The attempt id survives, so a retry after the relaunch is still the SAME
    // command to custody — it replays rather than re-applying.
    expect(back?.attemptIds['verify']).toBe('cmd-1');
  });

  it('⚠ never restores one order’s stage onto another', async () => {
    // Showing a seal screen for goods the rider never verified would be the
    // worst possible use of a memory.
    const store = fakeStore();
    await rememberAct(store, { orderId: 'ord-1', stage: 'verification_accepted', attemptIds: {} });
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
    await rememberAct(store, { orderId: 'ord-1', stage: 'custody_taken', attemptIds: {} });
    expect(JSON.parse(store.bytes() ?? '{}')['other']).toBe('kept');
    expect((await loadActMemory(store, 'ord-1'))?.stage).toBe('custody_taken');
  });

  it('signing out forgets the acts but leaves the rest of the store alone', async () => {
    const store = fakeStore('{"other":"kept"}');
    await rememberAct(store, { orderId: 'ord-1', stage: 'custody_taken', attemptIds: {} });
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
      attemptIds: { verify: 'cmd-1', seal: 'cmd-2' },
    });
    const bytes = store.bytes() ?? '';
    expect(bytes).not.toContain(PICKUP_CODE);
    expect(bytes).not.toContain(SEAL_ID);
    expect(bytes).not.toContain(RIDER_CODE);
    // Positively: it holds the order, the stage and the ids, and that is all.
    expect(Object.keys(JSON.parse(bytes)['custody-act-memory.v1']).sort())
      .toEqual(['attemptIds', 'orderId', 'stage']);
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
