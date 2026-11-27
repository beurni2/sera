import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRider, wire, wiredEnv, type Route, type Screen, type Wire } from './rendu';
import { __resetFiles } from './doubles/expo-file-system';
import { __modeChargement } from './doubles/expo-audio';
import { freshCourse, logistiqueCourse, type CourseState } from './doubles/logistique-course';

/**
 * ═══ RENDU-RÉEL — the rider's screen tells the truth ═══
 *
 * Four things a rider's phone writes or shows that must be TRUE:
 *   · the time spent checking the goods is counted from the moment the
 *     supplier hands them over, never from the moment the course was offered;
 *   · the time the buyer spends looking at her parcel is the time the door
 *     screen was open, never zero;
 *   · a new course right after the last one never fires an old step;
 *   · a new code from the founder mid-course can be typed, and the course goes
 *     on from the same step under it;
 *   · every date and hour reads in French and in Ouagadougou time, whatever
 *     the phone's language and zone.
 *
 * ⚠ THE STAND-INS ARE NO KINDER THAN THE REAL SERVICES (Execution Contract §3):
 *   · a code the founder replaced is refused with the same 401 for EVERY
 *     rider door, for ever — logistics deletes the old code's hash when it
 *     mints the new one, and custody asks logistics on every act (`logistics-do`
 *     mint route, `/verify/rider-code`; custody `index.ts` rider door);
 *   · logistics unreachable is custody's 503, never a 401;
 *   · delivery evidence for a course nobody holds yet is refused
 *     `custody_not_with_courier` (409), as `custody-do` refuses it;
 *   · `/rider/moi` serves the codes only on an accepted course the supplier
 *     confirmed (`logistiqueCourse`, certified by its own e2e).
 * Only `globalThis.fetch` is doubled. Like every double here, they say nothing
 * about appearance.
 */

const CODE_A = 'SR-ABCD-EFGH-JKMN';
const CODE_B = 'SR-PQRS-TVWX-YZ23';
const PICKUP = 'K7M-9PQ';
const SEAL = 'SC-4K7M-9PQR';
const PORTE = 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR';

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

/** Custody, per order: the seal makes the rider its holder; evidence for an
 *  order he does not hold is refused as the Worker refuses it. */
function custody(held: Set<string>, hooks: { onVerify?: () => void; seal503?: () => boolean } = {}): Route {
  return (path, body) => {
    const bundle = body?.['bundle'] as Record<string, unknown> | undefined;
    const order = String(body?.['orderId'] ?? bundle?.['orderId'] ?? '');
    if (path === '/rider/verification') {
      hooks.onVerify?.();
      return { status: 200, json: { ok: true, kind: 'accepted', ledgerSeq: 1, chainValid: true } };
    }
    if (path === '/rider/custody/begin') {
      if (hooks.seal503?.() === true) return { status: 503, json: { ok: false, reason: 'rider_directory_unavailable' } };
      held.add(order);
      return { status: 200, json: { ok: true, status: 'custody_with_courier', chain: { task_id: 'task-1', package_id: 'pkg-1' } } };
    }
    if (path === '/rider/transit/depart') return { status: 200, json: { ok: true, status: 'departed' } };
    if (path === '/rider/transit/arrive') return { status: 200, json: { ok: true, status: 'arrived' } };
    if (path === '/rider/delivery/evidence') {
      return held.has(order)
        ? { status: 200, json: { ok: true, status: 'evidence_recorded' } }
        : { status: 409, json: { ok: false, reason: 'custody_not_with_courier' } };
    }
    if (path === '/rider/door/inspection') return { status: 200, json: { ok: true, kind: 'accepted' } };
    if (path === '/rider/delivery/drop') {
      held.delete(order);
      return { status: 200, json: { ok: true, status: 'custody_with_customer' } };
    }
    return null;
  };
}

/** A course whose supplier already confirmed: codes on the read once he accepts. */
function confirmee(): CourseState {
  const st = freshCourse();
  st.ramassageConfirmeAt = '2026-11-27T10:00:00.000Z';
  st.codeVerification = PICKUP;
  st.codeScelle = SEAL;
  return st;
}

