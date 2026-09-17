import { describe, expect, it } from 'vitest';
import {
  FIXATION_IDLE,
  RENVOI_IDLE,
  aReprogrammerRows,
  annulerRenvoi,
  commencerFixation,
  commencerRenvoi,
  composerFenetre,
  demanderRenvoi,
  enDeuxiemePassageRows,
  fenetreLisible,
  fixationEchouee,
  fixationFaite,
  raisonKey,
  refusKey,
  renvoiEchoue,
  renvoiFait,
  renvoiRefusKey,
  reprogView,
  saisieKey,
} from '../src/reprogrammation';
import { t } from '../src/i18n';

/**
 * REPROGRAMMATION-1 — the next-passage desk's decisions. Pure, so every state
 * the screen can be in is testable without a browser or a server: what it
 * reads off the board, how it turns the founder's day-and-hours into the two
 * instants the door takes, what it refuses before sending anything, and how
 * it reports a fix or a refusal per course.
 */

const BOARD = {
  ok: true,
  board: {
    queued: [],
    riders: [
      { riderId: 'rider-boss', displayName: 'Boss', certified: true, assignable: false },
      { riderId: 'rider-awa', displayName: '', certified: true, assignable: false },
    ],
    assignments: [],
    aReprogrammer: [
      { orderId: 'ord-b', taskId: 'task-b1', assignmentId: 'as-b', riderId: 'rider-boss', reasonCode: 'honest_absence', recordedAt: '2026-09-17T09:16:00.000Z' },
      { orderId: 'ord-a', taskId: 'task-a1', assignmentId: 'as-a', riderId: 'rider-awa', reasonCode: 'provider_failure', recordedAt: '2026-09-17T08:00:00.000Z' },
      { orderId: '', taskId: 'task-x', riderId: 'rider-boss', reasonCode: 'honest_absence', recordedAt: '' },
      { orderId: 'ord-c', taskId: 'task-c1', assignmentId: 'as-c', reasonCode: 'unusable_location', recordedAt: '2026-09-17T07:00:00.000Z' },
    ],
  },
};

describe('what the board says is waiting for a passage', () => {
  it('reads one row per course, names the rider (display name, else id), keeps the reason and custody’s instant, sorts stably, drops a row that names no order', () => {
    const rows = aReprogrammerRows(BOARD);
    expect(rows.map((r) => r.orderId)).toEqual(['ord-a', 'ord-b', 'ord-c']);
    expect(rows[1]).toEqual({ orderId: 'ord-b', taskId: 'task-b1', riderName: 'Boss', reasonCode: 'honest_absence', recordedAt: '2026-09-17T09:16:00.000Z' });
    // A rider with no display name is named by id — never a blank where a person should be.
    expect(rows[0]).toMatchObject({ riderName: 'rider-awa', reasonCode: 'provider_failure' });
    // A row that names no rider has no name — and is still a course to fix.
    expect(rows[2]).toEqual({ orderId: 'ord-c', taskId: 'task-c1', reasonCode: 'unusable_location', recordedAt: '2026-09-17T07:00:00.000Z' });
  });

  it('a board without the field (an older Worker), or a malformed body, reads as nothing waiting — never a crash, never a ghost', () => {
    expect(aReprogrammerRows({ ok: true, board: { queued: [], riders: [], assignments: [] } })).toEqual([]);
    expect(aReprogrammerRows(null)).toEqual([]);
    expect(aReprogrammerRows({ board: { aReprogrammer: 'oui' } })).toEqual([]);
  });

  it('the reason is one of the three the ladder reschedules on, each its own sentence; anything else the generic honest one — all catalog keys that resolve', () => {
    expect(t(raisonKey('honest_absence'))).toBe('Client absent');
    expect(t(raisonKey('unusable_location'))).toBe('Lieu introuvable');
    expect(t(raisonKey('provider_failure'))).toBe('Panne du paiement');
    expect(t(raisonKey('something_new'))).toBe('Livraison à refaire');
  });

  it('the view: bad key escalates (null), loading/failed/empty each a sentence, a list is the rows of BOTH lists — empty only when both are', () => {
    expect(reprogView({ kind: 'bad_key' })).toBeNull();
    expect(reprogView({ kind: 'loading' })).toEqual({ kind: 'loading', message: 'reprog.chargement' });
    expect(reprogView({ kind: 'failed' })).toEqual({ kind: 'failed', message: 'reprog.echec' });
    expect(reprogView({ kind: 'ok', rows: [], deuxiemes: [] })).toEqual({ kind: 'empty', message: 'reprog.vide' });
    const rows = aReprogrammerRows(BOARD);
    const deuxiemes = enDeuxiemePassageRows(BOARD_2E);
    expect(reprogView({ kind: 'ok', rows, deuxiemes: [] })).toEqual({ kind: 'liste', rows, deuxiemes: [] });
    expect(reprogView({ kind: 'ok', rows: [], deuxiemes })).toEqual({ kind: 'liste', rows: [], deuxiemes });
    for (const key of ['reprog.chargement', 'reprog.echec', 'reprog.vide']) expect(t(key)).not.toBe('');
  });
});

