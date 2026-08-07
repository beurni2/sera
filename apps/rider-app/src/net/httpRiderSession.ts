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

const MOI_PATH = '/rider/moi';

export function httpRiderSession(
  base: string,
  connectivity: ConnectivityPort,
  fetchFn: FetchFn = globalThis.fetch,
): RiderSessionPort {
  const root = base.replace(/\/+$/, '');
  return {
    async signIn(code: string): Promise<SignInResult> {
      if (connectivity.current() === 'offline') return { ok: false, reason: 'offline' };
      let res: Response;
      try {
        res = await fetchFn(`${root}${MOI_PATH}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${code}` },
        });
      } catch {
        // Transport error — the directory did not answer. « Try again », not
        // « your code is dead ».
        return { ok: false, reason: 'unreachable' };
      }
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
