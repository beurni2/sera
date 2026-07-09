import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findAssignmentAuthorityViolations } from '../src/assignment-authority.js';
import { captureOnShiftLocation, type ActiveShiftScope } from '../src/shift-location.js';

// CI gates: one-assignment-authority (SE-I01) + off-shift-location (SE-I08).

const fixturesDir = join(import.meta.dirname, '../../../gates/fixtures');

describe('one-assignment-authority (SE-I01)', () => {
  it('one active lease per task (expired/released riders along) — no violation', () => {
    const leases = JSON.parse(readFileSync(join(fixturesDir, 'leases.single-authority.json'), 'utf8'));
    expect(findAssignmentAuthorityViolations(leases)).toEqual([]);
  });

  it('two ACTIVE leases on one task is a violation naming both holders', () => {
    const leases = JSON.parse(
      readFileSync(join(fixturesDir, 'negative/leases.double-assignment.json'), 'utf8'),
    );
    const violations = findAssignmentAuthorityViolations(leases);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.activeLeaseCount).toBe(2);
    expect(violations[0]?.holders).toHaveLength(2);
  });
});

describe('off-shift-location (SE-I08/SE-I07)', () => {
  it('capture requires an active shift scope and yields coarse, supporting-only readings', () => {
    const scope = { shiftId: 'sh_1', riderId: 'r_1', status: 'active' } as ActiveShiftScope;
    const reading = captureOnShiftLocation(scope, 'Dassasgho', '2026-07-09T12:00:00Z');
    expect(reading.coarseZone).toBe('Dassasgho');
    expect(reading.evidentiaryWeight).toBe('supporting_never_proof');
    // and the type refuses a non-active scope:
    // @ts-expect-error — status 'closed' is not an ActiveShiftScope
    const bad: ActiveShiftScope = { shiftId: 'sh_1', riderId: 'r_1', status: 'closed' };
    void bad;
  });
});
