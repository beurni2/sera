import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRider, wire, wiredEnv, type Route, type Screen } from './rendu';
import { __resetFiles } from './doubles/expo-file-system';
import { __modeChargement } from './doubles/expo-audio';
import { freshCourse, logistiqueCourse } from './doubles/logistique-course';

/**
 * ═══ RENDU-RÉEL — the answer at the stall is lost, the phone dies, the rider sends again ═══
 *
 * The check (or the seal) reached Séra and was recorded; the answer never
 * reached the phone; the app was killed and opened again, so it no longer
 * holds the act's id and sends again under a fresh one. The rider must still
 * reach the next step: after the check, the seal; after the seal, « En route ».
 *
 * ⚠ THE CUSTODY STAND-IN IS CERTIFIED TO THE REAL WORKER (Execution Contract
 * §3). `services/logistics-service/test/prise-qui-tourne-mal.e2e.test.ts`
 * drives the real custody Worker through the same acts and requires exactly
 * these answers: a command id custody already holds replays its first answer
 * with `duplicate: true`; a NEW id from the same rider with his own code, on
 * a check custody accepted from him, answers that acceptance with
 * `duplicate: true` and writes nothing; a NEW id from the custodian with the
 * same seal answers `custody_with_courier` with `duplicate: true`; a wrong
 * code answers `pickup_code_refused`, another seal `seal_already_used`.
 * It records every act it answers before the answer can be lost, as the
 * Worker does. Its bound, like every double here: it says nothing about
 * appearance.
 *
 * Only `globalThis.fetch` is doubled: the answer is « lost » by throwing on
 * the phone's side AFTER the stand-in recorded the act.
 */

const CODE = 'SR-ABCD-EFGH-JKMN';
const ORDER = 'ord-rendu-perdue';
const PICKUP = 'K7M-9PQ';
const SEAL = 'SC-4K7M-9PQR';

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  __resetFiles();
  __modeChargement(null);
  wiredEnv();
});
afterEach(() => {
  vi.useRealTimers();
});

interface Grand {
  verifiee: boolean;
  scellee: boolean;
  /** command id → the answer custody recorded for it. */
  readonly vus: Map<string, { status: number; json: Record<string, unknown> }>;
}

function custody(g: Grand): Route {
  return (path, body) => {
    if (!path.startsWith('/rider/')) return null;
    const id = String(body?.['command_id']);
    const prior = g.vus.get(id);
    if (prior !== undefined) return { status: prior.status, json: { ...prior.json, duplicate: true } };
    const commit = (a: { status: number; json: Record<string, unknown> }) => {
      g.vus.set(id, a);
      return a;
    };
    if (path === '/rider/verification') {
      const juste = body?.['presentedPickupCode'] === PICKUP;
      // The same rider (there is one on this phone), his own code, a check already accepted: the recorded acceptance, nothing new.
      if (g.verifiee && juste) return { status: 200, json: { ok: true, kind: 'accepted', ledgerSeq: 1, chainValid: true, duplicate: true } };
      if (g.verifiee || !juste) return commit({ status: 409, json: { ok: false, kind: 'invalid', reason: 'pickup_code_refused', detail: 'secret_already_used' } });
      g.verifiee = true;
      return commit({ status: 200, json: { ok: true, kind: 'accepted', ledgerSeq: 1, chainValid: true } });
    }
    if (path === '/rider/custody/begin') {
      const scelle = { ok: true, status: 'custody_with_courier', riderId: 'rider-rendu', chain: { task_id: 'task-1', package_id: 'pkg-1' } };
      if (!g.verifiee) return commit({ status: 409, json: { ok: false, reason: 'verification_not_accepted' } });
      if (g.scellee && body?.['custodySealId'] === SEAL) return { status: 200, json: { ...scelle, duplicate: true } };
      if (g.scellee) return commit({ status: 409, json: { ok: false, reason: 'seal_already_used' } });
      if (body?.['custodySealId'] !== SEAL) return commit({ status: 409, json: { ok: false, reason: 'seal_missing_or_mismatched' } });
      g.scellee = true;
      return commit({ status: 200, json: scelle });
    }
    if (path === '/rider/transit/depart') return commit({ status: 200, json: { ok: true, status: g.scellee ? 'departed' : 'refused' } });
    return null;
  };
}

