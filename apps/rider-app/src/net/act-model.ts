import {
  custodyBegan,
  custodyWithCustomer,
  evidenceHeld,
  transitArrived,
  transitDeparted,
  verificationAccepted,
  type CustodyAnswer,
} from './custody-acts';
import type { ActStage } from './act-memory';

/**
 * ═══ SE-LIVE-4c-vi · WHAT THE RIDER IS TOLD AFTER A CUSTODY ACT ═══
 *
 * Pure, so the screen stays thin and every outcome is testable without
 * rendering. It decides only WHICH sentence; the catalog holds the words.
 *
 * ⚠ THE ONE RULE THIS FILE EXISTS FOR: **a refused package is not an error.**
 * When a rider opens a parcel and the goods do not match, they refuse — and
 * that refusal is a first-class custody fact the ledger records (« no generic
 * failed terminal »). The server answers it with `200 {ok:true,
 * kind:'refused'}`, the same shape as an acceptance, which is precisely how
 * verifier blocker A4 got in. So this model reads `verificationAccepted` and
 * `custodyBegan` — never « did the request succeed » — and it says the true
 * thing in each case:
 *
 *   accepted  → the rider may go on and seal.
 *   refused   → « Colis refusé. Le vendeur garde le colis. » The package stays
 *               with the seller, custody never begins, and the rider has done
 *               their job correctly. Nothing here treats that as a failure.
 *   offline   → nothing was sent and nothing was stored (the custody acts are
 *               deliberately not queued — they carry two of the four secrets).
 *   unreachable → « rien n'est perdu » — the same act may be retried with the
 *               same command_id, so the rider is not made to fear a duplicate.
 */

export type ActPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'answered'; readonly answer: CustodyAnswer };

export const ACT_IDLE: ActPhase = { kind: 'idle' };

/** Headline + optional hint + tone, as CATALOG KEYS. The screen resolves them;
 *  this file never spells a word. */
export interface ActOutcomeKeys {
  readonly title: string;
  readonly hint?: string | undefined;
  readonly tone: 'ok' | 'refused' | 'waiting';
}

/** What to show after a PICKUP VERIFICATION. */
export function verifyOutcome(answer: CustodyAnswer): ActOutcomeKeys {
  // MACHINE-CARRIED (founder ruling 2026-08-10): the session has not yet
  // delivered the verification code — the act refused LOCALLY, before any
  // byte left the phone. A waiting truth, not a fault: the code arrives once
  // the supplier confirms the ramassage, and the same send then goes through.
  if (answer.kind === 'refused' && answer.reason === 'verification_code_missing') {
    return { title: 'verify.code_manquant', hint: 'verify.code_manquant_hint', tone: 'waiting' };
  }
  if (answer.kind === 'recorded') {
    return verificationAccepted(answer)
      ? { title: 'acts.verify_accepted', tone: 'ok' }
      // A refusal recorded by the ledger. The rider did their job; the seller
      // keeps the package. This is NOT an error state and must not read as one.
      : { title: 'acts.verify_refused', tone: 'refused' };
  }
  return sharedOutcome(answer);
}

/** What to show after a SEAL / begin-custody. */
export function sealOutcome(answer: CustodyAnswer): ActOutcomeKeys {
  if (answer.kind === 'recorded') {
    return custodyBegan(answer)
      ? { title: 'acts.custody_taken', tone: 'ok' }
      // Recorded, but custody did NOT begin — e.g. the seal was registered
      // against a verification that was refused. Never claim the package.
      : { title: 'acts.refused', tone: 'refused' };
  }
  return sharedOutcome(answer);
}

/**
 * VRAI-ROUTE — what to show after « En route » was tapped. A recorded
 * departure advances the screen, so the sentences that matter here are the
 * refusals: `custody_not_with_courier` is the ledger saying the seal is not
 * (or no longer) this rider's — said plainly, never as a generic failure.
 */
