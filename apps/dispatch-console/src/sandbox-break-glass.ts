import type { BreakGlassView } from './break-glass';

/**
 * WO-6.9-e · D5 — SANDBOX break-glass data (runtime DATA; UI strings live in the
 * i18n catalog). Obviously-demo (« (démo) ») so it can never pass for a real
 * case. The case is honestly mid-flight at `operator_verifying`: the operator is
 * still verifying, so `provider_confirmed` and `issued` render « en attente »
 * (E3-gated — the console never fabricates a provider confirmation). NO
 * signature, NO franc, NO issuing anywhere — the dispatcher's surface holds only
 * the ground half.
 */

export const SANDBOX_BREAK_GLASS_RIDER = 'Issa O. (démo)';

/** A break-glass case waiting on the operator — the honest, common in-flight state. */
export const SANDBOX_BREAK_GLASS: BreakGlassView = {
  orderId: 'ord-bg-demo',
  riderId: 'rider-issa',
  source: 'break_glass',
  state: 'operator_verifying',
  breakGlassCaseId: 'bg-2026-071',
  reasonRef: 'console.bg_reason_demo',
};
