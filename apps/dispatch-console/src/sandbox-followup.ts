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

/** WO-2.7 item 2 — the sandbox's door-paid signal (reached via the explicit
 * « Essai » path, never faked as live): a well-formed provider-class event
 * the DoorSignalFollower actually consumes. Live signals replace this at
 * E2 assembly. */
export const SANDBOX_DOOR_ORDER = 'order-e1-0001';
export const SANDBOX_DOOR_PAID_SIGNAL = {
  name: 'payment.door_leg_confirmed.v1',
  envelope: {
    command_id: 'cmd-sandbox-door-1',
    correlation_id: 'corr-e1-0001',
    aggregateVersion: 1,
    actor: 'shop:commerce-core',
    serverTime: '2026-07-10T12:00:00.000Z',
    version: '1',
  },
  payload: {
    provider: 'sandbox-provider',
    payment_attempt_id: 'pa-e1-0001',
    collectRef: 'collect-e1-0001',
    amount: 11_500,
    fee: 0,
    status: 'captured',
    order_id: SANDBOX_DOOR_ORDER,
    redelivery: 0,
  },
} as const;