/** The phone loses the answer to the next act on `path`: custody recorded it, the phone never hears back. */
function perdre(path: string): void {
  const reel = globalThis.fetch;
  let fait = false;
  (globalThis as { fetch: unknown }).fetch = async (input: string, init?: RequestInit) => {
    const res = await reel(input, init);
    if (!fait && new URL(input, 'http://sera.test').pathname === path) {
      fait = true;
      throw new TypeError('Network request failed');
    }
    return res;
  };
}

async function ouvrir(): Promise<Screen> {
  const s = await mountRider();
  if (s.canPress('Entrer')) {
    await s.type(CODE);
    await s.press('Entrer');
  }
  return s;
}

async function verifier(s: Screen): Promise<void> {
  await s.press('Oui', 2);
  await s.press('Oui', 1);
  await s.press('Oui', 0);
  await s.press('Envoyer la vérification');
}

function course() {
  const state = freshCourse();
  state.ramassageConfirmeAt = '2026-11-27T10:00:00.000Z';
  state.codeVerification = PICKUP;
  state.codeScelle = SEAL;
  return state;
}

describe('a lost answer at the stall never strands the rider', () => {
  it('the check reached Séra, its answer was lost, the phone was killed: sent again, he reaches the seal and « En route »', async () => {
    const state = course();
    const g: Grand = { verifiee: false, scellee: false, vus: new Map() };
    const w = wire([logistiqueCourse(state, ORDER), custody(g)]);
    perdre('/rider/verification');
    const s = await ouvrir();
    await s.press('Accepter la course');
    await verifier(s);
    expect(g.verifiee, 'custody recorded the check').toBe(true);
    expect(s.canPress('En route'), 'the phone never heard the answer').toBe(false);
    s.unmount();

    const s2 = await ouvrir();
    expect(s2.texts().length, 'the tree survived the relaunch').toBeGreaterThan(0);
    if (s2.canPress('Envoyer la vérification')) await s2.press('Envoyer la vérification');
    else await verifier(s2);
    const ids = w.calls.filter((c) => c.path === '/rider/verification').map((c) => String(c.body?.['command_id']));
    expect(new Set(ids).size, `a relaunched phone sends under a fresh id: ${JSON.stringify(ids)}`).toBe(2);
    expect(s2.texts().length, 'the tree survived the tap').toBeGreaterThan(0);
    expect(g.scellee, `the seal went after the repeated check: ${JSON.stringify(s2.texts())}`).toBe(true);
    expect(s2.canPress('En route'), JSON.stringify(s2.texts())).toBe(true);
    await s2.press('En route');
    expect(w.calls.some((c) => c.path === '/rider/transit/depart')).toBe(true);
    s2.unmount();
  });

  it('the seal reached Séra, its answer was lost, the phone was killed: sent again, « En route » is there and pressable', async () => {
    const state = course();
    const g: Grand = { verifiee: false, scellee: false, vus: new Map() };
    const w = wire([logistiqueCourse(state, ORDER), custody(g)]);
    perdre('/rider/custody/begin');
    const s = await ouvrir();
    await s.press('Accepter la course');
    await verifier(s);
    expect(g.scellee, 'custody recorded the seal').toBe(true);
    expect(s.canPress('En route'), 'the phone never heard the answer').toBe(false);
    s.unmount();

    const s2 = await ouvrir();
    expect(s2.texts().length, 'the tree survived the relaunch').toBeGreaterThan(0);
    // Whatever the relaunched screen offers to carry on, the rider can use it.
    for (const geste of ['Réessayer', 'Sceller', 'Envoyer la vérification']) {
      if (s2.canPress('En route')) break;
      if (s2.canPress(geste)) await s2.press(geste);
    }
    if (!s2.canPress('En route') && s2.canPress('Oui')) await verifier(s2);
    const seals = w.calls.filter((c) => c.path === '/rider/custody/begin').map((c) => String(c.body?.['command_id']));
    expect(seals.length, `the seal was sent again: ${JSON.stringify(s2.texts())}`).toBeGreaterThanOrEqual(2);
    expect(s2.canPress('En route'), JSON.stringify(s2.texts())).toBe(true);
    await s2.press('En route');
    expect(w.calls.some((c) => c.path === '/rider/transit/depart')).toBe(true);
    s2.unmount();
  });
});