/** Add fields the Worker serves on `/rider/moi` to a course's read. */
function avec(route: Route, extra: Record<string, unknown>): Route {
  return (path, body) => {
    const r = route(path, body);
    if (r !== null && path === '/rider/moi') {
      const a = (r.json['rider'] as { assignment: Record<string, unknown> }).assignment;
      Object.assign(a, extra);
    }
    return r;
  };
}

/**
 * The rider-code gate every Séra rider door applies: one live code; any other
 * Bearer gets the uniform 401, for ever. `live.code` is what the founder last
 * minted. Every request is recorded with the code it carried.
 */
interface Gate {
  live: string;
  readonly sent: { path: string; code: string }[];
}
function gated(gate: Gate): void {
  const inner = globalThis.fetch;
  (globalThis as { fetch: unknown }).fetch = async (input: string, init?: RequestInit) => {
    const path = new URL(input, 'http://sera.test').pathname;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const auth = headers['Authorization'] ?? '';
    const code = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    gate.sent.push({ path, code });
    if (path.startsWith('/rider/') && code !== gate.live) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    return inner(input, init);
  };
}

async function signIn(s: Screen, code: string): Promise<void> {
  await s.type(code);
  await s.press('Entrer');
}

async function verifier(s: Screen): Promise<void> {
  await s.press('Oui', 2);
  await s.press('Oui', 1);
  await s.press('Oui', 0);
  await s.press('Envoyer la vérification');
}

/** The SOS fires on a deliberate HOLD (`onPressIn`, then 650 ms). */
async function holdSos(s: Screen): Promise<void> {
  const textOf = (n: { children: readonly unknown[] }): string =>
    n.children.map((c) => (typeof c === 'string' ? c : textOf(c as { children: readonly unknown[] }))).join('');
  const controls = s.tree.root.findAll(
    (n) => typeof n.type === 'string' && typeof n.props['onPressIn'] === 'function' && textOf(n).includes('Maintenir pour déclencher'),
  );
  expect(controls).toHaveLength(1);
  await act(async () => {
    (controls[0]!.props['onPressIn'] as () => void)();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(650);
  });
  for (let i = 0; i < 6; i += 1) await s.settle();
}

const fields = (s: Screen): number => s.tree.root.findAllByType('TextInput' as never).length;
const calls = (w: Wire, path: string) => w.calls.filter((c) => c.path === path);

describe('the time spent checking the goods starts when the supplier hands them over', () => {
  it('25 minutes on the road, then one minute at the stall: Séra is told about one minute', async () => {
    const state = freshCourse();
    const w = wire([logistiqueCourse(state, 'ord-dwell'), custody(new Set())]);
    const s = await mountRider();
    await signIn(s, CODE_A);
    await s.press('Accepter la course');
    await s.poll(75); // 25 minutes of reads on the way to the stall

    state.ramassageConfirmeAt = '2026-11-27T10:00:00.000Z';
    state.codeVerification = PICKUP;
    state.codeScelle = SEAL;
    await s.poll(1); // the read that hands him the check
    await s.poll(3); // one minute of checking
    await verifier(s);

    const v = calls(w, '/rider/verification');
    expect(v).toHaveLength(1);
    const dwell = Number(v[0]!.body?.['dwellSec']);
    expect(dwell, 'the clock must start at the handover, never at the offer').toBeGreaterThanOrEqual(55);
    expect(dwell).toBeLessThanOrEqual(65);
    expect(s.canPress('En route')).toBe(true);
    s.unmount();
  }, 20_000);
});

