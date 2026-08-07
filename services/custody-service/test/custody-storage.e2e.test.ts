import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Miniflare } from 'miniflare';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * ═══ WHAT THE CUSTODY FILE ACTUALLY HOLDS ON DISK ═══
 *
 * The other suite drives the Worker through its door. This one goes UNDER it
 * and reads the bytes, because two of the SE-LIVE-3 verifier's findings were
 * invisible from the door and only visible in storage:
 *
 *   ① Secrets were stored in the CLEAR. The registry hashed, the command log
 *      did not, and the verifier read `"secret":"CODE-…"` straight out of the
 *      SQLite file. The spec says « single-use codes hashed » in BOTH the Build
 *      Spec (§SE5) and the Building Plan (SE4.3).
 *   ② « Tamper-evident » was false. The ledger is not stored — it is recomputed
 *      from the command log — so editing the log yielded a forged ledger whose
 *      hash chain verified perfectly.
 *
 * These tests are the guards. They read every byte under the persist dir, so
 * they keep working if miniflare moves its files around.
 */

const SCRIPT = 'dist-worker/worker.mjs';
const OPS = 'test-custody-ops-secret-0002';
const opsAuth = { Authorization: `Bearer ${OPS}`, 'Content-Type': 'application/json' };

const ALL_PASS = {
  order_ref: true, identity: true, variant: true, colour: true, size_label: true,
  qty: true, damage: true, pieces: true, manufacturer_seal: true,
};

const digest = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

function boot(dir: string): Miniflare {
  return new Miniflare({
    modules: true,
    scriptPath: SCRIPT,
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO' },
    durableObjectsPersist: dir,
    bindings: { SERA_CUSTODY_OPS_SECRET: OPS },
  });
}

/** Every file under a directory — layout-independent on purpose. */
function filesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else found.push(p);
    }
  };
  walk(dir);
  return found;
}

function allBytes(dir: string): string {
  return filesUnder(dir).map((p) => readFileSync(p).toString('latin1')).join('|');
}

/** The Durable Object's storage IS a SQLite table (`_cf_KV`). Going through
 *  SQLite rather than editing raw bytes matters: a raw edit lands in the
 *  write-ahead log, breaks its frame checksums, and SQLite then discards the
 *  whole WAL — which DESTROYS the evidence instead of forging it. Opening the
 *  database here checkpoints the WAL and lets the forgery be surgical. */
function forgeInStoredCommands(dir: string, from: string, to: string): number {
  if (from.length !== to.length) throw new Error('a forgery must not change length');
  let forged = 0;
  for (const file of filesUnder(dir)) {
    if (!file.endsWith('.sqlite') || file.includes('metadata')) continue;
    const db = new DatabaseSync(file);
    try {
      const rows = db.prepare('select key, value from _cf_KV').all() as unknown as { key: Uint8Array; value: Uint8Array }[];
      for (const row of rows) {
        const buf = Buffer.from(row.value);
        const text = buf.toString('latin1');
        if (!text.includes(from)) continue;
        db.prepare('update _cf_KV set value = ? where key = ?').run(Buffer.from(text.split(from).join(to), 'latin1'), row.key);
        forged += 1;
      }
    } finally {
      db.close();
    }
  }
  return forged;
}

/** Delete stored rows whose key matches — how a partial storage loss looks,
 *  and how the round-3 attacker set up their forgery. */
function deleteRows(dir: string, match: (key: string) => boolean): number {
  let removed = 0;
  for (const file of filesUnder(dir)) {
    if (!file.endsWith('.sqlite') || file.includes('metadata')) continue;
    const db = new DatabaseSync(file);
    try {
      const rows = db.prepare('select key from _cf_KV').all() as unknown as { key: Uint8Array }[];
      for (const row of rows) {
        const key = Buffer.from(row.key).toString('latin1');
        if (!match(key)) continue;
        db.prepare('delete from _cf_KV where key = ?').run(row.key);
        removed += 1;
      }
    } finally {
      db.close();
    }
  }
  return removed;
}

