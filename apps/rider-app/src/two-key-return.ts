/**
 * WO-6.1 — R13 « le retour à deux clés » (SE6.2). The two-key return handover
 * as a PURE decision, so the UI cannot invent a one-key release. This does NOT
 * touch the custody spine (the demo store's `completeReturn` still closes the
 * course at `retour_colis`); it is the app-side gate the store's own comment
 * anticipated — « the live handover (both keys consumed together) lands with
 * the service at assembly ». A single key REFUSES: both hands, or the custody
 * does not move.
 *
 * SE-I / SE6.2 (Sera-Build-Spec §6, Sera-Building-Plan M6): "Custody until
 * two-key return + inspection; package never unowned; no release from a Séra
 * command." The seller's key and the rider's key, both-or-neither.
 */
export interface ReturnKeys {
  /** The seller has accepted the package back. */
  readonly seller: boolean;
  /** The rider has confirmed the handover. */
  readonly rider: boolean;
}

export type ReturnHandover = 'refused' | 'released';

/** Both keys, or neither. Any single key — or none — REFUSES. */
export function attemptReturnHandover(keys: ReturnKeys): ReturnHandover {
  return keys.seller && keys.rider ? 'released' : 'refused';
}
