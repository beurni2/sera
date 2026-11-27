import { act, type ReactTestInstance } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountRider, wire, wiredEnv, type Route, type Screen } from './rendu';
import { __modeChargement } from './doubles/expo-audio';
import { freshCourse, logistiqueCourse } from './doubles/logistique-course';

/**
 * ═══ RENDU-RÉEL — a rider's SOS, DRIVEN on the wired screens ═══
 *
 * Saving the alert on the phone is the safety net, never the gate: a phone
 * whose disk refuses the save still sends the alert, and the sheet says only
 * what is true. Once Séra has it, the rider is told to call Séra too (nobody
 * is woken at night yet), and he can close the sheet and carry on his course
 * while the alert stays open on Séra's board.
 */

const CODE = 'SR-ABCD-EFGH-JKMN';
const ORDER = 'ord-rendu-sos';
const HOLD = 'Maintenir pour déclencher';
const RECEIVED = "Séra a reçu l'alerte.";
const CALL_TOO = "Restez où vous êtes si c'est sûr. Si vous pouvez, appelez aussi Séra.";
const NOT_YET = 'Alerte pas encore partie.';
const SENDING = "Alerte en cours d'envoi…";

/** The file-system double the mounted app imports — fetched AFTER the module
 *  reset, so the disk this test fills is the disk the app writes to. */
let disk: typeof import('./doubles/expo-file-system');

/**
 * Séra's SOS board, CERTIFIED TO THE REAL WORKER (Execution Contract §3):
 * `POST /rider/sos` answers `{ ok, duplicate, incident, event }`, first-wins on
 * `command_id` (`worker/sos-book.ts` `raise`), and an incident is born
 * `state: 'open'` — only a human at the ops door acknowledges it. `refuse`
 * stands for a Worker that did not answer 200 for this alert.
 */
interface Board {
  readonly incidents: Map<string, { state: 'open' | 'acknowledged' }>;
  refuse: (commandId: string) => boolean;
}
function sosBoard(board: Board): Route {
  return (path, body) => {
    if (path !== '/rider/sos') return null;
    const id = body?.['command_id'];
    if (typeof id !== 'string' || id === '') return { status: 400, json: { ok: false, error: 'malformed' } };
    if (board.refuse(id)) return { status: 503, json: { ok: false, error: 'unavailable' } };
    const duplicate = board.incidents.has(id);
    if (!duplicate) board.incidents.set(id, { state: 'open' });
    return {
      status: 200,
      json: { ok: true, duplicate, incident: { commandId: id, state: board.incidents.get(id)!.state }, event: 'safety.sos_created.v1' },
    };
  };
}

const textOf = (n: ReactTestInstance): string =>
  n.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');

/** The SOS fires on a deliberate HOLD (`onPressIn`, then 650 ms), never on a
 *  tap — so this presses and holds the one control that says so. */
async function holdSos(s: Screen): Promise<void> {
  const controls = s.tree.root.findAll(
    (n) => typeof n.type === 'string' && typeof n.props['onPressIn'] === 'function' && textOf(n).includes(HOLD),
  );
  expect(controls, `exactly one « ${HOLD} » control. On screen: ${JSON.stringify(s.texts())}`).toHaveLength(1);
  await act(async () => {
    (controls[0]!.props['onPressIn'] as () => void)();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(650);
  });
  for (let i = 0; i < 6; i += 1) await s.settle();
}

const sosCalls = (w: { calls: { path: string; body: Record<string, unknown> | null }[] }) =>
  w.calls.filter((c) => c.path.includes('sos'));

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  disk = await import('./doubles/expo-file-system');
  disk.__resetFiles();
  __modeChargement(null);
  wiredEnv();
});
afterEach(() => {
  vi.useRealTimers();
});

/** `around` wraps the wired network BEFORE the app is mounted: the app's SOS
 *  sender takes `fetch` when it is built, at sign-in. */
async function onCourse(routes: readonly Route[], around?: (inner: typeof fetch) => typeof fetch) {
  const w = wire(routes);
  if (around !== undefined) (globalThis as { fetch: unknown }).fetch = around(globalThis.fetch);
  const s = await mountRider();
  await s.type(CODE);
  await s.press('Entrer');
  await s.press('Accepter la course');
  expect(s.shows('Vérifier le colis'), JSON.stringify(s.texts())).toBe(true);
  return { s, w };
}

