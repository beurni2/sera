import { boardCourses, type CourseRow } from './courses';
import { aReprogrammerRows, enDeuxiemePassageRows, type DeuxiemePassageRow, type ReprogRow } from './reprogrammation';
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

/** REPROGRAMMATION-1 — the next passage, two ISO instants. */
export interface FenetrePassage {
  readonly start: string;
  readonly end: string;
}

export interface CoursesPort {
  board(): Promise<OpsAnswer<readonly CourseRow[]>>;
  /** `inconnu` is a SUCCESS: the board no longer holds that order, which is
   *  what the founder asked for. A re-run of the sweep converges. */
  retirer(orderId: string): Promise<OpsAnswer<RetraitStatus>>;
  /** REPROGRAMMATION-1 — the courses custody sent back for a next passage,
   *  off the SAME board read the courses desk uses. */
  reprogrammations(): Promise<OpsAnswer<readonly ReprogRow[]>>;
  /** Fix the next passage: the door opens the follow-up task and moves the
   *  live course onto it. The follow-up's id comes home so the desk can say
   *  the fix is REAL — a 200 that names no task is reported as a refusal.
   *  The command id is the DESK's (one per attempt, reused on a retry of the
   *  same window), so the door's replay ledger answers a retried tap. */
  reprogrammer(orderId: string, fenetre: FenetrePassage, commandId: string): Promise<OpsAnswer<{ readonly taskId: string }>>;
  /** REPROGRAMMATION-2 — the live courses already on their follow-up task,
   *  off the same board read. */
  deuxiemesPassages(): Promise<OpsAnswer<readonly DeuxiemePassageRow[]>>;
  /** Send a rescheduled package home. The door relays to custody FIRST and
   *  answers only on custody's word; the instant it answers is custody's.
   *  A 200 that names no instant is reported as a refusal — the rider's phone
   *  would not have turned, and the desk must not say it did. */
  renvoyer(orderId: string, commandId: string): Promise<OpsAnswer<{ readonly decideAt: string }>>;
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

/** The reprogram door's own id, minted by the DESK once per attempt: a retry
 *  of the same window rides the same id (the door replays the fix it made),
 *  a changed window is a new act. */
export function reprogCommandId(orderId: string): string {
  return `cmd-console-reprog-${orderId}-${crypto.randomUUID()}`;
}

function taskIdOf(body: unknown): { taskId: string } | null {
  const taskId = body !== null && typeof body === 'object' ? (body as Record<string, unknown>)['taskId'] : null;
  return typeof taskId === 'string' && taskId !== '' ? { taskId } : null;
}

/** The decider door's own id, minted once per order on the desk and reused
 *  on a retry: logistics answers `deja_decide` by state, and custody replays
 *  the relayed command by this id if logistics' own write was lost. */
export function renvoiCommandId(orderId: string): string {
  return `cmd-console-renvoi-${orderId}-${crypto.randomUUID()}`;
}

function decideAtOf(body: unknown): { decideAt: string } | null {
  const decideAt = body !== null && typeof body === 'object' ? (body as Record<string, unknown>)['decideAt'] : null;
  return typeof decideAt === 'string' && decideAt !== '' ? { decideAt } : null;
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
    reprogrammations: () => call('/ops/board', { method: 'GET' }, aReprogrammerRows),
    async reprogrammer(orderId: string, fenetre: FenetrePassage, commandId: string): Promise<OpsAnswer<{ readonly taskId: string }>> {
      const answer = await call(
        '/ops/reprogrammer',
        { method: 'POST', body: JSON.stringify({ command_id: commandId, orderId, fenetre }) },
        taskIdOf,
      );
      if (answer.kind !== 'ok') return answer;
      // A 200 THAT NAMES NO FOLLOW-UP TASK IS NOT A FIXED PASSAGE (the retire
      // door's own law): the rider's phone would show nothing new, and the
      // desk would have told the founder otherwise.
      if (answer.value === null) return { kind: 'refused', reason: 'reponse_sans_tache' };
      return { kind: 'ok', value: answer.value };
    },
    deuxiemesPassages: () => call('/ops/board', { method: 'GET' }, enDeuxiemePassageRows),
    async renvoyer(orderId: string, commandId: string): Promise<OpsAnswer<{ readonly decideAt: string }>> {
      const answer = await call(
        '/ops/retour/decider',
        { method: 'POST', body: JSON.stringify({ command_id: commandId, orderId }) },
        decideAtOf,
      );
      if (answer.kind !== 'ok') return answer;
      if (answer.value === null) return { kind: 'refused', reason: 'reponse_sans_decision' };
      return { kind: 'ok', value: answer.value };
    },
  };
}

/** No base configured: the desk says so rather than showing an empty board
 *  that reads as « nothing to retire ». */
export function unwiredCourses(): CoursesPort {
  const no = async (): Promise<OpsAnswer<never>> => ({ kind: 'unreachable' });
  return { board: no, retirer: no, reprogrammations: no, reprogrammer: no, deuxiemesPassages: no, renvoyer: no };
}

export function resolveCourses(opsKey: string, base: string = logisticsBase()): CoursesPort {
  const trimmed = base.trim();
  return trimmed === '' ? unwiredCourses() : httpCourses(trimmed, opsKey);
}