describe('the time the buyer looks at her parcel is the time the door was open', () => {
  it('three minutes with the buyer: the inspection says three minutes, and ends when it is sent', async () => {
    const state = confirmee();
    const w = wire([avec(logistiqueCourse(state, 'ord-porte'), { paymentMode: PORTE, chaine: { taskId: 'task-1', packageId: 'pkg-1' } }), custody(new Set())]);
    const s = await mountRider();
    await signIn(s, CODE_A);
    await s.press('Accepter la course');
    await verifier(s);
    await s.press('En route');
    await s.press('Je suis arrivé');
    expect(s.canPress("La cliente est d'accord"), JSON.stringify(s.texts())).toBe(true);

    const opened = Date.now();
    await s.poll(9); // three minutes with the buyer
    await s.press("La cliente est d'accord");
    const sentAt = Date.now();

    const i = calls(w, '/rider/door/inspection');
    expect(i).toHaveLength(1);
    const body = i[0]!.body as Record<string, unknown>;
    const inspection = (body['inspection'] ?? body) as Record<string, unknown>;
    const started = Date.parse(String(inspection['startedAt']));
    const completed = Date.parse(String(inspection['completedAt']));
    expect((completed - started) / 1000, 'the door was open three minutes').toBeGreaterThanOrEqual(175);
    expect((completed - started) / 1000).toBeLessThanOrEqual(185);
    expect(Math.abs(started - opened), 'it starts when the door screen opened').toBeLessThanOrEqual(5_000);
    expect(Math.abs(completed - sentAt), 'it ends when it was sent').toBeLessThanOrEqual(1_000);
    expect(s.shows('Le code de la cliente'), 'the buyer’s code comes next').toBe(true);
    s.unmount();
  }, 20_000);
});

describe('a new course right after the last one never fires an old step', () => {
  it('A delivered, B on the very next read: nothing is sent for B before he accepts it, and B’s door has the buyer’s code field', async () => {
    const states = { A: confirmee(), B: confirmee() };
    let cur: 'A' | 'B' = 'A';
    const routes = {
      A: avec(logistiqueCourse(states.A, 'ord-A'), { chaine: { taskId: 'task-A', packageId: 'pkg-A' } }),
      B: avec(logistiqueCourse(states.B, 'ord-B'), { chaine: { taskId: 'task-B', packageId: 'pkg-B' } }),
    };
    const held = new Set<string>();
    const w = wire([(p, b) => routes[cur](p, b), custody(held)]);
    const s = await mountRider();
    await signIn(s, CODE_A);
    await s.press('Accepter la course');
    await verifier(s);
    await s.press('En route');
    await s.press('Je suis arrivé');
    await s.type('DROP-A');
    await s.press('Confirmer la remise');
    expect(s.shows('Livré. Merci.')).toBe(true);

    // No « no course » read in between: the founder gives him B at once.
    cur = 'B';
    await s.press('Revenir en service');
    await s.poll(2);
    const forB = () =>
      w.calls.filter(
        (c) =>
          ['/rider/verification', '/rider/custody/begin', '/rider/delivery/evidence', '/rider/transit/depart', '/rider/transit/arrive', '/rider/door/inspection'].includes(c.path)
          && JSON.stringify(c.body).includes('ord-B'),
      );
    expect(s.canPress('Accepter la course'), JSON.stringify(s.texts())).toBe(true);
    expect(forB(), 'an old step fired for a course he does not hold').toHaveLength(0);

    await s.press('Accepter la course');
    expect(forB(), 'nothing fires by itself on accepting').toHaveLength(0);
    await verifier(s);
    await s.press('En route');
    await s.press('Je suis arrivé');
    expect(fields(s), JSON.stringify(s.texts())).toBe(1);
    expect(s.shows('Le code de la cliente')).toBe(true);
    expect(forB().filter((c) => c.path === '/rider/delivery/evidence'), 'one evidence for B, after he arrived').toHaveLength(1);
    s.unmount();
  }, 20_000);
});