describe('⚠ an SOS the phone could not save is still sent', () => {
  it('the disk refuses the save: Séra still gets the alert once, the sheet says « reçue » and « appelez aussi Séra », and the rider carries on', async () => {
    const board: Board = { incidents: new Map(), refuse: () => false };
    const { s, w } = await onCourse([logistiqueCourse(freshCourse(), ORDER), sosBoard(board)]);

    disk.__refuseWrites('sera-outbox');
    await s.press('SOS');
    await holdSos(s);

    expect(sosCalls(w), 'the alert never left the phone because it could not be saved').toHaveLength(1);
    const first = sosCalls(w)[0]!.body?.['command_id'] as string;
    expect(board.incidents.get(first)?.state).toBe('open');
    expect(s.shows(RECEIVED), JSON.stringify(s.texts())).toBe(true);
    expect(s.shows(CALL_TOO), JSON.stringify(s.texts())).toBe(true);
    expect(s.shows(SENDING), 'a sheet still « sending » after Séra answered').toBe(false);

    // ⚠ THE WAY OUT. A sent alert used to leave the rider on a sheet with no
    // control at all, over a scrim that swallowed every tap.
    await s.press('Fermer');
    expect(s.shows(RECEIVED), 'the sheet did not close').toBe(false);
    expect(board.incidents.get(first)?.state, 'closing the sheet must not close the alert').toBe('open');
    expect(sosCalls(w), 'closing the sheet sent nothing').toHaveLength(1);

    // …and the course is still his: its next control is there and answers.
    expect(s.canPress('Oui')).toBe(true);
    await s.press('Oui', 2);
    expect(s.texts().length, 'the tree survived').toBeGreaterThan(0);
    expect(s.shows('Vérifier le colis')).toBe(true);

    // A second alert can be raised — the disk has room again, so this one is
    // saved, and it is a SECOND incident, not the first one repeated.
    disk.__refuseWrites(null);
    await s.press('SOS');
    await holdSos(s);
    expect(board.incidents.size).toBe(2);
    const second = sosCalls(w).at(-1)!.body?.['command_id'] as string;
    expect(second).not.toBe(first);
    expect(s.shows(RECEIVED)).toBe(true);
  }, 20_000);

  it('the disk refuses the save AND Séra does not answer: the sheet says « pas encore partie », and the next poll sends it', async () => {
    let down = true;
    const board: Board = { incidents: new Map(), refuse: () => down };
    const { s, w } = await onCourse([logistiqueCourse(freshCourse(), ORDER), sosBoard(board)]);

    disk.__refuseWrites('sera-outbox');
    await s.press('SOS');
    await holdSos(s);
    expect(sosCalls(w), 'the alert never left the phone because it could not be saved').toHaveLength(1);
    expect(s.shows(NOT_YET), JSON.stringify(s.texts())).toBe(true);
    expect(s.shows(RECEIVED)).toBe(false);
    expect(s.shows(SENDING), 'never « en cours d’envoi » for ever').toBe(false);

    // The alert was never saved, so only the phone's memory holds it: the next
    // time the app reaches Séra it must go, with the SAME command_id.
    down = false;
    await s.poll();
    const ids = sosCalls(w).map((c) => c.body?.['command_id']);
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids).size, 'one press, one incident').toBe(1);
    expect(board.incidents.size).toBe(1);
  }, 20_000);
});

describe('⚠ a slow first alert never answers for the second one', () => {
  it('the first alert’s late 200 must not mark the second, refused, alert « reçue »', async () => {
    // Séra takes the first alert it sees and refuses every other one, so the
    // second alert stays owed.
    let firstSeen: string | null = null;
    const board: Board = {
      incidents: new Map(),
      refuse: (id) => {
        if (firstSeen === null) firstSeen = id;
        return id !== firstSeen;
      },
    };
    // The first alert's first POST hangs on a bad connection until we let it go.
    const gate: { open?: () => void } = {};
    let gated = false;
    const slowFirst = (inner: typeof fetch): typeof fetch =>
      (async (input: string, init?: RequestInit): Promise<Response> => {
        if (!gated && String(input).endsWith('/rider/sos')) {
          gated = true;
          await new Promise<void>((r) => {
            gate.open = r;
          });
        }
        return inner(input, init);
      }) as typeof fetch;
    const { s, w } = await onCourse([logistiqueCourse(freshCourse(), ORDER), sosBoard(board)], slowFirst);

    await s.press('SOS');
    await holdSos(s);
    expect(gate.open, 'the first alert is on the wire').toBeDefined();
    expect(s.shows(SENDING)).toBe(true);
    await s.press('Fermer');

    await s.press('SOS');
    await holdSos(s);
    // The second alert's own send carried the first one again (Séra took it)
    // and then itself (Séra refused it): it is still owed, and says so.
    expect(board.incidents.size).toBe(1);
    expect(s.shows(NOT_YET), JSON.stringify(s.texts())).toBe(true);

    // Now the first alert's original request lands, late.
    gate.open!();
    for (let i = 0; i < 8; i += 1) await s.settle();
    expect(board.incidents.size, 'only the first alert reached Séra').toBe(1);
    expect(s.shows(RECEIVED), 'the second alert was refused; the sheet must not say Séra has it').toBe(false);
    expect(s.shows(NOT_YET)).toBe(true);
    expect(sosCalls(w).map((c) => c.body?.['command_id']).filter((id) => id !== firstSeen).length, 'the second alert was sent').toBeGreaterThanOrEqual(1);
  }, 20_000);
});
