import type { ConnectivityPort } from '../offline/connectivity';
import { httpCustodyActs, type CustodyActsPort, type CustodyAnswer } from './custody-acts';

/**
 * SE-LIVE-4c-iv · WHICH CUSTODY WORKER THE APP ACTS AGAINST.
 *
 * `EXPO_PUBLIC_SERA_CUSTODY_BASE` is a PUBLIC URL, inlined at build time —
 * the same rule as the logistics base (`resolveRiderSession`). The two Workers
 * are named SEPARATELY and deliberately: logistics answers « who is this
 * rider », custody records what they did, and they are independently
 * deployable services. A single base URL would quietly re-merge two
 * deployables the spec keeps apart.
 *
 * ⚠ NOTHING ELSE IS EVER BUNDLED. Not the founder's ops key, not the
 * rider-verify key, not a rider's personal code. The app holds exactly one
 * credential — the code the rider types — and holds it in memory only.
 *
 * UNWIRED ⇒ EVERY CUSTODY ACT REFUSES, and says the build cannot reach Séra.
 * It does NOT pretend to seal. A demo custody path that reported
 * `custody_with_courier` would be the worst mock in this repo: it would show a
 * rider that a package is in their custody when no ledger anywhere says so.
 * §9.8, on the one path where it matters most.
 */

/** A custody port that records nothing, because there is no ledger to record
 *  into. Deliberately not a fake success — see the header block. */
export function unwiredCustodyActs(): CustodyActsPort {
  const refuse = async (): Promise<CustodyAnswer> => ({ kind: 'unreachable', reason: 'not_configured' });
  return { verifyPickup: refuse, beginCustody: refuse };
}

export function isCustodyWired(
  base: string | undefined = process.env.EXPO_PUBLIC_SERA_CUSTODY_BASE,
): boolean {
  return typeof base === 'string' && base.trim() !== '';
}

export function resolveCustodyActs(
  connectivity: ConnectivityPort,
  base: string | undefined = process.env.EXPO_PUBLIC_SERA_CUSTODY_BASE,
): CustodyActsPort {
  return isCustodyWired(base)
    ? httpCustodyActs((base as string).trim(), connectivity)
    : unwiredCustodyActs();
}
