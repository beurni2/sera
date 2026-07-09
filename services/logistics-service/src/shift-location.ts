/**
 * The ONE shift-scoped location module (SE-I08: "Courier location collected
 * only on shift/active task"; §12: "off-shift location not collected"). The
 * off-shift-location CI gate bans geolocation APIs everywhere in this repo
 * EXCEPT this module — and here, the capture type REQUIRES an active shift
 * scope; there is no overload without one. SE-I07 rides along: the reading
 * is typed as supporting evidence, never proof.
 */

declare const ActiveShiftScopeBrand: unique symbol;
/** Issued only by the (future, SE0.2) shift service upon server-confirmed shift start. */
export type ActiveShiftScope = {
  readonly shiftId: string;
  readonly riderId: string;
  readonly status: 'active';
} & { readonly [ActiveShiftScopeBrand]: 'ActiveShiftScope' };

export interface OnShiftLocationReading {
  shiftId: string;
  riderId: string;
  /** Coarse by design — buyer sees coarse progress (SE-I08). */
  coarseZone: string;
  capturedAt: string;
  /** SE-I07: location is supporting evidence, not proof — the type says so. */
  readonly evidentiaryWeight: 'supporting_never_proof';
}

export function captureOnShiftLocation(
  scope: ActiveShiftScope,
  coarseZone: string,
  capturedAt: string,
): OnShiftLocationReading {
  return {
    shiftId: scope.shiftId,
    riderId: scope.riderId,
    coarseZone,
    capturedAt,
    evidentiaryWeight: 'supporting_never_proof',
  };
}
