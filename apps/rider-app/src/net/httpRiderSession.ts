import type { ConnectivityPort } from '../offline/connectivity';
import { riderSessionFromBody, type RiderSessionPort, type SignInResult } from './rider-session';

/**
 * SE-LIVE-4c-i · the DEVICE binding for the rider session port — a real
 * `GET {base}/rider/moi` on the logistics Worker, the rider's personal code as
 * the Bearer.
 *
 * `fetch` is injected (defaulting to the global) so the port is tested with a
 * fake and this file carries no untested branching — the same discipline
 * `expoConnectivity` follows for the native network surface.
 *
 * THE OFFLINE CHECK RUNS FIRST, before any request: a device that knows it is
 * offline must not make the rider wait on a socket that cannot open, and
 * « offline » is a truthful answer the connectivity port already holds. This
 * is the read-side of SE-I06 — the app never invents connectivity.
 */
type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * ⚠ VERIFIER BLOCKER A5 — A STALLED SOCKET USED TO HANG THE ONLY DOOR IN THE
 * APP. React Native's `fetch` carries no default timeout, and `connectivity`
 * can read « online » while nothing completes: a captive-portal Wi-Fi, a 2G
 * cell that associates but never delivers, or simply the seed race in
 * `expoConnectivity` (it reads the real state asynchronously, so a cold start
 * on a dead network reports online until the first read lands). While
 * `working`, the screen disables BOTH the button and the field — so with no
 * timeout the rider's only exit was force-quitting the app.
 *
 * Every request is now bounded. The abort surfaces as `unreachable`, which is
 * already the « try again in a moment » sentence — never « your code is dead ».
 */
const REQUEST_TIMEOUT_MS = 15_000;

/** Run `fetch` with a hard deadline. Returns null when the deadline (or the
 *  transport) killed it — the caller turns that into `unreachable`. */
async function fetchWithin(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
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


const MOI_PATH = '/rider/moi';

export function httpRiderSession(
  base: string,
  connectivity: ConnectivityPort,
  fetchFn: FetchFn = globalThis.fetch,
  /** Injectable so the deadline itself is testable in milliseconds. */
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): RiderSessionPort {
  const root = base.replace(/\/+$/, '');
  return {
    async signIn(code: string): Promise<SignInResult> {
      if (connectivity.current() === 'offline') return { ok: false, reason: 'offline' };
      // Transport error or deadline — the directory did not answer. « Try
      // again », not « your code is dead ».
      const res = await fetchWithin(fetchFn, `${root}${MOI_PATH}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${code}` },
      }, timeoutMs);
      if (res === null) return { ok: false, reason: 'unreachable' };
      // 401 is the ONE « wrong code » answer logistics gives (uniform, no
      // oracle). 5xx is the directory failing. Anything else that is not a
      // clean 200-with-session is ambiguous, and the rider-kind reading of an
      // ambiguous answer is « unreachable » — we never tell a rider whose code
      // may be perfectly good that it is dead.
      if (res.status === 401) return { ok: false, reason: 'unauthorized' };
      if (res.status !== 200) return { ok: false, reason: 'unreachable' };
      const body = (await res.json().catch(() => null)) as unknown;
      const session = riderSessionFromBody(body);
      // A 200 whose body is not the shape we require is a directory we cannot
      // read — corroborated, not counted (the custody-door lesson): treat it
      // as unreachable, never as a pass.
      return session === null ? { ok: false, reason: 'unreachable' } : { ok: true, session };
    },
  };
}
