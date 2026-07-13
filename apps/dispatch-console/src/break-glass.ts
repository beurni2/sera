import type { AuthorizationSource, HandoffAuthorizationState } from '@platform/contracts';

/**
 * WO-6.9-e · D5 — the BREAK-GLASS honest shell (PART 8 §5, the maker-checker
 * seam). Two different people, deliberately:
 *   - the authorized payment OPERATOR verifies the provider transaction and
 *     ISSUES the break-glass `HandoffAuthorization` (in the platform ops surface);
 *   - the DISPATCHER performs break-glass handoff verification ON THE GROUND.
 *   « Nobody holds both halves. That is the whole point. »
 *
 * This is the dispatcher's surface, so:
 *   - It RENDERS the `HandoffAuthorizationState` machine READ-ONLY (pinned enum).
 *   - **The issuing lever DOES NOT EXIST here** — there is no function that
 *     advances the authorization (to `provider_confirmed`/`issued`); issuing is
 *     the operator's (§8.3 MAY-NOT). Proven by absence in `test/break-glass.test.ts`.
 *   - The dispatcher captures only the GROUND half; it never advances the
 *     authorization (ground-verified ≠ issued).
 *   - `provider_confirmed` is honestly « en attente » until a real provider
 *     signal exists (E3-gated) — the console never fabricates a confirmation.
 *
 * `BreakGlassView` is a DELIBERATE projection of the canonical `HandoffAuthorization`:
 * it OMITS the `signature` (the fourth secret — the issuing credential never
 * reaches the dispatcher's surface) and every franc figure (`exactAmount` — no
 * franc in Séra). PURE read-model: `import type` only → no value import, nothing
 * to write with; no custody write, no money.
 */

/** The dispatcher's projection of a break-glass HandoffAuthorization case. */
export interface BreakGlassView {
  readonly orderId: string;
  readonly riderId: string;
  /** Pinned enum: `provider_webhook | break_glass`. */
  readonly source: AuthorizationSource;
  /** Pinned enum, shown READ-ONLY — the console never advances it. */
  readonly state: HandoffAuthorizationState;
  /** break_glass REQUIRES a case id (mandatory incident review). */
  readonly breakGlassCaseId: string;
  /** i18n catalog key for the human reason (register-tagged in the catalog). */
  readonly reasonRef: string;
  // NO `signature` (the fourth secret). NO `exactAmount`/franc. NO buyerRef /
  // providerTransactionReference — the payment domain, not the dispatcher's.
}

/** The happy-path progression the console displays; later steps render « en attente ». */
const HAPPY_PATH: readonly HandoffAuthorizationState[] = [
  'requested',
  'operator_verifying',
  'provider_confirmed',
  'issued',
  'consumed',
];

export interface StateStep {
  readonly state: HandoffAuthorizationState;
  /** 'pending' renders « en attente » — provider-confirm and issuance are not the console's to reach. */
  readonly status: 'done' | 'current' | 'pending';
}

export interface BreakGlassBoard {
  readonly orderId: string;
  readonly riderId: string;
  readonly source: AuthorizationSource;
  readonly caseId: string;
  readonly reasonRef: string;
  readonly steps: readonly StateStep[];
  /** An exceptional terminal (`expired`/`voided`), shown distinctly; else null. */
  readonly terminal: 'expired' | 'voided' | null;
  /** The dispatcher's GROUND half — captured locally; it never advances `state`. */
  readonly groundVerified: boolean;
}

/**
 * Derive the read-only break-glass board from the dispatcher's view + the
 * dispatcher's ground-verification flag. The ground flag colours ONLY
 * `groundVerified`; it never changes a step's status (the dispatcher's half is
 * not issuance — maker-checker). Pure: no write, no clock, no money, no issue.
 */
export function deriveBreakGlassBoard(view: BreakGlassView, groundVerified: boolean): BreakGlassBoard {
  const terminal = view.state === 'expired' || view.state === 'voided' ? view.state : null;
  const currentIndex = HAPPY_PATH.indexOf(view.state);
  const steps: StateStep[] = HAPPY_PATH.map((state, i) => ({
    state,
    // A terminal case never completed the happy path; otherwise done < current < pending.
    status: terminal !== null
      ? 'pending'
      : i < currentIndex
        ? 'done'
        : i === currentIndex
          ? 'current'
          : 'pending',
  }));
  return {
    orderId: view.orderId,
    riderId: view.riderId,
    source: view.source,
    caseId: view.breakGlassCaseId,
    reasonRef: view.reasonRef,
    steps,
    terminal,
    groundVerified,
  };
}
