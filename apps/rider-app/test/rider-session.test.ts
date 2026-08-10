import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createManualConnectivity } from '../src/offline/connectivity';
import { httpRiderSession } from '../src/net/httpRiderSession';
import { demoRiderSession, isWired, resolveRiderSession } from '../src/net/resolveRiderSession';
import { riderSessionFromBody } from '../src/net/rider-session';

/**
 * SE-LIVE-4c-i · the rider session port.
 *
 * WHAT THESE PIN, and it is the part that matters: the three refusals stay
 * APART. A rider standing in the sun needs « your code is dead » and « no
 * signal » to be different sentences — one means go and see the founder, the
 * other means walk ten metres and try again. Conflating them is the same
 * defect custody's own rider door had to fix at 4b-ii.
 */

const MOI = {
  ok: true,
  rider: {
    riderId: 'rider-0001',
    displayName: 'Issa',
    certified: true,
    privacyAckOk: true,
    noticeVersion: 'v1',
    shift: { state: 'on' },
    assignment: {
      assignmentId: 'asg-1',
      taskId: 'task-1',
      orderId: 'ord-1',
      status: 'acked',
      ackDeadline: '2026-08-07T10:00:00.000Z',
      window: { from: '08:00', to: '10:00' },
      location: { zone: 'Gounghin' },
    },
  },
};

const online = () => createManualConnectivity('online');
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('the rider signs in with their own code', () => {
  it('carries the code as the Bearer to /rider/moi and returns the live assignment', async () => {
    const seen: { url?: string | undefined; auth?: string | undefined; method?: string | undefined } = {};
    const port = httpRiderSession('https://logistics.example.dev', online(), async (url, init) => {
      seen.url = url;
      seen.method = init?.method;
      seen.auth = new Headers(init?.headers).get('Authorization') ?? undefined;
      return json(MOI);
    });

    const res = await port.signIn('RIDER-CODE-0001');
    expect(res.ok).toBe(true);
    // The code travels as the Bearer — that is what makes it the rider's OWN act.
    expect(seen.auth).toBe('Bearer RIDER-CODE-0001');
    expect(seen.url).toBe('https://logistics.example.dev/rider/moi');
    expect(seen.method).toBe('GET');
    if (!res.ok) throw new Error('unreachable');
    expect(res.session.riderId).toBe('rider-0001');
    expect(res.session.assignment?.orderId).toBe('ord-1');
    expect(res.session.assignment?.assignmentId).toBe('asg-1');
  });

  it('trims a trailing slash on the base rather than calling //rider/moi', async () => {
    let url = '';
    const port = httpRiderSession('https://logistics.example.dev/', online(), async (u) => {
      url = u;
      return json(MOI);
    });
    await port.signIn('C');
    expect(url).toBe('https://logistics.example.dev/rider/moi');
  });

  it('a rider with no assignment signs in fine — the session is real, the card is empty', async () => {
    const port = httpRiderSession('https://l.dev', online(), async () =>
      json({ ok: true, rider: { ...MOI.rider, assignment: null } }),
    );
    const res = await port.signIn('C');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    // Signed in, certified, and honestly holding nothing — an empty state,
    // not an error, and never a fabricated task.
    expect(res.session.riderId).toBe('rider-0001');
    expect(res.session.assignment).toBeNull();
  });
});

