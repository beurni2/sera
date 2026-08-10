import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { t } from '../src/i18n';
import {
  ACT_IDLE,
  arriveDone,
  arriveOutcome,
  departDone,
  departOutcome,
  packageIsHeld,
  roadArrived,
  roadDeparted,
  sealScreenIsDue,
  verifyOutcome,
  type ActPhase,
} from '../src/net/act-model';
import type { CustodyAnswer } from '../src/net/custody-acts';

/**
 * VRAI-ROUTE-RIDER (founder rulings 2026-08-10) — the road is real.
 *
 * Spec l.63: « custody begins -> transit (one current stop) -> arrival + buyer
 * inspection ... buyerDropCode entered last ». After the seal, the rider's
 * screen becomes the ROAD: one primary action « En route » (a real transit
 * fact), then the destination with ONE primary action « Je suis arrivé » (a
 * real arrival fact), and then the buyer's code.
 *
 * ⚠ « and only then the delivery photo and the buyer's code » is what this
 * header used to say. PORTE-SANS-PHOTO (founder ruling 2026-08-10, « for the
 * door photo I want it gone ») removed the photo from the door entirely: the
 * evidence bundle still goes — chain-bound, seal-bound, fired by the arrival —
 * but it carries no artifact, and the rider meets no camera there.
 *
 * And the pickup code stopped being a phone call: it is machine-carried on the
 * session read, presented by the act itself, never typed, never displayed.
 *
 * Source-scanned where the property is a call site or an absence (the house
 * pattern — a screen that silently does nothing is invisible to behaviour
 * tests); by value everywhere the logic is pure.
 */

const app = readFileSync(join(import.meta.dirname, '..', 'App.tsx'), 'utf8');
const recorded = (body: Record<string, unknown>): CustodyAnswer => ({ kind: 'recorded', duplicate: false, body });
const answered = (answer: CustodyAnswer): ActPhase => ({ kind: 'answered', answer });

describe('VRAI-ROUTE — the held-package arm runs seal -> En route -> arrivé -> code', () => {
  // The whole wired held-package arm, between its two gates.
  const held = app.slice(
    app.indexOf('packageIsHeld(sealPhase, remembered) ?'),
    app.indexOf('sealScreenIsDue(verifyPhase, remembered) ?'),
  );
  const at = (marker: string): number => {
    const i = held.indexOf(marker);
    expect(i, `${marker} missing from the held-package arm`).toBeGreaterThan(-1);
    return i;
  };

  it('the slice anchors exist and the arm is substantial', () => {
    expect(held.length).toBeGreaterThan(1000);
  });

  it('the three gates branch in road order: departed, then arrived, then evidence', () => {
    expect(at('!roadDeparted(departPhase, remembered) ? (')).toBeLessThan(at('!roadArrived(arrivePhase, remembered) ? ('));
    expect(at('!roadArrived(arrivePhase, remembered) ? (')).toBeLessThan(at('!evidenceIsHeld(evidencePhase) ? ('));
  });

  it('the screens render in the l.63 order: En route, arrivé, code — each after the last', () => {
    expect(at("route.en_route_action")).toBeLessThan(at("route.arrive_action"));
    expect(at("route.arrive_action")).toBeLessThan(at("delivery.code_title"));
    /**
     * ⚠ AND NO CAMERA STANDS BETWEEN THE ARRIVAL AND THE CODE. This is the
     * founder's flow asserted as an ABSENCE — « je suis arrivé » then « le code
     * de la cliente », nothing in between. An absence is exactly what a source
     * scan is good for, and exactly what a re-introduced photo screen would
     * trip on.
     */
    expect(held, 'the door photo hint must be gone').not.toContain('delivery.photo_hint');
    expect(held, 'and its camera with it').not.toContain('setDropArt');
    expect(held, 'and its send button').not.toContain('delivery.evidence_send');
  });

  it('the arrival screen shows the destination — the same landmark-first lines', () => {
    const arrivalScreen = held.slice(
      held.indexOf('!roadArrived(arrivePhase, remembered) ? ('),
      held.indexOf('!evidenceIsHeld(evidencePhase) ? ('),
    );
    expect(arrivalScreen).toContain('lines={assignmentLines}');
    expect(arrivalScreen).toContain("t('assignment.no_landmark')");
  });

  it('both buttons are wired to their senders, and the senders call the port', () => {
    // A port that exists is not a port that is called (6bis) — call sites.
    expect(app).toMatch(/onPress=\{sendDepart\}/);
    expect(app).toMatch(/onPress=\{sendArrive\}/);
    expect(app).toMatch(/custodyActs\.depart\(riderCode, liveAssignment\.orderId, attempt\.id\)/);
    expect(app).toMatch(/custodyActs\.arrive\(riderCode, liveAssignment\.orderId, attempt\.id\)/);
    // One command id per order and act for the session: minted at the first
    // gesture, reused by every retry, so a double tap replays.
    expect(app).toContain('attemptFor(`depart|${liveAssignment.orderId}`)');
    expect(app).toContain('attemptFor(`arrive|${liveAssignment.orderId}`)');
  });

  it('the road states are honest: in-flight locks, and every answer resolves on screen', () => {
    expect(held).toContain("departPhase.kind === 'working' ? 'acts.sending' : 'route.en_route_action'");
    expect(held).toContain("disabled={departPhase.kind === 'working'}");
    expect(held).toContain("arrivePhase.kind === 'working' ? 'acts.sending' : 'route.arrive_action'");
    expect(held).toContain("disabled={arrivePhase.kind === 'working'}");
    expect(held).toContain('departOutcome(departPhase.answer)');
    expect(held).toContain('arriveOutcome(arrivePhase.answer)');
  });

  it('the remember effect writes the road rungs from the LEDGER answers only', () => {
    const remember = app.slice(app.indexOf('const stage: ActStage | null'), app.indexOf("}).catch(() => setPersistFailed(true));"));
    expect(remember).toContain("arriveDone(arrivePhase)");
    expect(remember).toContain("departDone(departPhase)");
    // the highest rung wins — arrival is checked before departure, departure
    // before the seal.
    expect(remember.indexOf('arriveDone')).toBeLessThan(remember.indexOf('departDone'));
    expect(remember.indexOf('departDone')).toBeLessThan(remember.indexOf('holdsPackage'));
  });
});