const dirs: string[] = [];
function freshDir(tag: string): string {
  const d = mkdtempSync(join(tmpdir(), `custody-storage-${tag}-`));
  dirs.push(d);
  return d;
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

type Json = Record<string, unknown>;

async function call(mf: Miniflare, method: string, path: string, body?: unknown): Promise<{ status: number; json: Json }> {
  const res = await mf.dispatchFetch(`http://custody${path}`, {
    method,
    headers: opsAuth,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: Json = {};
  try { json = JSON.parse(text) as Json; } catch { /* non-JSON */ }
  return { status: res.status, json };
}

describe('SECRETS AT REST — the spec says « single-use codes hashed », and now the disk agrees', () => {
  const ORDER = 'ord-at-rest';
  const PICKUP = 'PICKUP-AT-REST-9001';
  const SEAL = 'SEAL-AT-REST-9002';
  const DROP = 'DROP-AT-REST-9003';

  it('arms all three secret kinds, then no plaintext survives anywhere on disk', async () => {
    const dir = freshDir('secrets');
    let mf = boot(dir);

    expect((await call(mf, 'POST', '/ops/order/open', {
      orderId: ORDER, taskId: 't', packageId: 'p', correlationId: 'c', supplierId: 's',
    })).status).toBe(200);

    for (const [kind, secret, id] of [
      ['pickup_verification_code', PICKUP, 'a1'],
      ['custody_seal', SEAL, 'a2'],
      ['buyer_drop_code', DROP, 'a3'],
    ] as const) {
      const res = await call(mf, 'POST', '/ops/secrets/arm', { orderId: ORDER, command_id: id, kind, secret });
      expect(res.status).toBe(200);
      // The door never echoes a secret back either.
      expect(JSON.stringify(res.json)).not.toContain(secret);
    }

    // A presented code is a secret too — it must not be logged in the clear.
    await call(mf, 'POST', '/ops/verification', {
      orderId: ORDER, command_id: 'v1', riderId: 'r1', presentedPickupCode: PICKUP,
      checkResults: ALL_PASS, dwellSec: 100, evidenceBundleId: 'ev', at: '2026-08-07T09:00:00.000Z',
    });

    await mf.dispose(); // everything must be on disk now
    const bytes = allBytes(dir);

    // THE ASSERTION THAT MATTERS: not one of the three plaintexts is on disk.
    for (const secret of [PICKUP, SEAL, DROP]) {
      expect(bytes).not.toContain(secret);
    }
    // POSITIVE CONTROL — without this the test could pass by scanning the wrong
    // files and prove nothing at all. The digests ARE there.
    expect(bytes).toContain(digest(PICKUP));
    expect(bytes).toContain(digest(SEAL));
    expect(bytes).toContain(digest(DROP));

    // And the hashing did not cost the four-secrets law: the code still works
    // exactly once, and is spent afterwards.
    mf = boot(dir);
    const reuse = await call(mf, 'POST', '/ops/verification', {
      orderId: ORDER, command_id: 'v2', riderId: 'r1', presentedPickupCode: PICKUP,
      checkResults: ALL_PASS, dwellSec: 100, evidenceBundleId: 'ev', at: '2026-08-07T09:00:00.000Z',
    });
    expect(reuse.status).toBe(409);
    expect(reuse.json).toMatchObject({ reason: 'pickup_code_refused', detail: 'secret_already_used' });
    await mf.dispose();
  });

  it('stores the log as ONE KEY PER COMMAND, not one growing value', async () => {
    const dir = freshDir('rows');
    const mf = boot(dir);
    expect((await call(mf, 'POST', '/ops/order/open', {
      orderId: 'ord-rows', taskId: 't', packageId: 'p', correlationId: 'c', supplierId: 's',
    })).status).toBe(200);
    for (let i = 0; i < 3; i += 1) {
      await call(mf, 'POST', '/ops/secrets/arm', {
        orderId: 'ord-rows', command_id: `arm-${i}`, kind: 'custody_seal', secret: `S-${i}`,
      });
    }
    await mf.dispose();
    const bytes = allBytes(dir);
    // Keyed rows, in arrival order…
    expect(bytes).toContain('custody:cmd:000000000000');
    expect(bytes).toContain('custody:cmd:000000000001');
    // …and NOT the single-value log that would have hit the 128 KiB per-value
    // cap and left a busy custody file permanently write-dead.
    expect(bytes).not.toContain('custody:command-log:v1');
  });
});

/**
 * ⚠ SE-LIVE-3 VERIFIER, ROUND 3 (BLOCKER) — THE OBJECT WAS MADE TO FORGE FOR
 * THE ATTACKER. No hash was recomputed and no head was rewritten. Deleting two
 * rows — the chain and the head — left the command log an ORPHAN, and
 * `/order/open` then adopted it under whatever ids the caller supplied. The
 * next act sealed the new head, so the object vouched for the result:
 * `valid: true`, `headMatches: true`, and the victim's package erased from its
 * own custody record, permanently and self-consistently.
 *
 * The likelier path is not an attack at all: a partial storage loss takes the
 * chain, the operator sees `order_not_open`, and RE-OPENING — the obvious
 * recovery — silently re-attributes the file to whatever they type.
 */
describe('an orphaned command log is never adopted by a new chain', () => {
  const ORDER = 'ord-orphan';
  const CODE = 'PICKUP-ORPHAN-9200';
  const AT = '2026-08-07T09:00:00.000Z';

  it('refuses to re-open over an existing log, and never re-attributes the record', async () => {
    const dir = freshDir('orphan');
    let mf = boot(dir);

    expect((await call(mf, 'POST', '/ops/order/open', {
      orderId: ORDER, taskId: 't', packageId: 'pkg-VICTIM', correlationId: 'corr-VICTIM', supplierId: 'sup-VICTIM',
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/ops/secrets/arm', {
      orderId: ORDER, command_id: 'arm-o', kind: 'pickup_verification_code', secret: CODE,
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/ops/verification', {
      orderId: ORDER, command_id: 'v-o', riderId: 'rider-1', presentedPickupCode: CODE,
      checkResults: ALL_PASS, dwellSec: 120, evidenceBundleId: 'ev-o', at: AT,
    })).status).toBe(200);
    await mf.dispose();

    // The setup: chain and head gone, command rows left intact.
    const removed = deleteRows(dir, (k) => k === 'custody:chain:v1' || k === 'custody:ledger-head:v1');
    expect(removed).toBe(2);

    mf = boot(dir);
    const reopen = await call(mf, 'POST', '/ops/order/open', {
      orderId: ORDER, taskId: 't', packageId: 'pkg-ATTACKER', correlationId: 'corr-ATTACKER', supplierId: 'sup-ATTACKER',
    });
    // THE PIN: commands can only exist UNDER a chain, so a log without one is a
    // damaged file, not a new one. It refuses and names what it found.
    expect(reopen.status).toBe(409);
    expect(reopen.json).toMatchObject({ reason: 'existing_command_log_without_chain' });

    // And no act can seal the attacker's version into place afterwards.
    const act = await call(mf, 'POST', '/ops/secrets/arm', {
      orderId: ORDER, command_id: 'arm-after', kind: 'buyer_drop_code', secret: 'X',
    });
    expect(act.status).toBe(409);
    expect(act.json).toMatchObject({ reason: 'existing_command_log_without_chain' });

    // The victim's package was never replaced by the attacker's anywhere.
    await mf.dispose();
    expect(allBytes(dir)).not.toContain('pkg-ATTACKER');
    expect(allBytes(dir)).toContain('pkg-VICTIM');
  });
});

/**
 * ⚠ SE-LIVE-3 VERIFIER, ROUND 3 (MAJOR) — the head bound the LEDGER, and the
 * ledger entry for a pickup carries only `{result, orderId, attempt}`. So every
 * fact that never reaches the ledger was rewritable at rest while the object
 * still answered `headMatches: true`. The head now chains the COMMAND LOG
 * itself, so these are all caught.
 */
describe('the command log is chained too — the facts that never reach the ledger are bound as well', () => {
  const CODE = 'PICKUP-BIND-9300';
  const AT = '2026-08-07T09:00:00.000Z';

  async function seed(dir: string, order: string): Promise<Miniflare> {
    const mf = boot(dir);
    expect((await call(mf, 'POST', '/ops/order/open', {
      orderId: order, taskId: 't', packageId: `pkg-${order}`, correlationId: 'c', supplierId: 's',
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/ops/secrets/arm', {
      orderId: order, command_id: 'arm-b', kind: 'pickup_verification_code', secret: CODE,
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/ops/secrets/arm', {
      orderId: order, command_id: 'arm-drop', kind: 'buyer_drop_code', secret: 'BUYER-REAL-CODE-01',
    })).status).toBe(200);
    return mf;
  }

  it('WHO verified cannot be rewritten — riderId is the only attestation this slice ships', async () => {
    const dir = freshDir('bind-rider');
    let mf = await seed(dir, 'ord-bind-a');
    expect((await call(mf, 'POST', '/ops/verification', {
      orderId: 'ord-bind-a', command_id: 'v-b', riderId: 'rider-MOUSSA-001', presentedPickupCode: CODE,
      checkResults: ALL_PASS, dwellSec: 120, evidenceBundleId: 'ev-REAL-PHOTOS-01', at: AT,
    })).status).toBe(200);
    await mf.dispose();

    expect(forgeInStoredCommands(dir, 'rider-MOUSSA-001', 'rider-SALIF-9999')).toBeGreaterThan(0);

    mf = boot(dir);
    const res = await call(mf, 'GET', '/ops/ledger?orderId=ord-bind-a');
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ reason: 'command_log_tampered' });
    await mf.dispose();
  });

  it('WHICH CHECK FAILED cannot be rewritten — a damaged package cannot become a wrong-colour one', async () => {
    const dir = freshDir('bind-fault');
    let mf = await seed(dir, 'ord-bind-b');
    expect((await call(mf, 'POST', '/ops/verification', {
      orderId: 'ord-bind-b', command_id: 'v-b', riderId: 'rider-1', presentedPickupCode: CODE,
      checkResults: { ...ALL_PASS, damage: false }, dwellSec: 200, evidenceBundleId: 'ev-b', at: AT,
    })).json).toMatchObject({ kind: 'refused' });
    const before = await call(mf, 'GET', '/ops/ledger?orderId=ord-bind-b');
    await mf.dispose();

    /**
     * THE VERIFIER'S OWN FORGERY, byte for byte. Booleans serialize as a single
     * 'T'/'F' after the key name, so swapping `damage` false→true and `colour`
     * true→false keeps EXACTLY ONE failed check. The verification therefore
     * stays `refused` and the LEDGER ENTRY IS IDENTICAL — the old ledger-only
     * head could not see this at all. Only chaining the command log catches it.
     */
    const swapped = forgeInStoredCommands(dir, 'damageF', 'damageT')
      + forgeInStoredCommands(dir, 'colourT', 'colourF');
    expect(swapped).toBe(2);

    mf = boot(dir);
    const res = await call(mf, 'GET', '/ops/ledger?orderId=ord-bind-b');
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ reason: 'command_log_tampered' });
    // Proof the forgery really was ledger-invisible: it left `result` refused,
    // so the entry the old head bound would have been unchanged.
    expect(((before.json['entries'] as Json[])[0]?.['payload'] as Json)['result']).toBe('refused');
    await mf.dispose();
  });

  it('AN ARMED, UNSPENT SECRET cannot be swapped — a buyer drop code stays the buyer\'s', async () => {
    const dir = freshDir('bind-secret');
    let mf = await seed(dir, 'ord-bind-c');
    await mf.dispose();

    // The attacker substitutes their own code's digest for the buyer's.
    const real = digest('BUYER-REAL-CODE-01');
    const attacker = digest('ATTACKER-CODE-9999');
    expect(real.length).toBe(attacker.length);
    expect(forgeInStoredCommands(dir, real, attacker)).toBeGreaterThan(0);

    mf = boot(dir);
    const res = await call(mf, 'GET', '/ops/ledger?orderId=ord-bind-c');
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ reason: 'command_log_tampered' });
    await mf.dispose();
  });
});