/** REPROGRAMMATION-2 — the board's second list, as logistics-do's board says it. */
const BOARD_2E = {
  ok: true,
  board: {
    queued: [],
    riders: [{ riderId: 'rider-boss', displayName: 'Boss', certified: true, assignable: false }],
    assignments: [],
    aReprogrammer: [],
    enDeuxiemePassage: [
      { orderId: 'ord-b', taskId: 'task-b2', assignmentId: 'as-b', riderId: 'rider-boss', passage: 2, window: { start: '2026-09-18T10:00:00.000Z', end: '2026-09-18T12:00:00.000Z' } },
      { orderId: 'ord-a', taskId: 'task-a2', assignmentId: 'as-a', riderId: 'rider-awa', passage: 'deux', window: null },
      { orderId: '', taskId: 'task-x', riderId: 'rider-boss', passage: 2, window: null },
    ],
  },
};

describe('REPROGRAMMATION-2 — the courses already on their next passage, and the lever home', () => {
  it('reads one row per course with the fixed window, names the rider, bounds the passage to ≥ 2, half a window is no window, sorts stably, drops a row that names no order; an older board reads as none', () => {
    const rows = enDeuxiemePassageRows(BOARD_2E);
    expect(rows.map((r) => r.orderId)).toEqual(['ord-a', 'ord-b']);
    expect(rows[1]).toEqual({ orderId: 'ord-b', taskId: 'task-b2', riderName: 'Boss', passage: 2, fenetre: { start: '2026-09-18T10:00:00.000Z', end: '2026-09-18T12:00:00.000Z' } });
    expect(rows[0]).toEqual({ orderId: 'ord-a', taskId: 'task-a2', riderName: 'rider-awa', passage: 2, fenetre: null });
    expect(enDeuxiemePassageRows({ board: { enDeuxiemePassage: [{ orderId: 'o', window: { start: 'x' } }] } })[0]?.fenetre).toBeNull();
    expect(enDeuxiemePassageRows(BOARD)).toEqual([]);
    expect(enDeuxiemePassageRows(null)).toEqual([]);
  });

  it('the confirmation is the consent: a lever opens ONE card (a second course’s closes the first), cancel closes it, only the course whose card is open can be sent, one act in flight, the same command id on a retry, the decision recorded with custody’s instant, a refusal by sentence — and asking again clears it', () => {
    let minted = 0;
    const mint = () => `cmd-${(minted += 1)}`;
    // Nothing is sent without the card: no consent, no act.
    expect(commencerRenvoi(RENVOI_IDLE, 'ord-a', mint)).toBeNull();
    const asked = demanderRenvoi(RENVOI_IDLE, 'ord-a');
    expect(asked).toEqual({ ...RENVOI_IDLE, demande: 'ord-a' });
    expect(demanderRenvoi(asked, 'ord-b').demande).toBe('ord-b');
    expect(annulerRenvoi(asked)).toEqual(RENVOI_IDLE);
    // Only the course asked about can be sent.
    expect(commencerRenvoi(asked, 'ord-b', mint)).toBeNull();
    const started = commencerRenvoi(asked, 'ord-a', mint);
    expect(started).toEqual({ ui: { demande: null, enVol: 'ord-a', faits: {}, echecs: {}, commandes: { 'ord-a': 'cmd-1' } }, commandId: 'cmd-1' });
    if (started === null) return;
    // While it flies: no second card, no second act.
    expect(demanderRenvoi(started.ui, 'ord-b')).toBe(started.ui);
    expect(commencerRenvoi(demanderRenvoi(started.ui, 'ord-b'), 'ord-b', mint)).toBeNull();
    // The wire was lost: a refusal by sentence, then the SAME command on the retry.
    const lost = renvoiEchoue(started.ui, 'ord-a', 'reprog.injoignable');
    expect(lost).toEqual({ demande: null, enVol: null, faits: {}, echecs: { 'ord-a': 'reprog.injoignable' }, commandes: { 'ord-a': 'cmd-1' } });
    const retry = commencerRenvoi(demanderRenvoi(lost, 'ord-a'), 'ord-a', mint);
    expect(retry?.commandId).toBe('cmd-1');
    expect(retry?.ui.echecs).toEqual({});
    expect(minted).toBe(1);
    // Decided: custody's instant kept, the command forgotten.
    const fait = renvoiFait(retry!.ui, 'ord-a', '2026-09-17T10:00:00.000Z');
    expect(fait).toEqual({ demande: null, enVol: null, faits: { 'ord-a': '2026-09-17T10:00:00.000Z' }, echecs: {}, commandes: {} });
  });

  it('the decider door’s refusals each resolve to a sentence: not yet rescheduled shares the fixer’s sentence, custody out of reach is ONE sentence for both causes, custody’s refusal is named, the unknown gets the honest generic', () => {
    expect(t(renvoiRefusKey('course_non_reprogrammee'))).toContain("n'a pas encore reçu l'absence");
    expect(t(renvoiRefusKey('no_active_course'))).toContain("n'est plus sur le tableau");
    expect(t(renvoiRefusKey('course_non_acceptee'))).toContain('pas encore accepté');
    expect(t(renvoiRefusKey('custody_non_relie'))).toBe("Le service de garde n'a pas répondu. Réessayez.");
    expect(t(renvoiRefusKey('custody_unreachable'))).toBe("Le service de garde n'a pas répondu. Réessayez.");
    expect(t(renvoiRefusKey('custody_refused'))).toBe('Séra a refusé ce retour. Relisez le tableau.');
    expect(t(renvoiRefusKey('reponse_sans_decision'))).toBe('Séra a refusé. Relisez le tableau.');
    for (const key of ['reprog.deuxieme_etat', 'reprog.deuxieme_fenetre', 'reprog.deuxieme_sans_fenetre', 'reprog.renvoyer', 'reprog.renvoi_titre', 'reprog.renvoi_confirm', 'reprog.renvoi_confirmer', 'reprog.renvoi_fait']) {
      expect(t(key), key).not.toBe('');
    }
    expect(t('reprog.renvoi_confirm')).toContain('Aucun frais pour le client.');
  });
});

