import { custodyBegan, verificationAccepted, type CustodyAnswer } from './custody-acts';

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