/**
 * ⚠ SE-LIVE-3 VERIFIER, ROUND 3 (MAJOR) — the row and the head used to be TWO
 * separate awaited puts, so either landing alone left the custody file
 * refusing every route forever: the record still on disk and nobody able to
 * read it again, including to settle the dispute it exists for. `commit` now
 * writes both keys in ONE `put`, so the window does not exist.
 *
 * Atomicity itself cannot be observed from outside, so what is pinned here is
 * the BEHAVIOUR of the states that window used to produce — both fail closed
 * and name themselves, and both are stated plainly as UNRECOVERABLE from this
 * door. Recovering a damaged custody record is an operational act with
 * evidence attached, not a POST anyone can retry.
 */
describe('a half-written custody file fails closed and says which half is missing', () => {
  const CODE = 'PICKUP-HALF-9400';
  const AT = '2026-08-07T09:00:00.000Z';

  async function seeded(dir: string, order: string): Promise<void> {
    const mf = boot(dir);
    expect((await call(mf, 'POST', '/ops/order/open', {
      orderId: order, taskId: 't', packageId: `pkg-${order}`, correlationId: 'c', supplierId: 's',
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/ops/secrets/arm', {
      orderId: order, command_id: 'arm-h', kind: 'pickup_verification_code', secret: CODE,
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/ops/verification', {
      orderId: order, command_id: 'v-h', riderId: 'rider-1', presentedPickupCode: CODE,
      checkResults: ALL_PASS, dwellSec: 120, evidenceBundleId: 'ev-h', at: AT,
    })).status).toBe(200);
    await mf.dispose();
  }

  it('commands without their head refuse every route, and stay refused across restarts', async () => {
    const dir = freshDir('half-head');
    await seeded(dir, 'ord-half-a');
    expect(deleteRows(dir, (k) => k === 'custody:ledger-head:v1')).toBe(1);

    let mf = boot(dir);
    for (const [method, path] of [
      ['GET', '/ops/ledger?orderId=ord-half-a'],
      ['GET', '/ops/ledger/verify?orderId=ord-half-a'],
      ['GET', '/ops/events?orderId=ord-half-a'],
    ] as const) {
      const res = await call(mf, method, path);
      expect(res.status).toBe(409);
      expect(res.json).toMatchObject({ reason: 'head_missing_for_existing_log' });
    }
    await mf.dispose();

    // Still refused on a fresh boot — it does not heal, and it must not.
    mf = boot(dir);
    expect((await call(mf, 'GET', '/ops/ledger?orderId=ord-half-a')).status).toBe(409);
    await mf.dispose();
  });

  it('a head without its last command is caught as tampering, not waved through', async () => {
    const dir = freshDir('half-row');
    await seeded(dir, 'ord-half-b');
    expect(deleteRows(dir, (k) => k === 'custody:cmd:000000000001')).toBe(1);

    const mf = boot(dir);
    const res = await call(mf, 'GET', '/ops/ledger?orderId=ord-half-b');
    expect(res.status).toBe(409);
    expect(res.json).toMatchObject({ reason: 'command_log_tampered' });
    await mf.dispose();
  });
});

