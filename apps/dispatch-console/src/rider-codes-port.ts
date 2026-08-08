import type { RiderRow } from './rider-codes';

/**
 * ═══ SE-LIVE-4e · THE FIRST REAL WIRE IN THIS CONSOLE ═══
 *
 * Until now the dispatch console was entirely sandbox — `buildSandboxWorld`,
 * no `fetch` anywhere. This is its first call to a live service, so the seam is
 * a PORT with an injected `fetch`: the decisions are testable without a server,
 * and the adapter is driven against the REAL logistics Worker in miniflare
 * (`services/logistics-service/test/rider-codes.e2e.test.ts`).
 *
 * ⚠ THE OPS KEY IS THE FOUNDER'S AND LIVES IN MEMORY ONLY. It is typed into
 * the key screen and held in a variable for the session — never localStorage,
 * never sessionStorage, never a URL, never a log. Boutik+'s console persists
 * its key to the device; this one does not, deliberately: `SERA_OPS_SECRET`
 * opens the rider registry AND the SOS board for every rider in the system,
 * this console runs on the founder's own machine where retyping costs him one
 * line, and a secret that is never written cannot be read off the disk later.
 * If he asks for persistence it is a one-function change; the default is the
 * safer one.
 *
 * ⚠ AND IT IS NEVER BUNDLED. There is no `VITE_*` key here and there must
 * never be — an env var in a Vite app is inlined into the built asset, and
 * these repos are public. Only the base URL is configuration.
 */

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export type OpsAnswer<T> =
  | { readonly kind: 'ok'; readonly value: T }
  /** The key was refused. One door, one sentence — the caller escalates. */
  | { readonly kind: 'bad_key' }
  /** The server answered, and said no by name (`unknown_rider`,
   *  `already_registered`…). A refusal is a fact, not a failure. */
  | { readonly kind: 'refused'; readonly reason: string }
  /** Nothing came back. Never confused with a refusal — one means « it did not
   *  happen », the other means « it happened and the answer was no ». */
  | { readonly kind: 'unreachable' };

export interface RiderCodesPort {
  list(): Promise<OpsAnswer<readonly RiderRow[]>>;
  register(rider: { riderId: string; displayName: string; phoneAlias: string }): Promise<OpsAnswer<null>>;
  mint(riderId: string): Promise<OpsAnswer<string>>;
  revoke(riderId: string): Promise<OpsAnswer<null>>;
}

const TIMEOUT_MS = 15_000;

/** Bounded like every other request in this ecosystem — a call that hangs is a
 *  founder staring at a spinner with no way to tell what happened. */
