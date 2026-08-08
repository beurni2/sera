import type { ConnectivityPort } from '../offline/connectivity';

/**
 * ═══ COURSIER-EN-SERVICE · the rider's THREE service acts, on the real
 * registry (founder report 2026-08-08) ═══
 *
 * ⚠ WHY THIS EXISTS. SE1's own sentence — « certified + on-shift +
 * server-confirmed before assignable » — and the spec's Travail tab —
 * « Commencer service » — were both live on the Worker (`/rider/ack-privacy`,
 * `/rider/shift/start`, `/rider/shift/end`, SE-LIVE-4b) and CALLED BY NOTHING.
 * A port that exists is not a port that is called: the founder registered a
 * real rider, opened the dispatch screen and hit « Aucun coursier libre »
 * forever, because no rider anywhere had a road to on-shift. This file is
 * that road.
 *
 * SAME DISCIPLINE AS `httpRiderSession` (this seam's elder): the code is the
 * Bearer and is CARRIED, never stored; the offline check runs first (SE-I06 —
 * the app never invents connectivity); every request is bounded; a 401 is the
 * one « your code is dead » answer; anything ambiguous reads as `unreachable`,
 * never as a pass and never as « your code is dead ».
 *
 * ⚠ THE SHIFT THE APP SHOWS AFTERWARDS IS THE SERVER'S OWN ANSWER. A 200 from
 * `/rider/shift/*` carries the registry's new `state` — the caller patches the
 * session with THAT, never with what it hoped. (`shiftFromActBody` parses it;
 * a 200 whose body cannot be read is `unreachable`, the corroborated-not-
 * counted law.) Queued-offline never arises on this wire: a command that
 * reached the Worker is server-confirmed by definition, and one that could not
 * be sent returns `offline`/`unreachable` and changes NOTHING on screen.
 */

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 15_000;

async function fetchWithin(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The registry's own refusal names (`ShiftOutcome.reason`), passed through so
 *  the screen can answer each with its own sentence. Anything the server adds
 *  later degrades to the generic refusal, never to a raw token on screen. */
export type RefusService =
  | 'not_certified'
  | 'privacy_notice_not_acknowledged'
  | 'already_on_shift'
  | 'not_on_shift'
  | 'custody_would_be_orphaned'
  | 'autre';

export type ActeServiceResult =
  /** The 200 body's OWN `state` — what the registry now holds, opaque like
   *  `RiderSession.shift` (only `onShiftFromSession` may read it). */
  | { readonly ok: true; readonly shift: unknown }
  | { readonly ok: false; readonly reason: 'unauthorized' | 'offline' | 'unreachable' }
  | { readonly ok: false; readonly reason: 'refused'; readonly refus: RefusService };

export type AckPrivacyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'unauthorized' | 'offline' | 'unreachable' };

export interface ShiftActsPort {
  ackPrivacy(code: string): Promise<AckPrivacyResult>;
  startShift(code: string): Promise<ActeServiceResult>;
  endShift(code: string): Promise<ActeServiceResult>;
}

/** The 200 body → the registry's new shift state, or null when the body is not
 *  the shape the route promises (`{ok:true, state:{status:…}}`). */
export function shiftFromActBody(body: unknown): unknown | null {
  if (body === null || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  if (root['ok'] !== true) return null;
  const state = root['state'];
  if (state === null || typeof state !== 'object') return null;
  if (typeof (state as Record<string, unknown>)['status'] !== 'string') return null;
  return state;
}

/** A refusal body → the registry's named reason, bounded to the names the
 *  screen has sentences for. */
export function refusFromBody(body: unknown): RefusService {
  if (body === null || typeof body !== 'object') return 'autre';
  const reason = (body as Record<string, unknown>)['reason'];
  const known: readonly RefusService[] = [
    'not_certified',
    'privacy_notice_not_acknowledged',
    'already_on_shift',
    'not_on_shift',
    'custody_would_be_orphaned',
  ];
  return known.includes(reason as RefusService) ? (reason as RefusService) : 'autre';
}

/** The catalog key for each refusal — words, never the server's enum. */
export function refusServiceKey(refus: RefusService): string {
  switch (refus) {
    case 'not_certified':
      return 'service.refus_certif';
    case 'privacy_notice_not_acknowledged':
      return 'service.refus_privacy';
    case 'already_on_shift':
    case 'not_on_shift':
      // Both mean « the screen was stale » — the caller refreshes the session
      // and the true state replaces the sentence almost at once.
      return 'service.refus_deja';
    case 'custody_would_be_orphaned':
      return 'service.refus_garde';
    default:
      return 'service.act_failed';
  }
}

export function httpShiftActs(
  base: string,
  connectivity: ConnectivityPort,
  fetchFn: FetchFn = globalThis.fetch,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): ShiftActsPort {
  const root = base.replace(/\/+$/, '');

  async function post(code: string, path: string): Promise<Response | null | 'offline'> {
    if (connectivity.current() === 'offline') return 'offline';
    return fetchWithin(fetchFn, `${root}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${code}` },
    }, timeoutMs);
  }

  async function acte(code: string, path: string): Promise<ActeServiceResult> {
    const res = await post(code, path);
    if (res === 'offline') return { ok: false, reason: 'offline' };
    if (res === null) return { ok: false, reason: 'unreachable' };
    if (res.status === 401) return { ok: false, reason: 'unauthorized' };
    const body = (await res.json().catch(() => null)) as unknown;
    if (res.status === 200) {
      const shift = shiftFromActBody(body);
      return shift === null ? { ok: false, reason: 'unreachable' } : { ok: true, shift };
    }
    // 404/409 carry the registry's named reason; 5xx and the rest are the
    // directory failing, which is « try again », never a refusal invented.
    if (res.status === 404 || res.status === 409) {
      return { ok: false, reason: 'refused', refus: refusFromBody(body) };
    }
    return { ok: false, reason: 'unreachable' };
  }

  return {
    async ackPrivacy(code: string): Promise<AckPrivacyResult> {
      const res = await post(code, '/rider/ack-privacy');
      if (res === 'offline') return { ok: false, reason: 'offline' };
      if (res === null) return { ok: false, reason: 'unreachable' };
      if (res.status === 401) return { ok: false, reason: 'unauthorized' };
      if (res.status !== 200) return { ok: false, reason: 'unreachable' };
      const body = (await res.json().catch(() => null)) as unknown;
      const ok = body !== null && typeof body === 'object' && (body as Record<string, unknown>)['ok'] === true;
      return ok ? { ok: true } : { ok: false, reason: 'unreachable' };
    },
    startShift: (code) => acte(code, '/rider/shift/start'),
    endShift: (code) => acte(code, '/rider/shift/end'),
  };
}

/** UNWIRED ⇒ every act answers `unauthorized`, mirroring `demoRiderSession`:
 *  a build with no Séra must never mime a service state. */
export function demoShiftActs(): ShiftActsPort {
  return {
    async ackPrivacy(): Promise<AckPrivacyResult> {
      return { ok: false, reason: 'unauthorized' };
    },
    async startShift(): Promise<ActeServiceResult> {
      return { ok: false, reason: 'unauthorized' };
    },
    async endShift(): Promise<ActeServiceResult> {
      return { ok: false, reason: 'unauthorized' };
    },
  };
}

export function resolveShiftActs(
  connectivity: ConnectivityPort,
  base: string | undefined = process.env.EXPO_PUBLIC_SERA_LOGISTICS_BASE,
): ShiftActsPort {
  const trimmed = typeof base === 'string' ? base.trim() : '';
  return trimmed === '' ? demoShiftActs() : httpShiftActs(trimmed, connectivity);
}