describe('VRAI-ROUTE — the typed pickup-code field is GONE, and the code is never shown', () => {
  it('no trace of the typed field remains in the app', () => {
    expect(app).not.toContain('verify.code_title');
    expect(app).not.toContain('verify.code_hint');
    expect(app).not.toContain('verify.code_placeholder');
  });

  it('the verification act reads the code from the SESSION, not from a keyboard', () => {
    expect(app).toContain('const codeVerification = liveAssignment.codeVerification;');
    expect(app).toContain('presentedPickupCode: codeVerification,');
    // and the attempt key covers it, so a code arriving later is a NEW attempt
    // (custody fingerprints this field — blocker A3's law).
    expect(app).toContain('${codeVerification ?? SANS_CODE}');
  });

  it('the quiet line names the mechanism; the checklist survives', () => {
    expect(app).toContain("<FasoBody>{t('verify.par_sera')}</FasoBody>");
    expect(app).toMatch(/<FasoCheckAnswer/);
  });

  it('codeVerification is machine-carried: composed into the act, NEVER rendered', () => {
    // Comments stripped, exactly as the shell inline-French scan does.
    const codeOnly = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const uses = codeOnly.match(/codeVerification/g) ?? [];
    // The sourcing line carries two, the attempt key one, the act field one —
    // any NEW occurrence (a render, a log, a persist) fails this count.
    expect(uses).toHaveLength(4);
    // and it never wears a display component the way the ramassage code does.
    expect(codeOnly).not.toMatch(/FasoSealMark[^>]*codeVerification/);
    expect(codeOnly).not.toMatch(/\{liveAssignment\.codeVerification\}/);
  });
});