describe('THE FORGERY THE VERIFIER PULLED OFF — the object must now refuse to serve', () => {
  const ORDER = 'ord-forge';
  const CODE = 'PICKUP-FORGE-9100';
  const HONEST_AT = '2026-08-07T09:00:00.000Z';
  const FORGED_AT = '2026-08-07T23:59:00.000Z'; // same length, still valid ISO

  it('an edited command log is caught by the recorded head, and every route fails closed', async () => {
    const dir = freshDir('forge');
    let mf = boot(dir);

    expect((await call(mf, 'POST', '/ops/order/open', {
      orderId: ORDER, taskId: 't', packageId: 'pkg-forge', correlationId: 'c', supplierId: 's',
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/ops/secrets/arm', {
      orderId: ORDER, command_id: 'arm-f', kind: 'pickup_verification_code', secret: CODE,
    })).status).toBe(200);
    const honest = await call(mf, 'POST', '/ops/verification', {
      orderId: ORDER, command_id: 'v-f', riderId: 'rider-HONEST', presentedPickupCode: CODE,
      checkResults: ALL_PASS, dwellSec: 120, evidenceBundleId: 'ev-f', at: HONEST_AT,
    });
    expect(honest.status).toBe(200);

    const before = await call(mf, 'GET', `/ops/ledger?orderId=${ORDER}`);
    expect((before.json['entries'] as Json[])[0]).toMatchObject({ at: HONEST_AT });
    expect((await call(mf, 'GET', `/ops/ledger/verify?orderId=${ORDER}`)).json)
      .toMatchObject({ valid: true, headMatches: true });

    await mf.dispose(); // the runtime dies; now we go under it

    // THE FORGERY, done properly: rewrite the instant inside the STORED COMMAND
    // through the Durable Object's own `_cf_KV` table. Equal length, so nothing
    // moves. Going through SQLite rather than editing raw bytes matters — a raw
    // edit lands in the write-ahead log, breaks its frame checksums, and SQLite
    // then discards the whole WAL, which destroys the evidence instead of
    // forging it (that scenario is its own test below). This is the edit that
    // used to yield a ledger whose own hash chain answered `valid: true`.
    const forged = forgeInStoredCommands(dir, HONEST_AT, FORGED_AT);
    // If this is 0 the test proves nothing — fail loudly rather than pass.
    expect(forged).toBeGreaterThan(0);

    mf = boot(dir);

    // The rebuilt ledger no longer matches the head this object recorded, so
    // the custody file refuses EVERYTHING — reads included. A file that cannot
    // vouch for its own history serves nothing.
    const after = await call(mf, 'GET', `/ops/ledger?orderId=${ORDER}`);
    expect(after.status).toBe(409);
    expect(after.json).toMatchObject({ reason: 'command_log_tampered' });

    const verify = await call(mf, 'GET', `/ops/ledger/verify?orderId=${ORDER}`);
    expect(verify.status).toBe(409);

    // And no new custody fact can be written onto a file under suspicion.
    const act = await call(mf, 'POST', '/ops/secrets/arm', {
      orderId: ORDER, command_id: 'arm-after-forgery', kind: 'buyer_drop_code', secret: 'X',
    });
    expect(act.status).toBe(409);
    expect(act.json).toMatchObject({ reason: 'command_log_tampered' });
    await mf.dispose();
  });

  /**
   * ⚠ THE LIMIT OF THIS GUARD, PROVEN RATHER THAN ASSUMED — and found by
   * accident while writing the test above. Editing the SQLite files as raw
   * BYTES lands in the write-ahead log and breaks its frame checksums, so
   * SQLite discards the whole WAL. Both the command rows AND the recorded head
   * disappear together, and the object reboots as a YOUNGER but perfectly
   * self-consistent custody file: an accepted verification is simply gone, and
   * nothing reports a problem.
   *
   * That is honest to state and NOT something this object can fix: when the
   * storage layer loses committed data, there is nothing left inside the object
   * to compare against. What the head DOES catch is partial loss — the row
   * without the head, or the head without the row — because they are written in
   * that order. A total tail loss needs an anchor outside this object, which is
   * a deliberate design question for a later slice, not something to paper over
   * with a claim this code cannot back.
   */
  it('a storage-level rollback that takes the log AND the head leaves a younger, self-consistent file — the named limit', async () => {
    const dir = freshDir('rollback');
    let mf = boot(dir);
    expect((await call(mf, 'POST', '/ops/order/open', {
      orderId: 'ord-roll', taskId: 't', packageId: 'pkg-roll', correlationId: 'c', supplierId: 's',
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/ops/secrets/arm', {
      orderId: 'ord-roll', command_id: 'arm-r', kind: 'pickup_verification_code', secret: CODE,
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/ops/verification', {
      orderId: 'ord-roll', command_id: 'v-r', riderId: 'rider-1', presentedPickupCode: CODE,
      checkResults: ALL_PASS, dwellSec: 120, evidenceBundleId: 'ev-r', at: HONEST_AT,
    })).status).toBe(200);
    expect(((await call(mf, 'GET', '/ops/ledger?orderId=ord-roll')).json['entries'] as Json[])).toHaveLength(1);
    await mf.dispose();

    // A raw byte edit — the WAL loses its checksums and SQLite drops it whole.
    let touched = 0;
    for (const file of filesUnder(dir)) {
      const text = readFileSync(file).toString('latin1');
      if (!text.includes(HONEST_AT)) continue;
      writeFileSync(file, Buffer.from(text.split(HONEST_AT).join(FORGED_AT), 'latin1'));
      touched += 1;
    }
    expect(touched).toBeGreaterThan(0);

    mf = boot(dir);
    const after = await call(mf, 'GET', '/ops/ledger?orderId=ord-roll');
    // THE HONEST OUTCOME: not a forged ledger — an EMPTIED one. The verification
    // is gone and the object cannot tell, because its own evidence went with it.
    expect(after.status).toBe(200);
    expect(after.json['entries']).toEqual([]);
    // Which is exactly why this is documented as a limit and not sold as a
    // defence. The guard is honest about what it covers.
    expect((await call(mf, 'GET', '/ops/ledger/verify?orderId=ord-roll')).json)
      .toMatchObject({ valid: true, headMatches: true });
    await mf.dispose();
  });

  it('an UNTOUCHED file with the same shape reboots clean — the guard is not just refusing everything', async () => {
    const dir = freshDir('clean');
    let mf = boot(dir);
    expect((await call(mf, 'POST', '/ops/order/open', {
      orderId: 'ord-clean', taskId: 't', packageId: 'pkg-clean', correlationId: 'c', supplierId: 's',
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/ops/secrets/arm', {
      orderId: 'ord-clean', command_id: 'arm-c', kind: 'pickup_verification_code', secret: CODE,
    })).status).toBe(200);
    expect((await call(mf, 'POST', '/ops/verification', {
      orderId: 'ord-clean', command_id: 'v-c', riderId: 'rider-1', presentedPickupCode: CODE,
      checkResults: ALL_PASS, dwellSec: 120, evidenceBundleId: 'ev-c', at: HONEST_AT,
    })).status).toBe(200);

    await mf.dispose();
    mf = boot(dir);

    const ledger = await call(mf, 'GET', '/ops/ledger?orderId=ord-clean');
    expect(ledger.status).toBe(200);
    expect((ledger.json['entries'] as Json[])).toHaveLength(1);
    expect((await call(mf, 'GET', '/ops/ledger/verify?orderId=ord-clean')).json)
      .toMatchObject({ valid: true, headMatches: true });
    await mf.dispose();
  });
});