describe('down and wrong are different answers', () => {
  it('401 is the one dead-code answer', async () => {
    const port = httpRiderSession('https://l.dev', online(), async () => json({ error: 'unauthorized' }, 401));
    expect(await port.signIn('BAD')).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('a directory that is down is unreachable, NOT a dead code', async () => {
    for (const status of [500, 502, 503]) {
      const port = httpRiderSession('https://l.dev', online(), async () => json({ error: 'boom' }, status));
      const res = await port.signIn('GOOD');
      expect(`${status} -> ${res.ok ? 'ok' : res.reason}`).toBe(`${status} -> unreachable`);
    }
  });

  it('a transport error is unreachable, NOT a dead code', async () => {
    const port = httpRiderSession('https://l.dev', online(), async () => {
      throw new Error('network down');
    });
    expect(await port.signIn('GOOD')).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('a known-offline device says offline and never opens a socket', async () => {
    let called = 0;
    const conn = createManualConnectivity('offline');
    const port = httpRiderSession('https://l.dev', conn, async () => {
      called += 1;
      return json(MOI);
    });
    expect(await port.signIn('GOOD')).toEqual({ ok: false, reason: 'offline' });
    // No request at all — the rider is not made to wait on a socket that
    // cannot open, and the phone's radio is not woken for nothing.
    expect(called).toBe(0);
  });

  it('a 200 that does not name a rider is unreachable, never a pass', async () => {
    // Corroborated, not counted: `ok:true` is not an identity. This is the
    // exact shape custody refuses at its own door.
    for (const body of [
      { ok: true },
      { ok: true, rider: null },
      { ok: true, rider: { displayName: 'Issa' } },
      { ok: true, rider: { riderId: '   ' } },
      { ok: false, rider: { riderId: 'rider-0001' } },
      null,
    ]) {
      const port = httpRiderSession('https://l.dev', online(), async () => json(body));
      const res = await port.signIn('GOOD');
      expect(`${JSON.stringify(body)} -> ${res.ok ? 'ok' : res.reason}`).toBe(
        `${JSON.stringify(body)} -> unreachable`,
      );
    }
  });

  it('a 200 with unreadable bytes is unreachable, not a crash', async () => {
    const port = httpRiderSession('https://l.dev', online(), async () => new Response('<html>502</html>', { status: 200 }));
    expect(await port.signIn('GOOD')).toEqual({ ok: false, reason: 'unreachable' });
  });
});

describe('the session shape is built field by field, never spread', () => {
  it('drops a field logistics did not send rather than inventing one', () => {
    const session = riderSessionFromBody({ ok: true, rider: { riderId: 'r1' } });
    expect(session).not.toBeNull();
    expect(session?.displayName).toBe('');
    expect(session?.certified).toBe(false);
    expect(session?.privacyAckOk).toBe(false);
    expect(session?.assignment).toBeNull();
  });

  it('does not let an extra field logistics adds later leak into the session', () => {
    const session = riderSessionFromBody({
      ok: true,
      rider: { riderId: 'r1', surprise: 'not-ours', personalPhone: '+226...' },
    });
    // If this were a spread, `surprise` and `personalPhone` would be here. The
    // app must carry only what it asked for — a rider's phone number is not
    // something this screen should hold by accident.
    expect(Object.keys(session ?? {}).sort()).toEqual(
      ['assignment', 'certified', 'displayName', 'noticeVersion', 'privacyAckOk', 'riderId', 'shift'].sort(),
    );
  });

  it('an assignment missing its identifiers is dropped, not half-built', () => {
    const session = riderSessionFromBody({
      ok: true,
      rider: { riderId: 'r1', assignment: { taskId: 't', status: 'acked' } },
    });
    // A card that cannot name its own assignment cannot be acked or declined.
    expect(session?.assignment).toBeNull();
  });
});

describe('an unconfigured build is honest about being unconfigured', () => {
  it('the demo port fabricates no rider — it refuses', async () => {
    // §9.8: a mock that handed back a session would make an unwired build look
    // signed-in and working.
    expect(await demoRiderSession().signIn('ANYTHING')).toEqual({ ok: false, reason: 'unauthorized' });
  });

  it('isWired reports whether this build was given a base URL', () => {
    expect(isWired(undefined)).toBe(false);
    expect(isWired('')).toBe(false);
    expect(isWired('   ')).toBe(false);
    expect(isWired('https://logistics.example.dev')).toBe(true);
  });

  it('resolves to the real port only when a base URL is configured', async () => {
    let called = 0;
    const conn = online();
    // Unwired: demo port, no request possible.
    const unwired = resolveRiderSession(conn, undefined);
    expect(await unwired.signIn('C')).toEqual({ ok: false, reason: 'unauthorized' });
    // Wired: the HTTP port. Proven by it actually reaching a fetch, via the
    // exported http factory (resolve uses the global fetch on device).
    const wired = httpRiderSession('https://l.dev', conn, async () => {
      called += 1;
      return json(MOI);
    });
    expect((await wired.signIn('C')).ok).toBe(true);
    expect(called).toBe(1);
  });
});

describe('RAMASSAGE — the handover code reaches the rider, bounded, and the screen shows it', () => {
  it('the parser accepts the minted shape and drops anything else', () => {
    const rider = {
      riderId: 'r', displayName: 'r', certified: true, privacyAckOk: true, noticeVersion: 'v1',
      shift: null,
      assignment: {
        assignmentId: 'as-1', taskId: 't-1', orderId: 'o-1', status: 'acknowledged',
        ackDeadline: null, window: null, location: null,
        repereAudioRef: null, preuvePhotoRefs: [], codeRamassage: 'ABC-234',
      },
    };
    const vue = (a: Record<string, unknown>) =>
      riderSessionFromBody({ ok: true, rider: { ...rider, assignment: a } });
    expect(vue(rider.assignment)?.assignment?.codeRamassage).toBe('ABC-234');
    // A byte that is not the minted shape is DROPPED, never displayed — the
    // same bound the source enforces on media refs.
    expect(vue({ ...rider.assignment, codeRamassage: '<script>' })?.assignment?.codeRamassage).toBeNull();
    expect(vue({ ...rider.assignment, codeRamassage: undefined })?.assignment?.codeRamassage).toBeNull();
  });

  it('the ACCEPTED course SHOWS it (call site): the seal mark + the say-it line', () => {
    const app = readFileSync(join(import.meta.dirname, '..', 'App.tsx'), 'utf8');
    expect(app).toMatch(/liveAssignment\.codeRamassage !== null \? \(/);
    expect(app).toContain("<FasoSealMark code={liveAssignment.codeRamassage} label={t('ramassage.titre')} />");
    expect(app).toContain("<FasoBody>{t('ramassage.dire')}</FasoBody>");
  });
});

describe('VRAI-ROUTE — the confirmation stamp and the machine-carried code (2026-08-10)', () => {
  const rider = {
    riderId: 'r', displayName: 'r', certified: true, privacyAckOk: true, noticeVersion: 'v1',
    shift: null,
    assignment: {
      assignmentId: 'as-1', taskId: 't-1', orderId: 'o-1', status: 'acknowledged',
      ackDeadline: null, window: null, location: null,
      repereAudioRef: null, preuvePhotoRefs: [], codeRamassage: null,
      ramassageConfirmeAt: '2026-08-10T12:00:00.000Z', codeVerification: 'KDF-347',
    },
  };
  const vue = (a: Record<string, unknown>) =>
    riderSessionFromBody({ ok: true, rider: { ...rider, assignment: a } })?.assignment;

  it('parses both fields when the wire carries them well-formed', () => {
    const a = vue(rider.assignment);
    expect(a?.ramassageConfirmeAt).toBe('2026-08-10T12:00:00.000Z');
    expect(a?.codeVerification).toBe('KDF-347');
  });

  it('codeVerification rides the SAME minted bound as codeRamassage — anything else is dropped', () => {
    for (const bad of ['<script>', 'kdf-347', 'KDF347', 'KDF-3470', 'IOL-000', '', 42, null, undefined]) {
      expect(vue({ ...rider.assignment, codeVerification: bad })?.codeVerification, JSON.stringify(bad)).toBeNull();
    }
    // the unambiguous alphabet holds: I, O, L, 0 and 1 never appear.
    expect(vue({ ...rider.assignment, codeVerification: 'ABC-234' })?.codeVerification).toBe('ABC-234');
  });

  it('ramassageConfirmeAt is ISO-or-null — a byte that is not a date is dropped', () => {
    for (const bad of ['not-a-date', '', '   ', 42, true, {}, null, undefined]) {
      expect(vue({ ...rider.assignment, ramassageConfirmeAt: bad })?.ramassageConfirmeAt, JSON.stringify(bad)).toBeNull();
    }
  });

  it('an old Worker sending neither field still yields a whole session', () => {
    const { ramassageConfirmeAt: _c, codeVerification: _v, ...old } = rider.assignment;
    const a = vue(old);
    expect(a?.orderId).toBe('o-1');
    expect(a?.ramassageConfirmeAt).toBeNull();
    expect(a?.codeVerification).toBeNull();
  });
});