export function departOutcome(answer: CustodyAnswer): ActOutcomeKeys {
  if (transitDeparted(answer)) return { title: 'route.depart_note', tone: 'ok' };
  if (answer.kind === 'refused' && answer.reason === 'custody_not_with_courier') {
    return { title: 'route.pas_en_garde', hint: 'route.pas_en_garde_hint', tone: 'refused' };
  }
  if (answer.kind === 'recorded') return { title: 'acts.refused', tone: 'refused' };
  return sharedOutcome(answer);
}

/** VRAI-ROUTE — what to show after « Je suis arrivé » was tapped. Same law:
 *  `not_departed` gets its own true sentence (the departure must be recorded
 *  first), everything else reads as the acts around it do. */
export function arriveOutcome(answer: CustodyAnswer): ActOutcomeKeys {
  if (transitArrived(answer)) return { title: 'route.arrivee_notee', tone: 'ok' };
  if (answer.kind === 'refused' && answer.reason === 'not_departed') {
    return { title: 'route.pas_parti', hint: 'route.pas_parti_hint', tone: 'refused' };
  }
  if (answer.kind === 'recorded') return { title: 'acts.refused', tone: 'refused' };
  return sharedOutcome(answer);
}

/** RIDER-DELIVERY-SCREEN — what to show after the HANDOFF-PROOF submit. */
export function evidenceOutcome(answer: CustodyAnswer): ActOutcomeKeys {
  // « already submitted » is the same held truth as a fresh acceptance — one
  // bundle, held once; a rider who resends after a doubt is told it is held.
  if (evidenceHeld(answer)) return { title: 'delivery.evidence_held', tone: 'ok' };
  if (answer.kind === 'recorded' || answer.kind === 'refused') {
    return { title: 'acts.refused', tone: 'refused' };
  }
  return sharedOutcome(answer);
}

/** RIDER-DELIVERY-SCREEN — what to show after the buyer's code was presented. */
export function dropOutcome(answer: CustodyAnswer): ActOutcomeKeys {
  if (custodyWithCustomer(answer)) return { title: 'delivery.done', tone: 'ok' };
  if (answer.kind === 'refused') {
    // The two refusals a rider can ACT on get their own true sentences; a
    // wrong code is NOT burned (the spine refuses without consuming), so
    // « redemandez-le » is honest advice, not a consolation.
    if (answer.reason === 'drop_code_refused') {
      return { title: 'delivery.wrong_code', hint: 'delivery.wrong_code_hint', tone: 'refused' };
    }
    if (answer.reason === 'not_validated' || answer.reason === 'validation_before_evidence') {
      return { title: 'delivery.not_validated', hint: 'delivery.not_validated_hint', tone: 'waiting' };
    }
    return { title: 'acts.refused', tone: 'refused' };
  }
  if (answer.kind === 'recorded') return { title: 'acts.refused', tone: 'refused' };
  return sharedOutcome(answer);
}

/** Delivered, from the phase — the delivery screen's one terminal question. */
export function dropDone(phase: ActPhase): boolean {
  return phase.kind === 'answered' && custodyWithCustomer(phase.answer);
}

/** Evidence held, from the phase — gates the code entry the way `maySeal`
 *  gates the seal: on the LEDGER's word, never on « the request worked ». */
export function evidenceIsHeld(phase: ActPhase): boolean {
  return phase.kind === 'answered' && evidenceHeld(phase.answer);
}

/** The three non-ledger answers read the same for both acts. */
function sharedOutcome(answer: CustodyAnswer): ActOutcomeKeys {
  switch (answer.kind) {
    case 'offline':
      return { title: 'acts.offline', hint: 'acts.offline_hint', tone: 'waiting' };
    case 'unauthorized':
      // The rider's code stopped working mid-shift (revoked, or the wire is
      // unarmed). It is not a statement about the package.
      return { title: 'signin.bad_code', hint: 'signin.bad_code_hint', tone: 'refused' };
    case 'unreachable':
      return { title: 'acts.unreachable', hint: 'acts.unreachable_hint', tone: 'waiting' };
    case 'refused':
      // A refusal custody named (`seal_already_used`, `package_claim_not_held`,
      // `rider_did_not_verify_this_pickup`…). Shown as a refusal, not retried:
      // retrying changes nothing.
      return { title: 'acts.refused', tone: 'refused' };
    default:
      return { title: 'acts.refused', tone: 'refused' };
  }
}

