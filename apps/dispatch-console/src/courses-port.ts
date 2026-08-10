import { boardCourses, type CourseRow } from './courses';
import { logisticsBase, type OpsAnswer } from './rider-codes-port';

/**
 * ═══ PURGE-ESSAI · the courses desk's wire ═══
 *
 * The second live port in this console, and it deliberately reuses the first
 * one's grammar: the SAME `OpsAnswer` taxonomy (`ok` · `bad_key` · `refused` ·
 * `unreachable`), the SAME in-memory ops key, the SAME bounded request. A
 * refusal and an unreachable service are never merged — one means « it
 * happened and the answer was no », the other « it did not happen », and a
 * destructive desk that confused them would report a removal that never ran.
 *
 * THERE IS NO « RETIRER TOUT » CALL HERE, and there must not be. The server
 * has one door and it takes ONE order; the sweep is a loop in the screen over
 * the rows the founder can see. A single request that empties a board is one
 * fat finger away from erasing a live one.
 */

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** What the retire door answered, for the ONE order it was asked about. */
export type RetraitStatus = 'retire' | 'inconnu';

export interface CoursesPort {
  board(): Promise<OpsAnswer<readonly CourseRow[]>>;
  /** `inconnu` is a SUCCESS: the board no longer holds that order, which is
   *  what the founder asked for. A re-run of the sweep converges. */
  retirer(orderId: string): Promise<OpsAnswer<RetraitStatus>>;
}

const TIMEOUT_MS = 15_000;

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

/** A locally-minted command id: required by every ops door, and never reused
 *  across taps so a retried removal is a fresh, honest act. */
function commandId(orderId: string): string {
  return `cmd-console-retirer-${orderId}-${crypto.randomUUID()}`;
}

/** The door's own two answers, and nothing invented for a third. */
function statusOf(body: unknown): RetraitStatus | null {
  const status = body !== null && typeof body === 'object' ? (body as Record<string, unknown>)['status'] : null;
  if (status === 'retire' || status === 'inconnu') return status;
  return null;
}

export function httpCourses(
  base: string,
  opsKey: string,
  fetchFn: FetchFn = globalThis.fetch,
  timeoutMs: number = TIMEOUT_MS,
): CoursesPort {
  const root = base.replace(/\/+$/, '');

  async function call<T>(path: string, init: RequestInit, take: (body: unknown) => T): Promise<OpsAnswer<T>> {
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
    board: () => call('/ops/board', { method: 'GET' }, boardCourses),
    async retirer(orderId: string): Promise<OpsAnswer<RetraitStatus>> {
      const answer = await call(
        '/ops/order/retirer',
        { method: 'POST', body: JSON.stringify({ command_id: commandId(orderId), orderId }) },
        statusOf,
      );
      if (answer.kind !== 'ok') return answer;
      // A 200 THAT DOES NOT NAME A STATUS IS NOT A REMOVAL. Treating it as
      // one would tell the founder a course left the board when it may still
      // be there — and the very next board read is what he would then
      // disbelieve. It is reported as a refusal, by name.
      if (answer.value === null) return { kind: 'refused', reason: 'reponse_sans_statut' };
      return { kind: 'ok', value: answer.value };
    },
  };
}

/** No base configured: the desk says so rather than showing an empty board
 *  that reads as « nothing to retire ». */
export function unwiredCourses(): CoursesPort {
  const no = async (): Promise<OpsAnswer<never>> => ({ kind: 'unreachable' });
  return { board: no, retirer: no };
}

export function resolveCourses(opsKey: string, base: string = logisticsBase()): CoursesPort {
  const trimmed = base.trim();
  return trimmed === '' ? unwiredCourses() : httpCourses(trimmed, opsKey);
}
