/**
 * WO-2.2 SANDBOX follow-up data for the console — dwell (D20: recorded and
 * console-surfaced, never enforced) and the delivery-outcome timeline. This
 * is runtime DATA feeding the cards, not interface copy — UI strings live
 * in the i18n catalog. Live feeds (verification records + DeliveryOutcome
 * stream from custody-service) replace this at E2 assembly.
 */

export interface DwellView {
  taskId: string;
  dwellSec: number;
  withinTarget: boolean;
}

export interface OutcomeView {
  at: string;
  family: 'retry' | 'reschedule' | 'return' | 'incident';
  reason:
    | 'honest_absence'
    | 'unusable_location'
    | 'insufficient_balance'
    | 'change_of_mind'
    | 'repeated_abuse'
    | 'fraud'
    | 'provider_failure';
}

export const SANDBOX_DWELL: DwellView = {
  taskId: 'task-e1-0001',
  dwellSec: 165,
  withinTarget: true,
};

export const SANDBOX_OUTCOMES: readonly OutcomeView[] = [
  { at: '12:02', family: 'retry', reason: 'insufficient_balance' },
  { at: '12:18', family: 'return', reason: 'insufficient_balance' },
  { at: '14:40', family: 'reschedule', reason: 'honest_absence' },
];
