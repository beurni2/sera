import { PlatformEventSchema, type PlatformEvent } from '@platform/contracts';

/**
 * WO-2.2 item 8 — E2 ops alerts (Contract E2 exit: "the defined recovery
 * state + a reconciliation alert"). Deterministic detectors over explicit
 * observations — no polling, no inference; the caller feeds facts, the
 * monitor emits canonical `reconciliation.alert.v1` events. Two sera E2
 * scenarios:
 *   impossible_custody — the custody record contradicts itself (a broken
 *     hash chain, or a conflicting-custodian write observed at the store);
 *   evidence_not_validated_aging — evidence accepted but no
 *     ValidationDecision within the aging window (versioned policy data).
 */

export const OPS_AGING_POLICY_V1 = {
  version: 'ops-aging-policy.v1',
  /** Evidence accepted but undecided for longer than this → alert. */
  evidenceDecisionAgingMin: 30,
} as const;

export type OpsObservation =
  | { scenario: 'impossible_custody'; packageId: string; detail: string; at: string }
  | {
      scenario: 'evidence_not_validated_aging';
      taskId: string;
      submittedAt: string;
      now: string;
    };

export class OpsMonitor {
  private readonly alerts: PlatformEvent[] = [];
  private sequence = 0;

  observe(observation: OpsObservation): { alerted: boolean; event?: PlatformEvent } {
    if (observation.scenario === 'evidence_not_validated_aging') {
      const ageMin = (Date.parse(observation.now) - Date.parse(observation.submittedAt)) / 60_000;
      if (ageMin < OPS_AGING_POLICY_V1.evidenceDecisionAgingMin) {
        return { alerted: false };
      }
      return { alerted: true, event: this.emit({
        scenario: observation.scenario,
        task_id: observation.taskId,
        submitted_at: observation.submittedAt,
        age_min: Math.floor(ageMin),
      }, observation.now) };
    }
    return { alerted: true, event: this.emit({
      scenario: observation.scenario,
      package_id: observation.packageId,
      detail: observation.detail,
    }, observation.at) };
  }

  private emit(payload: Record<string, unknown>, at: string): PlatformEvent {
    this.sequence += 1;
    const event = PlatformEventSchema.parse({
      name: 'reconciliation.alert.v1',
      envelope: {
        command_id: `ops-alert-${this.sequence}`,
        correlation_id: `ops-${this.sequence}`,
        aggregateVersion: this.sequence,
        actor: 'custody-service:ops-monitor',
        serverTime: at,
        version: '1',
      },
      payload,
    });
    this.alerts.push(event);
    return event;
  }

  allAlerts(): readonly PlatformEvent[] {
    return [...this.alerts];
  }
}