describe('a new code from the founder mid-course can be typed, and the course goes on', () => {
  it('check accepted under code A, A replaced, the seal hears 401: the code field is back, code B carries on, the seal goes once under B, « En route » opens', async () => {
    const gate: Gate = { live: CODE_A, sent: [] };
    const state = confirmee();
    const w = wire([
      logistiqueCourse(state, 'ord-code'),
      // The founder mints code B the moment the check is accepted.
      custody(new Set(), { onVerify: () => { gate.live = CODE_B; } }),
    ]);
    gated(gate);
    const s = await mountRider();
    await signIn(s, CODE_A);
    await s.press('Accepter la course');
    await verifier(s);

    expect(gate.sent.filter((c) => c.path === '/rider/custody/begin' && c.code === CODE_A), 'the automatic seal under A').toHaveLength(1);
    expect(s.texts().length, 'the tree survived').toBeGreaterThan(0);
    expect(fields(s), `a field to type the new code. On screen: ${JSON.stringify(s.texts())}`).toBe(1);
    expect(s.shows('Ce code ne marche pas.')).toBe(true);
    expect(s.shows('Demandez un nouveau code à Séra.')).toBe(true);

    await signIn(s, CODE_B);
    await s.settle();

    const sealsUnderB = gate.sent.filter((c) => c.path === '/rider/custody/begin' && c.code === CODE_B);
    expect(sealsUnderB, 'the seal goes once under B').toHaveLength(1);
    expect(calls(w, '/rider/verification'), 'the remembered step: no second check').toHaveLength(1);
    expect(s.canPress('En route'), JSON.stringify(s.texts())).toBe(true);
    await s.press('En route');
    expect(gate.sent.filter((c) => c.path === '/rider/transit/depart' && c.code === CODE_B)).toHaveLength(1);
    expect(s.canPress('Je suis arrivé')).toBe(true);

    await s.poll(2);
    expect(gate.sent.filter((c) => c.path === '/rider/custody/begin' && c.code === CODE_B), 'never twice').toHaveLength(1);
    s.unmount();
  }, 20_000);

  it('Séra down or the network gone never sends him back to the code field; a 401 on his session read does, and an alert still owed then goes out under code B', async () => {
    const gate: Gate = { live: CODE_A, sent: [] };
    const state = confirmee();
    let sealDown = true;
    let moiMode: 'ok' | '503' | 'throw' = 'ok';
    let sosDown = true;
    const sos: string[] = [];
    const logistique = logistiqueCourse(state, 'ord-down');
    wire([
      (p, b) => {
        if (p === '/rider/moi' && moiMode === '503') return { status: 503, json: { ok: false } };
        return logistique(p, b);
      },
      (p, b) => {
        if (p !== '/rider/sos') return null;
        if (sosDown) return { status: 503, json: { ok: false, error: 'unavailable' } };
        sos.push(String(b?.['command_id']));
        return { status: 200, json: { ok: true, duplicate: false, incident: { commandId: b?.['command_id'], state: 'open' }, event: 'safety.sos_created.v1' } };
      },
      custody(new Set(), { seal503: () => sealDown }),
    ]);
    gated(gate);
    const throwing = globalThis.fetch;
    (globalThis as { fetch: unknown }).fetch = async (input: string, init?: RequestInit) => {
      if (moiMode === 'throw' && new URL(input, 'http://sera.test').pathname === '/rider/moi') throw new TypeError('Network request failed');
      return throwing(input, init);
    };
    const s = await mountRider();
    await signIn(s, CODE_A);
    await s.press('Accepter la course');
    await verifier(s);

    // A 5xx on an act: the act's own sentence and its retry, never the code field.
    expect(s.shows('Séra ne répond pas.'), JSON.stringify(s.texts())).toBe(true);
    expect(fields(s)).toBe(0);
    // A 5xx and a dead network on his session read: still on his course.
    moiMode = '503';
    await s.poll(2);
    moiMode = 'throw';
    await s.poll(2);
    expect(fields(s), JSON.stringify(s.texts())).toBe(0);
    expect(s.canPress('Réessayer')).toBe(true);
    moiMode = 'ok';

    // An SOS Séra cannot take yet stays owed on the phone.
    await s.press('SOS');
    await holdSos(s);
    expect(sos, 'Séra could not take it').toHaveLength(0);
    await s.press('Fermer');

    // The founder replaces his code: the next session read hears 401.
    gate.live = CODE_B;
    sealDown = false;
    sosDown = false;
    await s.poll(1);
    expect(fields(s), `a 401 on the session read returns him to the code field. On screen: ${JSON.stringify(s.texts())}`).toBe(1);
    expect(s.shows('Ce code ne marche pas.')).toBe(true);
    expect(sos, 'nothing goes out under a dead code').toHaveLength(0);

    await signIn(s, CODE_B);
    for (let i = 0; i < 4; i += 1) await s.settle();
    expect(sos, 'the alert still owed goes out under code B').toHaveLength(1);
    expect(gate.sent.some((c) => c.path === '/rider/sos' && c.code === CODE_B)).toBe(true);
    expect(gate.sent.filter((c) => c.path === '/rider/custody/begin' && c.code === CODE_B), 'the seal resumes once under B').toHaveLength(1);
    expect(s.canPress('En route'), JSON.stringify(s.texts())).toBe(true);
    s.unmount();
  }, 20_000);
});

