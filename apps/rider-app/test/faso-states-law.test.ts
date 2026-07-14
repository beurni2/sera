import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WO-FP-SERA · the STATES-LAW GUARD (founder veto ①: every existing rider state
 * survives the restyle; the ABSENT-from-prototype states — the honesty/offline/
 * pending sub-states with no « Ecrans » frame — are restyled in the grammar and
 * NONE is dropped). This is the programmatic teeth of
 * `_review/WO-FP-SERA/states-law-inventory.md`: each state must keep a render/
 * handling path. If the full restyle (views 4–13) silently drops one, this FAILS.
 *
 * (The main-path SCREEN states are separately guarded by the journey-spine test —
 * « the App renders a block for every screen in the map ». This guard covers the
 * SUB-states that spine coverage does not name.)
 */

const appDir = join(new URL('.', import.meta.url).pathname, '..');
const app = readFileSync(join(appDir, 'App.tsx'), 'utf8');
const sos = readFileSync(join(appDir, 'src/ui/faso-sos.tsx'), 'utf8');

/** [state, the render/handling marker that must survive, the source it lives in]. */
const ABSENT_FROM_PROTOTYPE: ReadonlyArray<readonly [string, string, string]> = [
  ['evidence_pending (SE-I06 en-attente-until-ack)', "screen === 'evidence_pending'", app],
  ['ack_pending (offline course ack)', 'assignment.ack_pending', app],
  ['decline_pending (offline decline)', 'assignment.decline_pending', app],
  ['proposalOutcome declined', 'statut_rendue', app],
  ['proposalOutcome expired', 'statut_expiree', app],
  ['offline banner', 'offline && (', app],
  ['backlog (real pending count)', 'backlog === 0', app],
  ['persistFailed (background-persist failure surface)', 'persistFailed &&', app],
  ['shift pending (offline shift-start)', "shift === 'pending'", app],
  ['retry_window (mm:ss countdown)', "screen === 'retry_window'", app],
  ['reschedule_planned (2e-passage lineage)', "screen === 'reschedule_planned'", app],
  ['refused_final (terminal refusal → return)', "screen === 'refused_final'", app],
  ['SOS queued (offline, unacknowledgeable — no ack shown)', "state === 'queued'", sos],
];

describe('WO-FP-SERA — states-law: every absent-from-prototype state survives (none dropped)', () => {
  it('each honesty/offline/pending sub-state keeps its render/handling path', () => {
    for (const [state, marker, src] of ABSENT_FROM_PROTOTYPE) {
      expect(src.includes(marker), `states-law: « ${state} » dropped — its marker ${JSON.stringify(marker)} is gone`).toBe(true);
    }
  });
});