describe('VRAI-ROUTE — the road advances only on the LEDGER word (by value)', () => {
  it('departed: the recorded departure or its replay, and nothing else', () => {
    expect(departDone(answered(recorded({ ok: true, status: 'departed' })))).toBe(true);
    expect(departDone(answered(recorded({ ok: true, status: 'deja' })))).toBe(true);
    const not: CustodyAnswer[] = [
      { kind: 'offline' },
      { kind: 'unauthorized' },
      { kind: 'unreachable', reason: 'transport' },
      { kind: 'refused', reason: 'custody_not_with_courier' },
      recorded({ ok: true }),
      recorded({ ok: true, status: 'arrived' }),
      recorded({ ok: true, status: 'custody_with_courier' }),
    ];
    for (const answer of not) {
      const label = `${answer.kind}/${'reason' in answer ? answer.reason : JSON.stringify('body' in answer ? answer.body : '')}`;
      expect(`${label} -> ${departDone(answered(answer))}`).toBe(`${label} -> false`);
    }
    expect(departDone(ACT_IDLE)).toBe(false);
    expect(departDone({ kind: 'working' })).toBe(false);
  });

  it('arrived: the recorded arrival or its replay, and a departure is NOT an arrival', () => {
    expect(arriveDone(answered(recorded({ ok: true, status: 'arrived' })))).toBe(true);
    expect(arriveDone(answered(recorded({ ok: true, status: 'deja' })))).toBe(true);
    expect(arriveDone(answered(recorded({ ok: true, status: 'departed' })))).toBe(false);
    expect(arriveDone(ACT_IDLE)).toBe(false);
    expect(arriveDone({ kind: 'working' })).toBe(false);
  });

  it('a killed app restores the right road screen — and a later rung implies the earlier', () => {
    expect(roadDeparted(ACT_IDLE, 'departed')).toBe(true);
    expect(roadDeparted(ACT_IDLE, 'arrived')).toBe(true);
    expect(roadDeparted(ACT_IDLE, 'custody_taken')).toBe(false);
    expect(roadArrived(ACT_IDLE, 'arrived')).toBe(true);
    expect(roadArrived(ACT_IDLE, 'departed')).toBe(false);
    // the road rungs keep the package held and the checklist spent: a phone
    // killed mid-road must never fall back to a burned pickup code.
    expect(packageIsHeld(ACT_IDLE, 'departed')).toBe(true);
    expect(packageIsHeld(ACT_IDLE, 'arrived')).toBe(true);
    expect(sealScreenIsDue(ACT_IDLE, 'arrived')).toBe(true);
  });

  it('a live answer always outranks the remembered rung', () => {
    const refusal: CustodyAnswer = { kind: 'refused', reason: 'custody_not_with_courier' };
    expect(roadDeparted(answered(refusal), 'departed')).toBe(false);
    expect(roadArrived(answered({ kind: 'refused', reason: 'not_departed' }), 'arrived')).toBe(false);
    // and memory fills only the gap where nothing was answered yet.
    expect(roadDeparted({ kind: 'working' }, 'departed')).toBe(true);
  });
});

describe('VRAI-ROUTE — every road sentence is real, honest, and catalogued', () => {
  it('the two named refusals get their own true sentences', () => {
    expect(departOutcome({ kind: 'refused', reason: 'custody_not_with_courier' })).toEqual({
      title: 'route.pas_en_garde',
      hint: 'route.pas_en_garde_hint',
      tone: 'refused',
    });
    expect(arriveOutcome({ kind: 'refused', reason: 'not_departed' })).toEqual({
      title: 'route.pas_parti',
      hint: 'route.pas_parti_hint',
      tone: 'refused',
    });
  });

  it('offline is the honest never-queued refusal: retry HERE, with signal — no queue promise', () => {
    for (const out of [departOutcome({ kind: 'offline' }), arriveOutcome({ kind: 'offline' })]) {
      expect(out.tone).toBe('waiting');
      expect(t(out.title)).toBe('Pas de réseau.');
      expect(t(out.hint ?? '')).toContain('Réessayez ici même');
    }
  });

  it('the machine-carried code missing is a WAITING truth with its own sentence', () => {
    const out = verifyOutcome({ kind: 'refused', reason: 'verification_code_missing' });
    expect(out).toEqual({ title: 'verify.code_manquant', hint: 'verify.code_manquant_hint', tone: 'waiting' });
    expect(t(out.title)).toContain('fournisseur');
  });

  it('every outcome resolves to real words for every answer shape', () => {
    const answers: CustodyAnswer[] = [
      recorded({ ok: true, status: 'departed' }),
      recorded({ ok: true, status: 'arrived' }),
      recorded({ ok: true, status: 'deja' }),
      recorded({ ok: true }),
      { kind: 'offline' },
      { kind: 'unauthorized' },
      { kind: 'unreachable' },
      { kind: 'refused', reason: 'custody_not_with_courier' },
      { kind: 'refused', reason: 'not_departed' },
      { kind: 'refused', reason: 'x' },
    ];
    for (const answer of answers) {
      for (const out of [departOutcome(answer), arriveOutcome(answer)]) {
        expect(t(out.title).length).toBeGreaterThan(0);
        if (out.hint !== undefined) expect(t(out.hint).length).toBeGreaterThan(0);
      }
    }
  });

  it('the founder-ruled button words are exact, and every new key is catalogued', () => {
    expect(t('route.en_route_action')).toBe('En route');
    expect(t('route.arrive_action')).toBe('Je suis arrivé');
    for (const key of [
      'route.depart_titre', 'route.depart_body', 'route.depart_note',
      'route.arrivee_titre', 'route.arrivee_body', 'route.arrivee_notee',
      'route.pas_en_garde', 'route.pas_en_garde_hint',
      'route.pas_parti', 'route.pas_parti_hint',
      'verify.par_sera', 'verify.code_manquant', 'verify.code_manquant_hint',
    ]) {
      expect(t(key).length, key).toBeGreaterThan(0);
    }
  });
});