describe('a 401 on « Accepter » is left to the next session read, which returns him to the code field', () => {
  it('the code is replaced before he accepts: the accept is refused, the next read shows the code field, code B accepts', async () => {
    const gate: Gate = { live: CODE_A, sent: [] };
    const state = freshCourse();
    wire([logistiqueCourse(state, 'ord-accept')]);
    gated(gate);
    const s = await mountRider();
    await signIn(s, CODE_A);
    gate.live = CODE_B;
    await s.press('Accepter la course');
    expect(state.status, 'the dead code accepted nothing').toBe('active_unacknowledged');
    await s.poll(1);
    expect(fields(s), JSON.stringify(s.texts())).toBe(1);
    expect(s.shows('Ce code ne marche pas.')).toBe(true);
    await signIn(s, CODE_B);
    await s.press('Accepter la course');
    expect(state.status).toBe('acknowledged');
    expect(s.shows('Vérifier le colis'), JSON.stringify(s.texts())).toBe(true);
    s.unmount();
  }, 20_000);
});

describe('dates and hours read in French and in Ouagadougou time, whatever the phone says', () => {
  /** An English phone in New York: the phone's language and zone everywhere
   *  the app does not name its own. */
  const tz = process.env['TZ'];
  const realDate = Date.prototype.toLocaleDateString;
  const realTime = Date.prototype.toLocaleTimeString;
  const realString = Date.prototype.toLocaleString;
  beforeEach(() => {
    process.env['TZ'] = 'America/New_York';
    const english = (real: (this: Date, l?: string | string[], o?: Intl.DateTimeFormatOptions) => string) =>
      function (this: Date, l?: string | string[], o?: Intl.DateTimeFormatOptions): string {
        const phone = l === undefined || (Array.isArray(l) && l.length === 0);
        return real.call(this, phone ? 'en-US' : l, o);
      };
    Date.prototype.toLocaleDateString = english(realDate);
    Date.prototype.toLocaleTimeString = english(realTime);
    Date.prototype.toLocaleString = english(realString);
  });
  afterEach(() => {
    if (tz === undefined) delete process.env['TZ'];
    else process.env['TZ'] = tz;
    Date.prototype.toLocaleDateString = realDate;
    Date.prototype.toLocaleTimeString = realTime;
    Date.prototype.toLocaleString = realString;
  });

  it('the second-passage window', async () => {
    const { fenetreLisible } = await import('../src/net/rider-session');
    expect(fenetreLisible({ start: '2026-11-23T14:30:00.000Z', end: '2026-11-23T16:00:00.000Z' })).toBe('lundi 23 novembre, 14:30–16:00');
    expect(fenetreLisible({ start: '2026-11-29T00:05:00.000Z', end: '2026-11-29T09:00:00.000Z' })).toBe('dimanche 29 novembre, 00:05–09:00');
  });

  it('the hour on an offered course', async () => {
    const state = freshCourse();
    wire([avec(logistiqueCourse(state, 'ord-heure'), { ackDeadline: '2026-11-23T14:30:00.000Z' })]);
    const s = await mountRider();
    await signIn(s, CODE_A);
    expect(s.shows('avant 14:30'), JSON.stringify(s.texts())).toBe(true);
    s.unmount();
  }, 20_000);

  it('the demo preview’s answer hour', async () => {
    delete process.env['EXPO_PUBLIC_SERA_LOGISTICS_BASE'];
    delete process.env['EXPO_PUBLIC_SERA_CUSTODY_BASE'];
    vi.setSystemTime(new Date('2026-11-23T14:30:00.000Z'));
    wire([]);
    const s = await mountRider();
    await s.press('Courses');
    const hours = s.texts().filter((t) => /\d\d:\d\d/.test(t));
    expect(hours.length, `the preview shows its answer hour. On screen: ${JSON.stringify(s.texts())}`).toBeGreaterThan(0);
    for (const h of hours) expect(h, 'Ouagadougou time, not the phone’s zone').toContain('14:35');
    s.unmount();
  }, 20_000);
});
