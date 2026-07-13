import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DELIVERY_OUTCOME_FAMILIES } from '@platform/contracts';
import type { DeliveryOutcome, DeliveryOutcomeFamily, EvidenceBundle } from '@platform/contracts';
import { deriveDeskRow, type DeskCustody } from '../src/exceptions';

/**
 * WO-6.9-d · D4 exceptions desk — structured reason + evidence → EXACTLY ONE of
 * the ratified family (retry·reschedule·return·incident); SE-I10 never-unowned;
 * and the GENERIC-FAILURE-UNREPRESENTABLE fixture (type level — the canon enum
 * makes « échec »/"failed" not a value, verified by the typecheck gate).
 */

const AT = '2026-07-12T09:00:00.000Z';
const outcome = (over: Partial<DeliveryOutcome> = {}): DeliveryOutcome => ({
  taskId: 'task-1',
  orderId: 'ord-1',
  family: 'reschedule',
  reasonCode: 'honest_absence',
  humanReasonRef: 'console.reason_honest_absence',
  faultClass: 'buyer',
  attempt: { number: 1, at: AT },
  ...over,
});
const evidence = (over: Partial<EvidenceBundle> = {}): EvidenceBundle => ({
  taskId: 'task-1',
  packageId: 'pkg-1',
  custodySealId: 'seal-1',
  artifacts: [{ ref: 'media/1', sha256: 'sha-1', mimeType: 'image/jpeg' }],
  capturedAt: AT,
  ...over,
});
const custody = (over: Partial<DeskCustody> = {}): DeskCustody => ({
  packageId: 'pkg-1',
  currentCustodian: 'rider:issa',
  ...over,
});

describe('WO-6.9-d D4 — the exceptions desk read-model', () => {
  it('structured reason → EXACTLY ONE outcome from the ratified family, custody legible', () => {
    const row = deriveDeskRow(
      outcome({ family: 'return', reasonCode: 'insufficient_balance', humanReasonRef: 'console.reason_insufficient_balance' }),
      evidence(),
      custody(),
    );
    expect(row.family).toBe('return');
    expect(DELIVERY_OUTCOME_FAMILIES).toContain(row.family); // it is one of the four, always
    expect(row.reasonCode).toBe('insufficient_balance'); // the structured reason travels with the outcome
    expect(row.humanReasonRef).toBe('console.reason_insufficient_balance');
    expect(row.hasEvidence).toBe(true);
    expect(row.currentCustodian).toBe('rider:issa'); // custody stays legible at the desk
    expect(row.isIncident).toBe(false);
  });

  it('the incident family is flagged loud (the most important case)', () => {
    const row = deriveDeskRow(
      outcome({ family: 'incident', reasonCode: 'fraud', humanReasonRef: 'console.reason_fraud', faultClass: 'unresolved' }),
      evidence(),
      custody(),
    );
    expect(row.isIncident).toBe(true);
  });

  it('SE-I10: a package behind a failed attempt is NEVER unowned — an empty custodian THROWS', () => {
    expect(() => deriveDeskRow(outcome(), evidence(), custody({ currentCustodian: '   ' }))).toThrow(/never unowned/);
    expect(() => deriveDeskRow(outcome(), evidence(), custody({ currentCustodian: '' }))).toThrow(/never unowned/);
    // and the happy path does NOT throw — the throw depends on the custodian, not on chance
    expect(() => deriveDeskRow(outcome(), evidence(), custody())).not.toThrow();
  });

  it('structured, not free-floating: evidence for a DIFFERENT package THROWS', () => {
    expect(() => deriveDeskRow(outcome(), evidence({ packageId: 'pkg-other' }), custody({ packageId: 'pkg-1' }))).toThrow(
      /evidence must bind/,
    );
  });

  it('GENERIC-FAILURE-UNREPRESENTABLE (type level): « échec »/"failed" is not a value, and reasonCode/family cannot be omitted', () => {
    // @ts-expect-error — « échec » is not a DeliveryOutcomeFamily (the canon enum is exactly the four)
    const echec: DeliveryOutcomeFamily = 'échec';
    // @ts-expect-error — nor is a generic "failed"
    const failed: DeliveryOutcomeFamily = 'failed';
    // @ts-expect-error — a DeliveryOutcome cannot omit its structured reasonCode (no reasonless failure)
    const reasonless: DeliveryOutcome = { taskId: 't', orderId: 'o', family: 'retry', humanReasonRef: 'console.reason_fraud', faultClass: 'buyer', attempt: { number: 1, at: AT } };
    // @ts-expect-error — a DeliveryOutcome cannot omit its family (there is no default/generic outcome)
    const familyless: DeliveryOutcome = { taskId: 't', orderId: 'o', reasonCode: 'fraud', humanReasonRef: 'console.reason_fraud', faultClass: 'buyer', attempt: { number: 1, at: AT } };
    void echec;
    void failed;
    void reasonless;
    void familyless;
    // runtime witness: the canonical family is exactly the four, with no generic-failure token
    expect([...DELIVERY_OUTCOME_FAMILIES]).toStrictEqual(['retry', 'reschedule', 'return', 'incident']);
    expect((DELIVERY_OUTCOME_FAMILIES as readonly string[]).includes('failed')).toBe(false);
    expect((DELIVERY_OUTCOME_FAMILIES as readonly string[]).includes('échec')).toBe(false);
  });

  it('every ratified family has a register-tagged French label in the catalog (render binds to canon)', () => {
    const catalog = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'i18n', 'catalog.json'), 'utf8')) as { key: string }[];
    const keys = new Set(catalog.map((e) => e.key));
    for (const f of DELIVERY_OUTCOME_FAMILIES) {
      expect(keys.has(`console.family_${f}`), `missing catalog key console.family_${f}`).toBe(true);
    }
  });

  it('the desk read-model is import-type-only (it renders custody, it cannot write it)', () => {
    const raw = readFileSync(join(import.meta.dirname, '..', 'src', 'exceptions.ts'), 'utf8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toMatch(/import type \{[^}]*\} from '@platform\/contracts'/);
    expect(code).not.toMatch(/\bimport\b(?!\s+type)/); // no value imports → nothing to write with
  });
});
