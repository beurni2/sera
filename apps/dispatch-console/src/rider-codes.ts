/**
 * ═══ SE-LIVE-4e · THE RIDER CODE DESK — pure decisions ═══
 *
 * FOUNDER ORDER (2026-08-08): « build the rider code screen in the dispatch
 * console. » He could not sign into the rider app because it asks for a code,
 * and no screen anywhere could mint one — the routes existed on the logistics
 * Worker and had no surface. The only way in was a curl with the ops secret.
 *
 * ⚠ WHY HERE AND NOT IN THE BOUTIK+ CONSOLE. Founder ruling (2026-08-07):
 * « rider identity stays in logistics; custody asks. » One place mints and
 * revokes a rider code. The Boutik+ console speaks to supply; this speaks to
 * logistics, and rider identity is logistics' to hold.
 *
 * This file is the Boutik+ operations codes model (`operations/view.ts`,
 * CONSOLE-3) applied to riders — deliberately the same shapes, because the two
 * desks do the same job and a founder should not have to learn two grammars.
 * Pure: no DOM, no fetch, no timer. Every string is a CATALOG KEY, never a word.
 */

export interface RiderRow {
  readonly riderId: string;
  readonly displayName: string;
  /**
   * True iff a live code exists for this rider. The plaintext is NEVER here —
   * the server hands it over exactly once, at the mint.
   *
   * ⚠ THIS IS A JOIN OF TWO ROUTES, NOT A FIELD. My first draft read `hasCode`
   * off `GET /ops/riders`; the Worker does not send it. Code state lives under
   * its own storage prefix and is projected by `GET /ops/rider-codes`
   * (riderId + mintedAt; the hash never leaves). Reading the Worker rather than
   * assuming the shape is what caught it.
   */
  readonly hasCode: boolean;
  /** When the live code was minted, for « depuis le … ». Absent = no code. */
  readonly mintedAt?: string | undefined;
  readonly certified: boolean;
}

export type CodesRead =
  | { readonly kind: 'loading' }
  /** The ops key was refused. Never rendered as a section — the caller
   *  escalates the WHOLE desk to one door and one sentence. */
  | { readonly kind: 'bad_key' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'ok'; readonly riders: readonly RiderRow[] };

export type CodesView =
  | { readonly kind: 'loading'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'empty'; readonly message: string }
  | { readonly kind: 'liste'; readonly riders: readonly RiderRow[] };

export function codesView(read: CodesRead): CodesView | null {
  if (read.kind === 'bad_key') return null;
  if (read.kind === 'loading') return { kind: 'loading', message: 'codes.chargement' };
  if (read.kind === 'failed') return { kind: 'failed', message: 'codes.echec' };
  if (read.riders.length === 0) return { kind: 'empty', message: 'codes.vide' };
  return { kind: 'liste', riders: read.riders };
}

/**
 * The mint form's honest pre-flight, from what the desk already holds:
 *   · `remplace` — this rider HAS a code; minting kills the old one NOW, and a
 *     rider mid-course would be locked out of their own custody acts.
 *   · `inconnu` — no such rider is registered. `POST /ops/rider-code/mint`
 *     answers `unknown_rider`; saying so before the tap beats a refusal after.
 *   · `pret` — registered, no active code: the plain case.
 */
export type MintAvis = 'pret' | 'remplace' | 'inconnu';

export function mintAvis(riders: readonly RiderRow[], riderId: string): MintAvis {
  const found = riders.find((r) => r.riderId === riderId.trim());
  if (found === undefined) return 'inconnu';
  return found.hasCode ? 'remplace' : 'pret';
}

/** The catalog key for each verdict — the screen never spells the sentence. */
export function mintAvisKey(avis: MintAvis): string {
  if (avis === 'remplace') return 'codes.avis_remplace';
  if (avis === 'inconnu') return 'codes.avis_inconnu';
  return 'codes.avis_pret';
}

/**
 * One act at a time, and a LIVE one-time code blocks every other act.
 *
 * ⚠ THE PLAINTEXT EXISTS NOWHERE BUT THAT CARD. The server mints it once and
 * never returns it again; this app does not store it. So while it is on screen
 * every other button is refused — the alternative is a tap that silently
 * destroys a code mid-handover, which is the verifier finding the Boutik+ desk
 * already paid for (MAJOR-1 there). The founder taps « C'est noté » first, and
 * the screen says so in words where the buttons were.
 */
export interface CodesUi {
  readonly busy: 'mint' | `revoke:${string}` | null;
  /** The one-time plaintext, until the founder dismisses it. */
  readonly nouveau: { readonly riderId: string; readonly code: string } | null;
  /** Which act failed — namespaced like `busy`, so a rider literally named
   *  « mint » can never light the wrong sentence. */
  readonly echec: 'mint' | `revoke:${string}` | null;
}

export const CODES_IDLE: CodesUi = { busy: null, nouveau: null, echec: null };

/** May this act start? No while anything is in flight, and no while a code is
 *  on screen. Returns the catalog key of the refusal, or null to proceed. */
export function refuseAct(ui: CodesUi): string | null {
  if (ui.nouveau !== null) return 'codes.notez_dabord';
  if (ui.busy !== null) return 'codes.un_acte';
  return null;
}

export function actStart(ui: CodesUi, act: 'mint' | `revoke:${string}`): CodesUi | null {
  if (refuseAct(ui) !== null) return null;
  return { busy: act, nouveau: null, echec: null };
}

export type ActResult =
  | { readonly ok: true; readonly code?: string | undefined; readonly riderId: string }
  | { readonly ok: false };

export function actSettled(ui: CodesUi, act: 'mint' | `revoke:${string}`, result: ActResult): CodesUi {
  // A late answer for an act that is no longer the one in flight changes
  // nothing — it must not resurrect a card the founder already dismissed.
  if (ui.busy !== act) return ui;
  if (!result.ok) return { busy: null, nouveau: null, echec: act };
  const code = result.code;
  return {
    busy: null,
    nouveau: typeof code === 'string' && code !== '' ? { riderId: result.riderId, code } : null,
    echec: null,
  };
}

export function dismissCode(ui: CodesUi): CodesUi {
  return { ...ui, nouveau: null };
}