/**
 * May the rider move on to the seal? Only after the ledger ACCEPTED the
 * verification — SE-I05's « custody begins only after rider pickup
 * verification AND custody-seal registration », in that order. A refused or
 * unsent verification leaves the rider exactly where they were.
 */
export function maySeal(phase: ActPhase): boolean {
  return phase.kind === 'answered' && verificationAccepted(phase.answer);
}

/** Has the package actually moved into this rider's custody? The one question
 *  the screen may ask, and only the ledger answers it. */
export function holdsPackage(phase: ActPhase): boolean {
  return phase.kind === 'answered' && custodyBegan(phase.answer);
}

/**
 * ═══ WHAT THE SCREEN SHOWS AFTER THE OS KILLED THE APP (blocker A2) ═══
 *
 * FOUNDER RULING (2026-08-07): « persisting act on the phone ».
 *
 * The two above read a LIVE ledger answer, which is the only real authority —
 * and after an OS kill there isn't one, because the app performs no custody
 * read (the rider door deliberately opens none). So a rider whose phone was
 * killed between an accepted verification and the seal was dropped back onto
 * the checklist, against a pickup code the spine had already consumed:
 * `secret_already_used` for ever, and no route to recover the package.
 *
 * ⚠ MEMORY NEVER OUTRANKS AN ANSWER. When this session has heard from the
 * ledger, that answer decides — the remembered stage only fills the gap where
 * there is nothing, which is exactly the relaunch case. Nothing here fabricates
 * a `CustodyAnswer`; the phone is allowed to remember what it was told, not to
 * invent what it was not.
 */
/**
 * The remembered ladder, in the order the road runs: each rung implies every
 * rung below it, so a phone that remembers 'departed' still knows the package
 * is held and the verification was accepted. VRAI-ROUTE added the two road
 * rungs — without this ordering, an app killed mid-road would read
 * `remembered === 'custody_taken'` as false and drop the rider back onto a
 * checklist whose pickup code the ledger already consumed.
 */
const STAGE_RUNG: Record<ActStage, number> = {
  none: 0,
  verification_accepted: 1,
  custody_taken: 2,
  departed: 3,
  arrived: 4,
};

const rememberedAtLeast = (remembered: ActStage, rung: ActStage): boolean =>
  STAGE_RUNG[remembered] >= STAGE_RUNG[rung];

export function sealScreenIsDue(phase: ActPhase, remembered: ActStage): boolean {
  if (phase.kind === 'answered') return maySeal(phase);
  return rememberedAtLeast(remembered, 'verification_accepted');
}

export function packageIsHeld(phase: ActPhase, remembered: ActStage): boolean {
  if (phase.kind === 'answered') return holdsPackage(phase);
  return rememberedAtLeast(remembered, 'custody_taken');
}

/** VRAI-ROUTE — has the departure been recorded (this session's answer first,
 *  the remembered rung only where there is none — memory never outranks a
 *  live answer)? Gates the arrival screen the way `packageIsHeld` gates the
 *  road: on the LEDGER's word, never on a tap. */
export function roadDeparted(phase: ActPhase, remembered: ActStage): boolean {
  if (phase.kind === 'answered') return transitDeparted(phase.answer);
  return rememberedAtLeast(remembered, 'departed');
}

/** VRAI-ROUTE — has the arrival been recorded? Only then does the buyer's code
 *  render (Spec l.63: arrival precedes it). The delivery photo that used to
 *  sit between them is gone — PORTE-SANS-PHOTO, founder ruling 2026-08-10. */
export function roadArrived(phase: ActPhase, remembered: ActStage): boolean {
  if (phase.kind === 'answered') return transitArrived(phase.answer);
  return rememberedAtLeast(remembered, 'arrived');
}

/** The two answered-only questions the remember effect asks — a stage is
 *  written from the LEDGER's answer, never from a send or a memory. */
export function departDone(phase: ActPhase): boolean {
  return phase.kind === 'answered' && transitDeparted(phase.answer);
}

export function arriveDone(phase: ActPhase): boolean {
  return phase.kind === 'answered' && transitArrived(phase.answer);
}
