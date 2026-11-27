import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
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
const NOTICE = "Un envoi n'a pas pu être enregistré.";

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
  it('the second alert is sent at once, beside the first one still in the air, and the first one’s late 200 never marks it « reçue »', async () => {
    // The first alert's POST hangs on a bad connection until we let it go.
    // Séra takes that first alert and refuses every other one, so the second
    // alert stays owed.
    const gate: { open?: () => void } = {};
    let firstId: string | null = null;
    const board: Board = { incidents: new Map(), refuse: (id) => id !== firstId };
    const slowFirst = (inner: typeof fetch): typeof fetch =>
      (async (input: string, init?: RequestInit): Promise<Response> => {
        if (firstId === null && String(input).endsWith('/rider/sos')) {
          firstId = JSON.parse(String(init?.body))['command_id'] as string;
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
    expect(s.shows(SENDING), 'the sheet did not close').toBe(false);

    await s.press('SOS');
    await holdSos(s);
    // The first alert is still held on the wire: the second one went anyway,
    // on its own, and Séra refused it — so it is owed, and says so.
    const sent = sosCalls(w).map((c) => c.body?.['command_id']);
    expect(sent.filter((id) => id !== firstId), 'the second alert waited behind the first').toHaveLength(1);
    expect(sent.filter((id) => id === firstId), 'the first alert was sent again, ahead of the second').toHaveLength(0);
    expect(board.incidents.size).toBe(0);
    expect(s.shows(NOT_YET), JSON.stringify(s.texts())).toBe(true);

    // Now the first alert's request lands, late, and Séra has it.
    gate.open!();
    for (let i = 0; i < 8; i += 1) await s.settle();
    expect([...board.incidents.keys()], 'only the first alert reached Séra').toEqual([firstId]);
    expect(s.shows(RECEIVED), 'the second alert was refused; the sheet must not say Séra has it').toBe(false);
    expect(s.shows(NOT_YET)).toBe(true);
  }, 20_000);
});

describe('⚠ the escalated sheet has its way out too', () => {
  it('on a wired build (no stand-in ack) the escalated sheet offers « Fermer », pressable, and it closes the sheet', async () => {
    // A wired build never reaches « escalated » today (the dispatch hours are a
    // fixed in-hours value), so the REAL sheet is mounted in that state.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { SosSheet } = await import('../src/ui/faso-sos');
    const { t } = await import('../src/i18n');
    const label = (k: string): string => `«${k}»`;
    const strings = {
      title: label('title'), confirmHint: label('confirmHint'), hold: label('hold'), cancel: label('cancel'),
      holdNote: label('holdNote'), queued: label('queued'), queuedHint: label('queuedHint'), raised: label('raised'),
      raisedHint: label('raisedHint'), escalated: label('escalated'), escalatedHint: label('escalatedHint'),
      transportPending: label('transportPending'), acknowledged: label('acknowledged'),
      acknowledgedHint: label('acknowledgedHint'), previewAck: label('previewAck'),
      previewAckEscalated: label('previewAckEscalated'), safe: label('safe'), over: label('over'),
      overHint: label('overHint'), close: t('sos.close'),
    };
    let cancelled = 0;
    const sheet = (sandbox: boolean) =>
      React.createElement(SosSheet, {
        state: 'escalated',
        strings,
        onHoldStart: () => undefined,
        onHoldEnd: () => undefined,
        onCancel: () => {
          cancelled += 1;
        },
        ...(sandbox ? { onSandboxAck: () => undefined } : {}),
        onSafe: () => undefined,
        onClose: () => undefined,
      });
    const closers = (tree: ReactTestRenderer) =>
      tree.root.findAll(
        (n) => typeof n.type === 'string' && typeof n.props['onPress'] === 'function' && textOf(n) === t('sos.close'),
      );

    let wired!: ReactTestRenderer;
    await act(async () => {
      wired = create(sheet(false));
    });
    expect(closers(wired), `exactly one « ${t('sos.close')} ». On screen: ${JSON.stringify(wired.root.findAllByType('Text' as never).map(textOf))}`).toHaveLength(1);
    const close = closers(wired)[0]!;
    for (let n: ReactTestInstance | null = close; n !== null; n = (n.parent as ReactTestInstance | null) ?? null) {
      expect(n.props['pointerEvents'], '« Fermer » is rendered but unreachable').not.toBe('none');
    }
    expect(close.props['disabled']).not.toBe(true);
    await act(async () => {
      (close.props['onPress'] as () => void)();
    });
    expect(cancelled, '« Fermer » is wired to nothing').toBe(1);

    // The demo, which has its stand-in ack, is unchanged: no « Fermer » there.
    let demo!: ReactTestRenderer;
    await act(async () => {
      demo = create(sheet(true));
    });
    expect(closers(demo)).toHaveLength(0);
    act(() => {
      wired.unmount();
      demo.unmount();
    });
  }, 20_000);
});

describe('⚠ the « not saved » warning stays while something is still owed', () => {
  it('a refused save that Séra also refused: an empty drain later does not clear the warning', async () => {
    const board: Board = { incidents: new Map(), refuse: () => true };
    const { s, w } = await onCourse([logistiqueCourse(freshCourse(), ORDER), sosBoard(board)]);

    disk.__refuseWrites('sera-outbox');
    await s.press('SOS');
    await holdSos(s);
    expect(s.shows(NOT_YET), JSON.stringify(s.texts())).toBe(true);
    expect(s.shows(NOTICE), 'the rider was not told the alert could not be saved').toBe(true);

    // The next poll drains an outbox that owes nothing — but the alert that was
    // never saved is still owed, and Séra refuses it again.
    await s.poll();
    const ids = sosCalls(w).map((c) => c.body?.['command_id']);
    expect(ids.length, 'the unsaved alert was not sent again').toBeGreaterThanOrEqual(2);
    expect(new Set(ids).size).toBe(1);
    expect(board.incidents.size).toBe(0);
    expect(s.shows(NOTICE), 'an empty drain cleared the warning while the alert is still owed').toBe(true);
  }, 20_000);

  const HALF = '[{"commandId":"7d0c5e1a-0000-4000-8000-000000000001","kind":"sos.raise","payload":{"riderId":"rid';

  it('half an outbox file on the phone before the app opens: the rider is told', async () => {
    disk.__seed('sera-outbox.json', HALF);
    const { s } = await onCourse([logistiqueCourse(freshCourse(), ORDER)]);
    expect(s.shows(NOTICE), `the damaged file was set aside in silence. On screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(Object.entries(disk.__files()).filter(([n]) => n.startsWith('sera-outbox.damaged-')).map(([, b]) => b)).toEqual([HALF]);
  }, 20_000);

  it('an empty outbox file on the phone before the app opens: the rider is told', async () => {
    // Zero bytes is never something the app writes; it is a list that was lost.
    disk.__seed('sera-outbox.json', '');
    const { s } = await onCourse([logistiqueCourse(freshCourse(), ORDER)]);
    expect(s.shows(NOTICE), `the empty file was read as an empty list, in silence. On screen: ${JSON.stringify(s.texts())}`).toBe(true);
    expect(Object.entries(disk.__files()).filter(([n]) => n.startsWith('sera-outbox.damaged-')).map(([, b]) => b)).toEqual(['']);
  }, 20_000);

  it('a file set aside, then an empty drain: the warning stays, because what it held was never sent', async () => {
    disk.__seed('sera-outbox.json', HALF);
    const { s } = await onCourse([logistiqueCourse(freshCourse(), ORDER)]);
    await s.poll();
    expect(s.shows(NOTICE), 'an empty drain cleared the warning over a file set aside').toBe(true);
  }, 20_000);
});

describe('⚠ an older alert never speaks for the sheet of a newer one', () => {
  it('an unsaved first alert’s late 200 does not mark the second, refused, alert « reçue »', async () => {
    // Nothing can be saved; the first alert's POST hangs until we let it go;
    // Séra takes that first alert and refuses every other one.
    const gate: { open?: () => void } = {};
    let firstId: string | null = null;
    const board: Board = { incidents: new Map(), refuse: (id) => id !== firstId };
    const slowFirst = (inner: typeof fetch): typeof fetch =>
      (async (input: string, init?: RequestInit): Promise<Response> => {
        if (firstId === null && String(input).endsWith('/rider/sos')) {
          firstId = JSON.parse(String(init?.body))['command_id'] as string;
          await new Promise<void>((r) => {
            gate.open = r;
          });
        }
        return inner(input, init);
      }) as typeof fetch;
    const { s, w } = await onCourse([logistiqueCourse(freshCourse(), ORDER), sosBoard(board)], slowFirst);

    disk.__refuseWrites('sera-outbox');
    await s.press('SOS');
    await holdSos(s);
    expect(gate.open, 'the first, unsaved alert is on the wire').toBeDefined();
    expect(s.shows(SENDING)).toBe(true);
    await s.press('Fermer');

    await s.press('SOS');
    await holdSos(s);
    expect(sosCalls(w).filter((c) => c.body?.['command_id'] !== firstId), 'the second alert was sent').toHaveLength(1);
    expect(s.shows(NOT_YET), JSON.stringify(s.texts())).toBe(true);

    gate.open!();
    for (let i = 0; i < 8; i += 1) await s.settle();
    expect([...board.incidents.keys()]).toEqual([firstId]);
    expect(s.shows(RECEIVED), 'the first alert’s late 200 marked the refused second one « reçue »').toBe(false);
    expect(s.shows(NOT_YET)).toBe(true);
  }, 20_000);

  it('an old alert’s 200 landing while the next one is being confirmed does not carry « reçue » onto it', async () => {
    // Every alert's POST waits until we let it go, one by one.
    const held = new Map<string, () => void>();
    const holdEach = (inner: typeof fetch): typeof fetch =>
      (async (input: string, init?: RequestInit): Promise<Response> => {
        if (String(input).endsWith('/rider/sos')) {
          const id = JSON.parse(String(init?.body))['command_id'] as string;
          await new Promise<void>((r) => {
            held.set(id, r);
          });
        }
        return inner(input, init);
      }) as typeof fetch;
    const board: Board = { incidents: new Map(), refuse: () => false };
    const { s } = await onCourse([logistiqueCourse(freshCourse(), ORDER), sosBoard(board)], holdEach);

    await s.press('SOS');
    await holdSos(s);
    const [first] = [...held.keys()];
    expect(first, 'the first alert is on the wire').toBeDefined();
    await s.press('Fermer');

    // The rider opens the sheet again; while he is still to hold, the first
    // alert's 200 lands.
    await s.press('SOS');
    expect(s.shows(HOLD)).toBe(true);
    held.get(first!)!();
    for (let i = 0; i < 8; i += 1) await s.settle();
    expect([...board.incidents.keys()]).toEqual([first]);

    await holdSos(s);
    const second = [...held.keys()].find((id) => id !== first);
    expect(second, 'the second alert is on the wire').toBeDefined();
    expect(s.shows(RECEIVED), 'the second alert is still in the air; « reçue » was carried over from the first').toBe(false);
    expect(s.shows(SENDING)).toBe(true);

    held.get(second!)!();
    for (let i = 0; i < 8; i += 1) await s.settle();
    expect(board.incidents.size).toBe(2);
    expect(s.shows(RECEIVED)).toBe(true);
  }, 20_000);
});