async function within(fetchFn: FetchFn, url: string, init: RequestInit, ms: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readReason(body: unknown): string {
  if (body === null || typeof body !== 'object') return 'unknown';
  const reason = (body as Record<string, unknown>)['reason'];
  return typeof reason === 'string' && reason !== '' ? reason : 'unknown';
}

/**
 * Defensive: this crosses the network into the founder's only rider surface,
 * and a malformed row must not blank the desk. Rows that do not name a rider
 * are dropped rather than rendered as ghosts.
 *
 * ⚠ THE DESK IS A JOIN OF TWO ROUTES. `GET /ops/riders` carries the registry
 * (id, name, certified, shift); `GET /ops/rider-codes` carries which riders
 * hold a live code and since when. There is no `hasCode` field on the first —
 * I assumed one, read the Worker, and found it absent. Two calls, joined here.
 */
function riderRows(ridersBody: unknown, codesBody: unknown): readonly RiderRow[] {
  const minted = new Map<string, string>();
  if (codesBody !== null && typeof codesBody === 'object') {
    const rawCodes = (codesBody as Record<string, unknown>)['codes'];
    if (Array.isArray(rawCodes)) {
      for (const entry of rawCodes) {
        if (entry === null || typeof entry !== 'object') continue;
        const c = entry as Record<string, unknown>;
        if (typeof c['riderId'] === 'string' && c['riderId'] !== '') {
          minted.set(c['riderId'], typeof c['mintedAt'] === 'string' ? c['mintedAt'] : '');
        }
      }
    }
  }

  if (ridersBody === null || typeof ridersBody !== 'object') return [];
  const raw = (ridersBody as Record<string, unknown>)['riders'];
  if (!Array.isArray(raw)) return [];
  const out: RiderRow[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    const riderId = typeof r['riderId'] === 'string' ? r['riderId'] : '';
    if (riderId === '') continue;
    const at = minted.get(riderId);
    out.push({
      riderId,
      displayName: typeof r['displayName'] === 'string' && r['displayName'] !== '' ? r['displayName'] : riderId,
      // Absent from the codes projection is FALSE, never « probably yes » —
      // the « minting kills the old one » warning depends on this being right.
      hasCode: at !== undefined,
      ...(at !== undefined && at !== '' ? { mintedAt: at } : {}),
      certified: r['certified'] === true,
    });
  }
  return out;
}

export function httpRiderCodes(
  base: string,
  opsKey: string,
  fetchFn: FetchFn = globalThis.fetch,
  timeoutMs: number = TIMEOUT_MS,
): RiderCodesPort {
  const root = base.replace(/\/+$/, '');

  async function call<T>(
    path: string,
    init: RequestInit,
    take: (body: unknown) => T,
  ): Promise<OpsAnswer<T>> {
    const res = await within(
      fetchFn,
      `${root}${path}`,
      {
        ...init,
        // The key rides the Authorization header and nowhere else — never a
        // query string, which lands in logs and browser history.
        headers: { Authorization: `Bearer ${opsKey}`, 'Content-Type': 'application/json' },
      },
      timeoutMs,
    );
    if (res === null) return { kind: 'unreachable' };
    if (res.status === 401 || res.status === 403) return { kind: 'bad_key' };
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { kind: 'refused', reason: readReason(body) };
    return { kind: 'ok', value: take(body) };
  }

  return {
    /** Two reads, joined. A failure of EITHER is a failed desk — showing the
     *  roster with every code silently marked absent would tell the founder
     *  that minting is safe when it may destroy a working rider's code. */
    async list(): Promise<OpsAnswer<readonly RiderRow[]>> {
      const roster = await call('/ops/riders', { method: 'GET' }, (b) => b);
      if (roster.kind !== 'ok') return roster;
      const codes = await call('/ops/rider-codes', { method: 'GET' }, (b) => b);
      if (codes.kind !== 'ok') return codes;
      return { kind: 'ok', value: riderRows(roster.value, codes.value) };
    },
    register: (rider) =>
      call('/ops/riders', { method: 'POST', body: JSON.stringify(rider) }, () => null),
    mint: (riderId) =>
      call('/ops/rider-code/mint', { method: 'POST', body: JSON.stringify({ riderId }) }, (body) => {
        const code = body !== null && typeof body === 'object' ? (body as Record<string, unknown>)['code'] : null;
        // A 200 that does not carry a code is not a minted code. Returning ''
        // would put an empty card on screen and lose the real one.
        return typeof code === 'string' ? code : '';
      }),
    revoke: (riderId) =>
      call('/ops/rider-code/revoke', { method: 'POST', body: JSON.stringify({ riderId }) }, () => null),
  };
}

/**
 * A console with no logistics base cannot reach the registry, and must say so
 * rather than render an empty desk that looks like « no riders yet ».
 */
export function unwiredRiderCodes(): RiderCodesPort {
  const no = async (): Promise<OpsAnswer<never>> => ({ kind: 'unreachable' });
  return { list: no, register: no, mint: no, revoke: no };
}

/**
 * The base URL is CONFIGURATION, not a secret — it is the same public address
 * `/health` answers on. Read from the build env when present; the console is a
 * local founder tool, so an unset base is an ordinary state that says so
 * rather than a crash.
 */
export function logisticsBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  const raw = env?.['VITE_SERA_LOGISTICS_BASE'];
  return typeof raw === 'string' ? raw.trim() : '';
}

export function resolveRiderCodes(opsKey: string, base: string = logisticsBase()): RiderCodesPort {
  const trimmed = base.trim();
  return trimmed === '' ? unwiredRiderCodes() : httpRiderCodes(trimmed, opsKey);
}