describe('the window the founder types, judged before anything is sent', () => {
  const NOW = new Date('2026-09-17T12:00:00.000Z');

  it('a day and two hours become two LOCAL instants, start before end, both ISO', () => {
    const composee = composerFenetre({ jour: '2026-09-18', debut: '10:00', fin: '12:00' }, NOW);
    expect(composee.ok).toBe(true);
    if (!composee.ok) return;
    // Local time, as a browser parses a date-time literal without an offset.
    expect(composee.start).toBe(new Date('2026-09-18T10:00:00').toISOString());
    expect(composee.end).toBe(new Date('2026-09-18T12:00:00').toISOString());
    expect(Date.parse(composee.start)).toBeLessThan(Date.parse(composee.end));
  });

  it('refuses by name, without sending: a missing field · a reversed window · a window already behind now', () => {
    expect(composerFenetre({ jour: '', debut: '10:00', fin: '12:00' }, NOW)).toEqual({ ok: false, reason: 'incomplete' });
    expect(composerFenetre({ jour: '2026-09-18', debut: '', fin: '12:00' }, NOW)).toEqual({ ok: false, reason: 'incomplete' });
    expect(composerFenetre({ jour: 'demain', debut: '10:00', fin: '12:00' }, NOW)).toEqual({ ok: false, reason: 'incomplete' });
    expect(composerFenetre({ jour: '2026-09-18', debut: '12:00', fin: '10:00' }, NOW)).toEqual({ ok: false, reason: 'fin_avant_debut' });
    expect(composerFenetre({ jour: '2026-09-18', debut: '10:00', fin: '10:00' }, NOW)).toEqual({ ok: false, reason: 'fin_avant_debut' });
    expect(composerFenetre({ jour: '2020-01-01', debut: '10:00', fin: '12:00' }, NOW)).toEqual({ ok: false, reason: 'passee' });
    for (const reason of ['incomplete', 'fin_avant_debut', 'passee'] as const) expect(t(saisieKey(reason))).not.toBe('');
  });

  it('the window reads back in the founder’s words — the same sentence the rider’s phone shows', () => {
    const f = { start: '2026-09-18T10:00:00.000Z', end: '2026-09-18T12:00:00.000Z' };
    const jour = new Date(f.start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    const h = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(fenetreLisible(f)).toBe(`${jour}, ${h(f.start)}–${h(f.end)}`);
  });
});

describe('one fix at a time, and every outcome said per course', () => {
  it('starts one fix on ONE command id, refuses a second while it flies, records a fix with its window (and forgets the command), records a refusal by sentence — and a new start clears the old refusal', () => {
    let minted = 0;
    const mint = () => `cmd-${(minted += 1)}`;
    const W = { start: 's', end: 'e' };
    const started = commencerFixation(FIXATION_IDLE, 'ord-a', W, mint);
    expect(started).toEqual({
      ui: { enVol: 'ord-a', faits: {}, echecs: {}, commandes: { 'ord-a': { start: 's', end: 'e', commandId: 'cmd-1' } } },
      commandId: 'cmd-1',
    });
    if (started === null) return;
    expect(commencerFixation(started.ui, 'ord-b', W, mint)).toBeNull();
    const fait = fixationFaite(started.ui, 'ord-a', W);
    expect(fait).toEqual({ enVol: null, faits: { 'ord-a': W }, echecs: {}, commandes: {} });
    const echec = fixationEchouee(fait, 'ord-b', 'reprog.refus_autre');
    expect(echec).toEqual({ enVol: null, faits: { 'ord-a': W }, echecs: { 'ord-b': 'reprog.refus_autre' }, commandes: {} });
    const again = commencerFixation(echec, 'ord-b', W, mint);
    expect(again?.ui).toEqual({ enVol: 'ord-b', faits: { 'ord-a': W }, echecs: {}, commandes: { 'ord-b': { start: 's', end: 'e', commandId: 'cmd-2' } } });
  });

  it('a retry of the SAME window rides the SAME command id (the door replays the fix it made); a changed window is a new act', () => {
    let minted = 0;
    const mint = () => `cmd-${(minted += 1)}`;
    const W = { start: 's', end: 'e' };
    const first = commencerFixation(FIXATION_IDLE, 'ord-a', W, mint);
    if (first === null) throw new Error('unreachable');
    // The wire was lost: the desk records a refusal and the founder taps again.
    const lost = fixationEchouee(first.ui, 'ord-a', 'reprog.injoignable');
    const retry = commencerFixation(lost, 'ord-a', W, mint);
    expect(retry?.commandId).toBe('cmd-1');
    expect(minted).toBe(1);
    // He changed the hour: a fresh command, never the old one re-sent with new content.
    const changed = commencerFixation(fixationEchouee(retry!.ui, 'ord-a', 'reprog.injoignable'), 'ord-a', { start: 's', end: 'e2' }, mint);
    expect(changed?.commandId).toBe('cmd-2');
  });

  it('the door’s refusals each map to a sentence that resolves; the intake gate’s four collapse into one; the unknown gets the honest generic', () => {
    expect(t(refusKey('order_not_rescheduled'))).toContain("n'a pas encore reçu");
    expect(t(refusKey('course_non_acceptee'))).toContain("pas encore accepté");
    expect(t(refusKey('no_active_course'))).toContain("n'est plus sur le tableau");
    expect(t(refusKey('prior_task_missing'))).toContain("n'est plus sur le tableau");
    expect(t(refusKey('prior_task_mismatch'))).toBe('Cette course a changé depuis. Relisez le tableau.');
    expect(t(refusKey('fenetre_passee'))).toBe('Ce créneau est déjà passé.');
    expect(t(refusKey('fenetre_invalide'))).toBe("L'heure de fin doit venir après le début.");
    for (const gate of ['funding_projection_stale', 'not_funded_for_mode', 'order_cancelled', 'readiness_projection_stale', 'not_readiness_confirmed']) {
      expect(refusKey(gate)).toBe('reprog.refus_pas_prete');
    }
    expect(t(refusKey('reponse_sans_tache'))).toBe('Séra a refusé. Relisez le tableau.');
  });
});
