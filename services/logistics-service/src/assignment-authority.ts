import type { AssignmentLease } from '@platform/contracts';

/**
 * One-assignment-authority SEED (SE-I01: "Exactly one assignment authority
 * per task; a courier MUST NOT self-assign." / §5.6: AssignmentLease —
 * "exactly one active"). This pure check is the type/architecture seed the
 * SE2.1 Durable Object hardens into an atomic runtime invariant; the CI gate
 * runs it over lease-set fixtures, negative fixture included.
 */

export interface AssignmentAuthorityViolation {
  taskId: string;
  activeLeaseCount: number;
  holders: string[];
}

export function findAssignmentAuthorityViolations(
  leases: readonly AssignmentLease[],
): AssignmentAuthorityViolation[] {
  const activeByTask = new Map<string, AssignmentLease[]>();
  for (const lease of leases) {
    if (lease.status !== 'active') continue;
    const list = activeByTask.get(lease.taskId) ?? [];
    list.push(lease);
    activeByTask.set(lease.taskId, list);
  }
  const violations: AssignmentAuthorityViolation[] = [];
  for (const [taskId, active] of activeByTask) {
    if (active.length > 1) {
      violations.push({
        taskId,
        activeLeaseCount: active.length,
        holders: active.map((l) => l.holder),
      });
    }
  }
  return violations;
}
