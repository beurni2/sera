import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HANDOFF_AUTHORIZATION_STATES } from '@platform/contracts';
import { deriveBreakGlassBoard, type BreakGlassView } from '../src/break-glass';

/**
 * WO-6.9-e · D5 break-glass honest shell — PART 8 §5 (maker-checker). The
 * dispatcher's surface RENDERS the HandoffAuthorization state machine read-only,
 * captures only the GROUND half, and — the load-bearing proof — the ISSUING
 * lever DOES NOT EXIST here (absence proven structurally, the D1/D3/D4 pattern),
 * the fourth secret + franc are unrepresentable in the view, and the dispatcher's
 * ground half never advances the authorization.
 */

const view = (over: Partial<BreakGlassView> = {}): BreakGlassView => ({
  orderId: 'ord-1',
  riderId: 'rider-issa',
  source: 'break_glass',
  state: 'operator_verifying',
  breakGlassCaseId: 'bg-1',
  reasonRef: 'console.bg_reason_demo',
  ...over,
});

describe('WO-6.9-e D5 — the break-glass honest shell', () => {
  it('renders the state machine READ-ONLY: earlier steps done, current marked, later « en attente »', () => {
    const b = deriveBreakGlassBoard(view({ state: 'operator_verifying' }), false);
    const byState = Object.fromEntries(b.steps.map((s) => [s.state, s.status]));
    expect(byState['requested']).toBe('done');
    expect(byState['operator_verifying']).toBe('current');
    // provider-confirm and issuance are NOT the console's to reach — honestly pending (« en attente »)
    expect(byState['provider_confirmed']).toBe('pending');
    expect(byState['issued']).toBe('pending');
    expect(byState['consumed']).toBe('pending');
    // every rendered step is a canonical HandoffAuthorization state (render binds to canon)
    for (const s of b.steps) expect(HANDOFF_AUTHORIZATION_STATES).toContain(s.state);
  });

  it('THE DISPATCHER\'S GROUND HALF NEVER ADVANCES THE AUTHORIZATION (maker-checker): ground-verified ≠ issued', () => {
    const notVerified = deriveBreakGlassBoard(view(), false);
    const verified = deriveBreakGlassBoard(view(), true);
    // ground verification colours ONLY groundVerified — the state machine is byte-identical
    expect(verified.steps).toStrictEqual(notVerified.steps);
    expect(verified.groundVerified).toBe(true);
    expect(notVerified.groundVerified).toBe(false);
    // it did NOT reach 'issued'/'consumed' — the current step is unchanged
    expect(verified.steps.find((s) => s.status === 'current')?.state).toBe('operator_verifying');
  });

  it('an exceptional terminal (voided/expired) shows the happy path as never-completed, terminal flagged', () => {
    const voided = deriveBreakGlassBoard(view({ state: 'voided' }), false);
    expect(voided.terminal).toBe('voided');
    expect(voided.steps.every((s) => s.status === 'pending')).toBe(true);
    expect(deriveBreakGlassBoard(view({ state: 'expired' }), false).terminal).toBe('expired');
    expect(deriveBreakGlassBoard(view(), false).terminal).toBeNull();
  });

  it('THE FOURTH SECRET + FRANC ARE UNREPRESENTABLE in the dispatcher\'s view (type level)', () => {
    const v = view();
    // @ts-expect-error — the signature (fourth secret / issuing credential) never reaches the dispatcher's surface
    const _sig = v.signature;
    // @ts-expect-error — no franc in Séra: the dispatcher's view carries no amount
    const _amt = v.exactAmount;
    void _sig;
    void _amt;
    expect(v.breakGlassCaseId).toBe('bg-1');
  });

  it('THE ISSUING LEVER DOES NOT EXIST in the console (absence proven structurally)', () => {
    const srcDir = join(import.meta.dirname, '..', 'src');
    const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    // an ISSUING action (the payment operator's, never the dispatcher's) would look
    // like one of these; the console holds only the GROUND half. None may appear.
    const ISSUE = /\b(issueAuthorization|issueHandoff|authorizeHandoff|grantAuthorization|signAuthorization|issueBreakGlass|advanceAuthorization|confirmProvider|markProviderConfirmed)\b/;
    for (const f of files) {
      const code = readFileSync(join(srcDir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(ISSUE.test(code), `${f} carries an issuing surface (issuing is the payment operator's, not this console)`).toBe(false);
    }
    // the break-glass read-model imports ONLY types → no value import, nothing to write/issue with
    const raw = readFileSync(join(srcDir, 'break-glass.ts'), 'utf8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).toMatch(/import type \{[^}]*\} from '@platform\/contracts'/);
    expect(code).not.toMatch(/\bimport\b(?!\s+type)/);
  });
});
