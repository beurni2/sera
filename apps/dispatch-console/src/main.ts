import { sharedColour, seraColour, spacing, radius, type as typo, interaction, band, touch } from '@platform/ui-tokens/legacy';
import { landmarkFirstLines } from '@sera/logistics-service';
import { buildSandboxWorld } from './sandbox-world';
import { SANDBOX_DOOR_ORDER, SANDBOX_DOOR_PAID_SIGNAL, SANDBOX_DWELL, SANDBOX_OUTCOMES } from './sandbox-followup';
import {
  SANDBOX_INCIDENT_QUEUED,
  SANDBOX_INCIDENT_RAISED,
  acknowledgeSos,
  canAcknowledge,
  type IncidentView,
} from './sandbox-incident';
import { DoorSignalFollower } from './door-signal';
import { deriveRiderBoard, type PackageCustody } from './board';
import {
  SANDBOX_CUSTODY_AGREEMENT,
  SANDBOX_CUSTODY_INCIDENT,
  SANDBOX_MANIFEST,
  SANDBOX_PKG_LABELS,
  SANDBOX_RIDER_NAME,
  SANDBOX_STOP_LABELS,
} from './sandbox-board';
import { deriveDeskRow } from './exceptions';
import { SANDBOX_DESK_ROUTINE, SANDBOX_DESK_WITH_INCIDENT, type DeskEntry } from './sandbox-exceptions';
import { deriveBreakGlassBoard } from './break-glass';
import { SANDBOX_BREAK_GLASS, SANDBOX_BREAK_GLASS_RIDER } from './sandbox-break-glass';
import { t } from './i18n';
import {
  CODES_IDLE,
  actSettled,
  actStart,
  codesView,
  dismissCode,
  mintAvis,
  mintAvisKey,
  refuseAct,
  type CodesRead,
  type CodesUi,
} from './rider-codes';
import { logisticsBase, resolveRiderCodes } from './rider-codes-port';
import {
  RETRAIT_IDLE,
  aEchoue,
  annuler,
  avancer,
  commencer,
  coursesView,
  demandeKey,
  demander,
  enVol,
  etatKey,
  terminer,
  type CoursesRead,
  type RetraitUi,
} from './courses';
import { finServiceCommandId, renvoiCommandId, reprogCommandId, resolveCourses } from './courses-port';
import {
  FIN_SERVICE_IDLE,
  annulerFin,
  commencerFin,
  demanderFin,
  etapeKey as etapeManifesteKey,
  finEchouee,
  finFaite,
  finRefusKey,
  nextOwnerKey,
  refReprise,
  type FinServiceUi,
  type ManifesteRow,
  type NextOwner,
} from './manifeste';
import {
  COUT_LIGNES,
  ENTRY_KINDS,
  OVERHEAD_ITEMS,
  SCALAR_FIELDS,
  SCENARIOS,
  entreeKey,
  flotteRefusKey,
  francs,
  hypothesesDepuisSaisie,
  motoStatutKey,
  saisieDepuisHypotheses,
  type CoutLigne,
  type EntryKind,
  type FlotteVue,
  type Scenario,
} from './flotte';
import { flotteCommandId, resolveFlotte } from './flotte-port';
import {
  FIXATION_IDLE,
  RENVOI_IDLE,
  annulerRenvoi,
  commencerFixation,
  commencerRenvoi,
  composerFenetre,
  demanderRenvoi,
  fenetreLisible,
  fixationEchouee,
  fixationFaite,
  raisonKey,
  refusKey,
  renvoiEchoue,
  renvoiFait,
  renvoiRefusKey,
  reprogView,
  saisieKey,
  type FenetreSaisie,
  type FixationUi,
  type RenvoiUi,
  type ReprogRead,
} from './reprogrammation';

/**
 * WO-6.1 — the dispatch-console RESKINNED on Grand Teint (ui-tokens v0.9.0,
 * sera theme): the print-notice grammar — ink on warm paper, hairline tables,
 * radius-0 boxes, a 4 px amber theme strip, caps overlines. The WO-4.3 leased
 * states are unchanged in behaviour (the assign action runs the REAL leased
 * grant path; the sweep drives both stores; « répondez avant HH:MM » from the
 * lease's own expiresAt; the honest requeued copy). NEW: the console « done »
 * lever (WO-4.3 ruling ⑤) — a dispatcher marks a proposed course delivered,
 * exercising the service's `releaseOnCompletion` (lease released, cause
 * 'completed'). One primary action per card. No auto-assign, no ranking.
 */

const { queue, dispatch, riders } = buildSandboxWorld(new Date().toISOString());
// The sera palette by construction (exactly seraTheme.colours), with precise
// per-key string types (the Theme's index signature would widen accent keys).
const C = { ...sharedColour, ...seraColour };

/** HH:MM of a lease deadline, for « répondez avant HH:MM ». */
const hhmm = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const px = (n: number) => `${n}px`;
const lh = (s: { size: number; lh: number }) => s.size * s.lh;

const root = document.documentElement;
root.style.setProperty('--paper', C.paper);
root.style.setProperty('--sand', C.sand);
root.style.setProperty('--ink', C.ink);
root.style.setProperty('--on-ink', C.onInk);
root.style.setProperty('--muted', C.muted);
root.style.setProperty('--hairline', C.hairline);
root.style.setProperty('--hairline-strong', C.hairlineStrong);
root.style.setProperty('--accent', C.accent);
root.style.setProperty('--accent-strong', C.accentStrong);
root.style.setProperty('--danger', C.danger);
root.style.setProperty('--space-xs', px(spacing.xs));
root.style.setProperty('--space-sm', px(spacing.sm));
root.style.setProperty('--space-md', px(spacing.md));
root.style.setProperty('--space-lg', px(spacing.lg));
root.style.setProperty('--space-xl', px(spacing.xl));
root.style.setProperty('--radius-btn', px(radius.button));
root.style.setProperty('--strip', px(band.themeStripPx));
root.style.setProperty('--touch', px(touch.minTargetPx));
root.style.setProperty('--hair', px(interaction.hairline.thin));
root.style.setProperty('--hair-strong', px(interaction.hairline.strong));
root.style.setProperty('--type-title-lg', px(typo.scale.titleLG.size));
root.style.setProperty('--type-title', px(typo.scale.title.size));
root.style.setProperty('--type-body', px(typo.scale.body.size));
root.style.setProperty('--type-row', px(typo.scale.row.size));
root.style.setProperty('--type-label', px(typo.scale.label.size));
root.style.setProperty('--type-label-lh', px(lh(typo.scale.label)));
root.style.setProperty('--type-caption', px(typo.scale.caption.size));
root.style.setProperty('--ls-label', px(typo.scale.label.ls));

const style = document.createElement('style');
style.textContent = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--sand);
    color: var(--ink);
    font-family: 'Archivo', system-ui, sans-serif;
  }
  #app {
    max-width: 720px;
    margin: 0 auto;
    background: var(--paper);
    min-height: 100vh;
    border-left: var(--hair) solid var(--hairline);
    border-right: var(--hair) solid var(--hairline);
  }
  header {
    padding: var(--space-md) var(--space-xl);
    border-bottom: var(--hair) solid var(--hairline);
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-md);
  }
  h1 {
    margin: 0;
    color: var(--ink);
    font-size: var(--type-title);
    font-weight: ${typo.scale.title.wght};
    letter-spacing: var(--ls-label);
    text-transform: uppercase;
  }
  .desk {
    color: var(--accent-strong);
    font-size: var(--type-label);
    font-weight: ${typo.scale.label.wght};
    letter-spacing: var(--ls-label);
    text-transform: uppercase;
  }
  .hours-note {
    color: var(--muted);
    font-size: var(--type-label);
    font-weight: ${typo.scale.label.wght};
    letter-spacing: var(--ls-label);
    text-transform: uppercase;
  }
  .theme-strip { height: var(--strip); background: var(--accent); }
  main {
    padding: var(--space-xl);
    display: grid;
    gap: var(--space-lg);
  }
  h2 {
    margin: 0 0 var(--space-sm) 0;
    font-size: var(--type-label);
    font-weight: ${typo.scale.label.wght};
    letter-spacing: var(--ls-label);
    text-transform: uppercase;
    color: var(--muted);
  }
  .task-card, .follow-card, .empty-state {
    background: var(--paper);
    border: var(--hair-strong) solid var(--ink);
    padding: var(--space-lg);
    font-size: var(--type-body);
  }
  .empty-state {
    border: var(--hair) solid var(--hairline-strong);
    color: var(--muted);
    text-align: center;
  }
  .location-line { margin: 0 0 var(--space-xs) 0; }
  .location-line:first-of-type {
    font-weight: ${typo.scale.titleLG.wght};
    font-size: var(--type-title-lg);
    line-height: 1.1;
    margin-bottom: var(--space-sm);
  }
  .location-line:nth-of-type(3) {
    font-size: var(--type-label);
    font-weight: ${typo.scale.label.wght};
    letter-spacing: var(--ls-label);
    text-transform: uppercase;
    color: var(--muted);
  }
  .codes-desk { display: grid; gap: var(--space-sm); }
.codes-state { font-size: var(--type-body); color: var(--ink); margin: 0; }
.codes-hint { font-size: var(--type-label); color: var(--muted); margin: 0; }
.codes-notice { font-size: var(--type-label); color: var(--danger); margin: 0; }
.codes-row {
  display: grid; gap: var(--space-xs); padding: var(--space-sm) 0;
  border-bottom: var(--hair) solid var(--hairline);
}
.codes-row-who { font-size: var(--type-row); color: var(--ink); margin: 0; }
.codes-row-id { font-size: var(--type-label); color: var(--muted); margin: 0; }
.codes-row-has { font-size: var(--type-label); color: var(--accent-strong); margin: 0; }
.codes-row-none { font-size: var(--type-label); color: var(--muted); margin: 0; }
/* The one-time code: the loudest thing on the desk, because it is on screen
   once and the founder is copying it onto paper or reading it down a phone. */
.codes-nouveau {
  display: grid; gap: var(--space-xs);
  padding: var(--space-md); background: var(--sand);
  border: var(--hair-strong) solid var(--accent-strong);
}
.codes-nouveau-title { font-size: var(--type-title); color: var(--ink); margin: 0; }
.codes-nouveau-who { font-size: var(--type-label); color: var(--muted); margin: 0; }
.codes-nouveau-code {
  font-size: var(--type-title-lg); color: var(--ink); margin: 0;
  font-variant-numeric: tabular-nums; letter-spacing: 0.12em;
  /* Read at arm's length and compared character by character. */
  word-break: break-all;
}
.codes-form { display: grid; gap: var(--space-xs); padding-top: var(--space-sm); }
.codes-form-title { font-size: var(--type-body); color: var(--ink); margin: 0; }
.codes-avis { font-size: var(--type-label); color: var(--ink); margin: 0; }
.codes-desk input {
  min-height: var(--touch); padding: 0 var(--space-sm);
  font-size: var(--type-body); color: var(--ink);
  background: var(--paper); border: var(--hair) solid var(--hairline-strong);
  border-radius: 0;
}
.codes-desk button { min-height: var(--touch); }
.rider-row {
    display: flex;
    gap: var(--space-sm);
    align-items: center;
    margin-top: var(--space-md);
    flex-wrap: wrap;
  }
  .rider-label {
    color: var(--muted);
    font-size: var(--type-label);
    font-weight: ${typo.scale.label.wght};
    letter-spacing: var(--ls-label);
    text-transform: uppercase;
  }
  select {
    min-height: var(--touch);
    font-size: var(--type-body);
    border: var(--hair-strong) solid var(--hairline-strong);
    background: var(--paper);
    color: var(--ink);
    padding: 0 var(--space-sm);
  }
  button.assign, button.done, button.bg-ground {
    min-height: var(--touch);
    padding: 0 var(--space-xl);
    border: 0;
    border-radius: var(--radius-btn);
    background: var(--ink);
    color: var(--on-ink);
    font-size: var(--type-row);
    font-weight: ${typo.scale.title.wght};
    letter-spacing: var(--ls-label);
    text-transform: uppercase;
    cursor: pointer;
  }
  button.done { margin-top: var(--space-md); }
  .status-line { color: var(--ink); font-size: var(--type-body); margin: 0; font-weight: ${typo.scale.bodyStrong.wght}; }
  .deadline-line { color: var(--muted); font-size: var(--type-body); margin: var(--space-xs) 0 0 0; }
  .completed-line {
    color: var(--ink);
    background: var(--sand);
    border-left: var(--hair-strong) solid var(--accent-strong);
    padding: var(--space-sm) var(--space-md);
    margin: var(--space-md) 0 0 0;
    font-weight: ${typo.scale.bodyStrong.wght};
  }
  button.door-demo {
    min-height: var(--touch);
    border: 0;
    background: none;
    color: var(--accent-strong);
    font-size: var(--type-label);
    font-weight: ${typo.scale.label.wght};
    letter-spacing: var(--ls-label);
    text-transform: uppercase;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
  }
  /* WO-6.3 SOS alert — the loudest thing on the console when an incident is
     raised: a thick danger border, danger title, at the very top. */
  .sos-alert {
    border: calc(var(--hair-strong) * 2) solid var(--danger);
    background: var(--paper);
    padding: var(--space-lg);
    display: grid;
    gap: var(--space-xs);
  }
  /* author display:grid would defeat the UA [hidden] rule — restore it so the
     alert is truly absent until an incident is raised (never a fake alarm). */
  .sos-alert[hidden] { display: none; }
  .sos-alert.acknowledged { border-color: var(--accent-strong); }
  .sos-alert.queued { border-style: dashed; }
  .sos-title {
    margin: 0 0 var(--space-xs) 0;
    color: var(--danger);
    font-size: var(--type-title);
    font-weight: ${typo.scale.title.wght};
    letter-spacing: var(--ls-label);
    text-transform: uppercase;
  }
  .sos-alert.acknowledged .sos-title { color: var(--accent-strong); }
  .sos-line { margin: 0; font-size: var(--type-body); }
  .sos-meta {
    margin: 0;
    color: var(--muted);
    font-size: var(--type-label);
    font-weight: ${typo.scale.label.wght};
    letter-spacing: var(--ls-label);
    text-transform: uppercase;
  }
  .sos-custody {
    margin: var(--space-xs) 0;
    color: var(--ink);
    background: var(--sand);
    border-left: var(--hair-strong) solid var(--accent-strong);
    padding: var(--space-sm) var(--space-md);
    font-weight: ${typo.scale.bodyStrong.wght};
  }
  .sos-ackd {
    margin: var(--space-xs) 0 0 0;
    color: var(--accent-strong);
    font-weight: ${typo.scale.bodyStrong.wght};
  }
  button.sos-ack {
    min-height: var(--touch);
    padding: 0 var(--space-xl);
    border: 0;
    border-radius: var(--radius-btn);
    background: var(--danger);
    color: var(--on-ink);
    font-size: var(--type-row);
    font-weight: ${typo.scale.title.wght};
    letter-spacing: var(--ls-label);
    text-transform: uppercase;
    cursor: pointer;
    margin-top: var(--space-sm);
    justify-self: start;
  }
  button.sos-ack:disabled { background: var(--muted); cursor: not-allowed; opacity: 0.6; }
  .sos-demo-controls { display: flex; gap: var(--space-lg); flex-wrap: wrap; }
  button.sos-raise, button.sos-raise-queued, button.board-demo-normal, button.board-demo-incident,
  button.desk-demo-routine, button.desk-demo-incident {
    min-height: var(--touch);
    border: 0;
    background: none;
    color: var(--accent-strong);
    font-size: var(--type-label);
    font-weight: ${typo.scale.label.wght};
    letter-spacing: var(--ls-label);
    text-transform: uppercase;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
  }
  /* WO-6.9-c live board — read-only; custody truth first, an incident is loud. */
  .board { border: var(--hair-strong) solid var(--ink); padding: var(--space-lg); display: grid; gap: var(--space-sm); }
  .board-rider { margin: 0; font-size: var(--type-title-lg); font-weight: ${typo.scale.titleLG.wght}; line-height: 1.1; }
  .board-stop { margin: 0; font-size: var(--type-body); font-weight: ${typo.scale.bodyStrong.wght}; }
  .board-upcoming { margin: 0; color: var(--muted); font-size: var(--type-label); font-weight: ${typo.scale.label.wght}; letter-spacing: var(--ls-label); text-transform: uppercase; }
  .board-pkg { border: var(--hair) solid var(--hairline-strong); padding: var(--space-md); margin-top: var(--space-sm); display: grid; gap: var(--space-xs); }
  .board-pkg.incident { border: calc(var(--hair-strong) * 2) solid var(--danger); }
  .board-pkg-name { margin: 0; font-size: var(--type-body); font-weight: ${typo.scale.bodyStrong.wght}; }
  .board-custody { margin: 0; color: var(--ink); background: var(--sand); border-left: var(--hair-strong) solid var(--accent-strong); padding: var(--space-xs) var(--space-sm); font-weight: ${typo.scale.bodyStrong.wght}; }
  .board-incident-title { margin: var(--space-xs) 0 0 0; color: var(--danger); font-size: var(--type-body); font-weight: ${typo.scale.title.wght}; letter-spacing: var(--ls-label); text-transform: uppercase; }
  .board-incident-body { margin: 0; color: var(--ink); font-size: var(--type-body); }
  /* WO-6.9-d exceptions desk — read-only; structured reason → one of four outcomes, an incident is loud.
     (own class, distinct from the .desk header overline at the top of this sheet — no cascade collision.) */
  .exceptions-desk { border: var(--hair-strong) solid var(--ink); padding: var(--space-lg); display: grid; gap: var(--space-sm); }
  .desk-row { border: var(--hair) solid var(--hairline-strong); padding: var(--space-md); display: grid; gap: var(--space-xs); }
  .desk-row.incident { border: calc(var(--hair-strong) * 2) solid var(--danger); }
  .desk-pkg-name { margin: 0; font-size: var(--type-body); font-weight: ${typo.scale.bodyStrong.wght}; }
  .desk-reason { margin: 0; color: var(--ink); font-size: var(--type-body); }
  .desk-outcome { margin: 0; color: var(--ink); background: var(--sand); border-left: var(--hair-strong) solid var(--accent-strong); padding: var(--space-xs) var(--space-sm); font-weight: ${typo.scale.bodyStrong.wght}; }
  .desk-custody { margin: 0; color: var(--muted); font-size: var(--type-label); font-weight: ${typo.scale.label.wght}; letter-spacing: var(--ls-label); text-transform: uppercase; }
  .desk-evidence { margin: 0; color: var(--muted); font-size: var(--type-label); font-weight: ${typo.scale.label.wght}; letter-spacing: var(--ls-label); text-transform: uppercase; }
  .desk-incident-note { margin: var(--space-xs) 0 0 0; color: var(--danger); font-size: var(--type-body); }
  .desk-never-unowned { margin: 0; color: var(--ink); background: var(--sand); border-left: var(--hair-strong) solid var(--accent-strong); padding: var(--space-xs) var(--space-sm); font-size: var(--type-body); }
  /* WO-6.9-e break-glass — read-only state machine; the dispatcher holds the ground half only, issuing is elsewhere. */
  .break-glass { border: var(--hair-strong) solid var(--ink); padding: var(--space-lg); display: grid; gap: var(--space-sm); }
  .bg-rider { margin: 0; font-size: var(--type-title-lg); font-weight: ${typo.scale.titleLG.wght}; line-height: 1.1; }
  .bg-meta { margin: 0; color: var(--muted); font-size: var(--type-label); font-weight: ${typo.scale.label.wght}; letter-spacing: var(--ls-label); text-transform: uppercase; }
  .bg-reason { margin: 0; color: var(--ink); font-size: var(--type-body); }
  .bg-steps { display: grid; gap: var(--space-xs); border: var(--hair) solid var(--hairline-strong); padding: var(--space-md); }
  .bg-step { margin: 0; font-size: var(--type-body); color: var(--muted); }
  .bg-step.done { color: var(--ink); }
  .bg-step.current { color: var(--ink); font-weight: ${typo.scale.bodyStrong.wght}; }
  .bg-step.pending { color: var(--muted); }
  .bg-ground-done { margin: 0; color: var(--ink); background: var(--sand); border-left: var(--hair-strong) solid var(--accent-strong); padding: var(--space-xs) var(--space-sm); font-weight: ${typo.scale.bodyStrong.wght}; }
  .bg-maker-checker { margin: 0; color: var(--ink); border-left: calc(var(--hair-strong) * 2) solid var(--accent-strong); padding: var(--space-xs) var(--space-sm); font-size: var(--type-body); }
  .drill-status { margin: var(--space-md) 0 0 0; color: var(--muted); font-size: var(--type-label); font-weight: ${typo.scale.label.wght}; letter-spacing: var(--ls-label); text-transform: uppercase; }
  /* PURGE-ESSAI — the courses desk. Retiring is DESTRUCTIVE, so its levers
     WHISPER (the underlined secondary grammar the demo levers use) and never
     wear the filled ink of a primary action. Only the confirmation, once he
     has asked for it on purpose, is loud — and it is loud in danger, not in
     accent, so it can never be mistaken for the assign button. */
  .courses-desk { display: grid; gap: var(--space-sm); }
  .courses-state { margin: 0; font-size: var(--type-body); color: var(--ink); }
  .courses-hint { margin: 0; font-size: var(--type-label); color: var(--muted); }
  .courses-notice { margin: 0; font-size: var(--type-label); color: var(--danger); }
  .courses-row {
    display: grid; gap: var(--space-xs); padding: var(--space-sm) 0;
    border-bottom: var(--hair) solid var(--hairline);
  }
  .courses-row-order { margin: 0; font-size: var(--type-row); color: var(--ink); }
  .courses-row-etat {
    margin: 0; color: var(--muted); font-size: var(--type-label);
    font-weight: ${typo.scale.label.wght}; letter-spacing: var(--ls-label); text-transform: uppercase;
  }
  .courses-actions { display: flex; gap: var(--space-lg); flex-wrap: wrap; padding-top: var(--space-sm); }
  button.courses-retirer, button.courses-tout, button.courses-relire, button.courses-annuler {
    min-height: var(--touch); border: 0; background: none; color: var(--accent-strong);
    font-size: var(--type-label); font-weight: ${typo.scale.label.wght};
    letter-spacing: var(--ls-label); text-transform: uppercase; text-decoration: underline;
    cursor: pointer; padding: 0; justify-self: start;
  }
  button.courses-retirer:disabled, button.courses-tout:disabled, button.courses-relire:disabled {
    color: var(--muted); cursor: not-allowed; opacity: 0.6;
  }
  .courses-confirme {
    border: calc(var(--hair-strong) * 2) solid var(--danger); background: var(--paper);
    padding: var(--space-lg); display: grid; gap: var(--space-xs);
  }
  .courses-confirme-titre {
    margin: 0; color: var(--danger); font-size: var(--type-title);
    font-weight: ${typo.scale.title.wght}; letter-spacing: var(--ls-label); text-transform: uppercase;
  }
  .courses-confirme-ligne { margin: 0; font-size: var(--type-body); color: var(--ink); }
  button.courses-confirmer {
    min-height: var(--touch); padding: 0 var(--space-xl); border: 0; border-radius: var(--radius-btn);
    background: var(--danger); color: var(--on-ink); font-size: var(--type-row);
    font-weight: ${typo.scale.title.wght}; letter-spacing: var(--ls-label); text-transform: uppercase;
    cursor: pointer; justify-self: start; margin-top: var(--space-sm);
  }
  /* REPROGRAMMATION-1 — the next passage desk. Fixing a passage is LIVE WORK
     (a rider is holding a package for it), so its one lever wears the filled
     ink of a primary action — the assign button's own grammar — and each row
     is one course, one window, one act. */
  .reprog-desk { display: grid; gap: var(--space-sm); }
  .manifeste-desk, .flotte-desk { display: grid; gap: var(--space-sm); }
  .reprog-state { margin: 0; font-size: var(--type-body); color: var(--ink); }
  .reprog-hint { margin: 0; font-size: var(--type-label); color: var(--muted); }
  .reprog-notice { margin: 0; font-size: var(--type-body); color: var(--danger); }
  .reprog-fait { margin: 0; color: var(--ink); background: var(--sand); border-left: var(--hair-strong) solid var(--accent-strong); padding: var(--space-xs) var(--space-sm); font-size: var(--type-body); }
  .reprog-row {
    display: grid; gap: var(--space-xs); padding: var(--space-sm) 0;
    border-bottom: var(--hair) solid var(--hairline);
  }
  .reprog-row-order { margin: 0; font-size: var(--type-row); color: var(--ink); }
  .reprog-row-etat {
    margin: 0; color: var(--muted); font-size: var(--type-label);
    font-weight: ${typo.scale.label.wght}; letter-spacing: var(--ls-label); text-transform: uppercase;
  }
  .reprog-row-depuis { margin: 0; font-size: var(--type-label); color: var(--muted); }
  .reprog-form { display: flex; gap: var(--space-sm); align-items: center; flex-wrap: wrap; padding-top: var(--space-xs); }
  .reprog-champ { display: flex; gap: var(--space-xs); align-items: center; color: var(--muted); font-size: var(--type-label); font-weight: ${typo.scale.label.wght}; letter-spacing: var(--ls-label); text-transform: uppercase; }
  .reprog-desk input {
    min-height: var(--touch); padding: 0 var(--space-sm);
    font-size: var(--type-body); color: var(--ink);
    background: var(--paper); border: var(--hair) solid var(--hairline-strong);
    border-radius: 0;
  }
  button.reprog-fixer {
    min-height: var(--touch); padding: 0 var(--space-xl); border: 0; border-radius: var(--radius-btn);
    background: var(--ink); color: var(--on-ink); font-size: var(--type-row);
    font-weight: ${typo.scale.title.wght}; letter-spacing: var(--ls-label); text-transform: uppercase;
    cursor: pointer;
  }
  button.reprog-fixer:disabled { opacity: 0.6; cursor: not-allowed; }
  button.reprog-relire {
    min-height: var(--touch); border: 0; background: none; color: var(--accent-strong);
    font-size: var(--type-label); font-weight: ${typo.scale.label.wght};
    letter-spacing: var(--ls-label); text-transform: uppercase; text-decoration: underline;
    cursor: pointer; padding: 0; justify-self: start;
  }
  button.reprog-relire:disabled { color: var(--muted); cursor: not-allowed; opacity: 0.6; }
  /* REPROGRAMMATION-2 — « Renvoyer au vendeur » ends a delivery, so the lever
     WHISPERS (the courses desk's secondary grammar) and only its confirmation,
     asked on purpose, is loud — in danger, never in the fixer's ink. */
  button.reprog-renvoyer, button.reprog-renvoi-annuler {
    min-height: var(--touch); border: 0; background: none; color: var(--accent-strong);
    font-size: var(--type-label); font-weight: ${typo.scale.label.wght};
    letter-spacing: var(--ls-label); text-transform: uppercase; text-decoration: underline;
    cursor: pointer; padding: 0; justify-self: start;
  }
  button.reprog-renvoyer:disabled { color: var(--muted); cursor: not-allowed; opacity: 0.6; }
  .reprog-renvoi-card {
    border: calc(var(--hair-strong) * 2) solid var(--danger); background: var(--paper);
    padding: var(--space-lg); display: grid; gap: var(--space-xs);
  }
  .reprog-renvoi-titre {
    margin: 0; color: var(--danger); font-size: var(--type-title);
    font-weight: ${typo.scale.title.wght}; letter-spacing: var(--ls-label); text-transform: uppercase;
  }
  .reprog-renvoi-ligne { margin: 0; font-size: var(--type-body); color: var(--ink); }
  button.reprog-renvoi-confirmer {
    min-height: var(--touch); padding: 0 var(--space-xl); border: 0; border-radius: var(--radius-btn);
    background: var(--danger); color: var(--on-ink); font-size: var(--type-row);
    font-weight: ${typo.scale.title.wght}; letter-spacing: var(--ls-label); text-transform: uppercase;
    cursor: pointer; justify-self: start; margin-top: var(--space-sm);
  }
`;
document.head.appendChild(style);

const app = document.querySelector('#app');
if (app) {
  const header = document.createElement('header');
  const brand = document.createElement('h1');
  brand.textContent = t('app.title');
  const desk = document.createElement('span');
  desk.className = 'desk';
  desk.textContent = t('console.desk');
  const hours = document.createElement('span');
  hours.className = 'hours-note';
  hours.textContent = t('console.hours_note');
  header.append(brand, desk, hours);

  const strip = document.createElement('div');
  strip.className = 'theme-strip';

  const main = document.createElement('main');

  // WO-6.3 — the SOS alert lands at the TOP, ahead of every queue item and
  // visually the loudest. It is EMPTY until an incident is raised (an always-on
  // alert would be a fake alarm); the sandbox « (aperçu) » levers below raise
  // one. Custody stays legible: the rider still holds the package — never
  // orphaned.
  const incidentSection = document.createElement('section');
  incidentSection.className = 'sos-alert';
  incidentSection.hidden = true;
  let currentIncident: IncidentView | null = null;

  const renderIncident = () => {
    incidentSection.replaceChildren();
    const inc = currentIncident;
    if (inc === null) {
      incidentSection.hidden = true;
      incidentSection.className = 'sos-alert';
      return;
    }
    incidentSection.hidden = false;
    incidentSection.className = `sos-alert ${inc.status === 'acknowledged' ? 'acknowledged' : inc.status === 'queued' ? 'queued' : ''}`.trim();

    const title = document.createElement('p');
    title.className = 'sos-title';
    title.textContent = t('console.sos_title');
    incidentSection.appendChild(title);

    const who = document.createElement('p');
    who.className = 'sos-line';
    who.textContent = `${t('console.sos_rider')} : ${inc.riderName}`;
    incidentSection.appendChild(who);

    const corr = document.createElement('p');
    corr.className = 'sos-meta';
    corr.textContent = `${t('console.sos_correlation')} : ${inc.correlationId}`;
    incidentSection.appendChild(corr);

    const task = document.createElement('p');
    task.className = 'sos-line';
    task.textContent = inc.activeTaskId
      ? `${t('console.sos_task')} : ${inc.activeTaskId}`
      : t('console.sos_no_task');
    incidentSection.appendChild(task);

    // SE-I08: coarse location IF present (rider on shift), else the honest
    // off-shift fallback — never a fabricated fix.
    const loc = document.createElement('p');
    loc.className = 'sos-line';
    loc.textContent = inc.coarseLocation
      ? `${t('console.sos_location')} : ${inc.coarseLocation}`
      : t('console.sos_no_location');
    incidentSection.appendChild(loc);

    // Custody line — WHO HOLDS THE PACKAGE: the rider still does; the package
    // is NOT orphaned by an SOS.
    const custody = document.createElement('p');
    custody.className = 'sos-custody';
    custody.textContent = t('console.sos_custody');
    incidentSection.appendChild(custody);

    const responder = document.createElement('p');
    responder.className = 'sos-meta';
    responder.textContent =
      inc.responder === 'dispatcher' ? t('console.sos_responder_dispatcher') : t('console.sos_responder_founder');
    incidentSection.appendChild(responder);

    if (inc.status === 'acknowledged') {
      const ackd = document.createElement('p');
      ackd.className = 'sos-ackd';
      ackd.textContent = t('console.sos_acknowledged');
      incidentSection.appendChild(ackd);
      return;
    }

    if (inc.status === 'queued') {
      const waiting = document.createElement('p');
      waiting.className = 'sos-meta';
      waiting.textContent = t('console.sos_queued');
      incidentSection.appendChild(waiting);
    }

    const ack = document.createElement('button');
    ack.className = 'sos-ack';
    ack.textContent = t('console.sos_ack_action');
    // Honesty law: you cannot ack what has not arrived — a queued incident's
    // lever is DISABLED. Live incidents route through acknowledgeSos.
    ack.disabled = !canAcknowledge(inc);
    if (!ack.disabled) {
      ack.addEventListener('click', () => {
        currentIncident = acknowledgeSos(inc, inc.responder);
        renderIncident();
      });
    }
    incidentSection.appendChild(ack);

    if (inc.status === 'queued') {
      const hint = document.createElement('p');
      hint.className = 'sos-meta';
      hint.textContent = t('console.sos_queued_hint');
      incidentSection.appendChild(hint);
    }
  };
  renderIncident();

  const heading = document.createElement('h2');
  heading.textContent = t('console.ready_queue');
  const body = document.createElement('div');
  body.id = 'queue-body';
  main.append(incidentSection, heading, body);

  const render = (status?: { key: string; deadlineIso?: string; doneTaskId?: string }) => {
    body.replaceChildren();
    const queued = queue.queuedTasks();
    if (status) {
      const line = document.createElement('p');
      line.className = 'status-line';
      line.textContent = t(status.key);
      body.appendChild(line);
      // WO-4.3 trust line — what happens next, with the lease's own clock.
      if (status.deadlineIso !== undefined) {
        const deadline = document.createElement('p');
        deadline.className = 'deadline-line';
        deadline.textContent = `${t('console.proposed_deadline')} ${hhmm(status.deadlineIso)}`;
        body.appendChild(deadline);
      }
      // WO-6.1 (ruling ⑤) — the « done » lever: mark the proposed course
      // delivered, exercising the service's releaseOnCompletion (the lease
      // releases, cause 'completed'). Honest state only — nothing fabricated.
      if (status.doneTaskId !== undefined) {
        const done = document.createElement('button');
        done.className = 'done';
        done.textContent = t('console.done_action');
        const taskId = status.doneTaskId;
        done.addEventListener('click', () => {
          void dispatch.releaseOnCompletion(taskId).then(({ released }) => {
            if (released) render({ key: 'console.completed' });
          });
        });
        body.appendChild(done);
      }
    }
    if (queued.length === 0) {
      if (!status) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = t('console.empty_state');
        body.appendChild(empty);
      }
      return;
    }
    for (const entry of queued) {
      const card = document.createElement('section');
      card.className = 'task-card';
      // SE0.3: landmark-first display order — landmark, directions, zone.
      // Directions are canon-optional ('' is a lawful absence, CONFIER-ALLEGE):
      // an empty line renders nothing rather than a blank row.
      for (const line of landmarkFirstLines(entry.task.location)) {
        if (line === '') continue;
        const p = document.createElement('p');
        p.className = 'location-line';
        p.textContent = line;
        card.appendChild(p);
      }
      const riderRow = document.createElement('div');
      riderRow.className = 'rider-row';
      const riderLabel = document.createElement('span');
      riderLabel.className = 'rider-label';
      riderLabel.textContent = t('console.pick_rider');
      const riderPick = document.createElement('select');
      for (const rider of riders) {
        const option = document.createElement('option');
        option.value = rider.riderId;
        option.textContent = rider.displayName;
        riderPick.appendChild(option);
      }
      const assign = document.createElement('button');
      assign.className = 'assign';
      assign.textContent = t('console.assign_action');
      assign.addEventListener('click', () => {
        // WO-4.3: the FULL leased path — SE1.1 recheck, atomic grant at THE
        // authority, witnessed book entry. Per-attempt command id.
        const at = new Date().toISOString();
        void dispatch
          .assign({
            command_id: `cmd-console-assign-${entry.task.id}-${at}`,
            taskId: entry.task.id,
            riderId: riderPick.value,
            dispatcherId: 'dispatcher-console',
            at,
            newAssignmentId: `as-${entry.task.id}-${at}`,
          })
          .then((outcome) => {
            // A refusal keeps the task visible in the queue — no false claims.
            render(
              outcome.ok
                ? { key: 'console.waiting_ack', deadlineIso: outcome.lease.expiresAt, doneTaskId: entry.task.id }
                : undefined,
            );
          });
      });
      riderRow.append(riderLabel, riderPick, assign);
      card.appendChild(riderRow);
      body.appendChild(card);
    }
  };
  render();

  // WO-6.9-c — the LIVE BOARD (D3): one RouteManifest per rider · one current
  // stop (SE-I03) · one custodian per package (SE-I04). Task status is NEVER
  // custody truth: a task claiming « delivered » while custody still holds the
  // package renders AS AN INCIDENT (custody wins — PART 8 §3), never as
  // agreement. READ-ONLY: the console has no lever that mutates a CustodyRecord;
  // the (aperçu) levers only swap which demo custody SNAPSHOT is shown.
  const boardHeading = document.createElement('h2');
  boardHeading.textContent = t('console.board_heading');
  const boardSection = document.createElement('section');
  boardSection.className = 'board';
  let boardCustody: readonly PackageCustody[] = SANDBOX_CUSTODY_AGREEMENT;
  const custodianLabel = (c: string): string =>
    c.startsWith('rider:') ? t('console.board_held_rider')
      : c.startsWith('hub:') ? t('console.board_held_hub')
        : c === 'customer' ? t('console.board_held_customer')
          : c;
  const renderBoard = () => {
    boardSection.replaceChildren();
    const b = deriveRiderBoard(SANDBOX_MANIFEST, boardCustody);
    const rider = document.createElement('p');
    rider.className = 'board-rider';
    rider.textContent = SANDBOX_RIDER_NAME;
    boardSection.appendChild(rider);
    const stop = document.createElement('p');
    stop.className = 'board-stop';
    stop.textContent = b.currentStop
      ? `${t('console.board_current_stop')} : ${SANDBOX_STOP_LABELS[b.currentStop] ?? b.currentStop}`
      : t('console.board_no_stop');
    boardSection.appendChild(stop);
    const upcoming = document.createElement('p');
    upcoming.className = 'board-upcoming';
    upcoming.textContent = `${t('console.board_upcoming')} : ${b.upcomingStops.length}`;
    boardSection.appendChild(upcoming);
    for (const pkg of b.packages) {
      const card = document.createElement('div');
      card.className = `board-pkg ${pkg.render === 'incident' ? 'incident' : ''}`.trim();
      const name = document.createElement('p');
      name.className = 'board-pkg-name';
      name.textContent = SANDBOX_PKG_LABELS[pkg.packageId] ?? pkg.packageId;
      card.appendChild(name);
      // Custody truth — shown independently of the task's claim (SE-I04).
      const custody = document.createElement('p');
      custody.className = 'board-custody';
      custody.textContent = `${t('console.board_custody')} : ${custodianLabel(pkg.currentCustodian)}`;
      card.appendChild(custody);
      if (pkg.render === 'incident') {
        const it = document.createElement('p');
        it.className = 'board-incident-title';
        it.textContent = t('console.board_incident_title');
        card.appendChild(it);
        const ib = document.createElement('p');
        ib.className = 'board-incident-body';
        ib.textContent = t('console.board_incident_body');
        card.appendChild(ib);
      }
      boardSection.appendChild(card);
    }
  };
  renderBoard();
  // (aperçu) levers — swap the demo custody SNAPSHOT; NEVER a custody write.
  const boardDemo = document.createElement('section');
  boardDemo.className = 'sos-demo-controls';
  const boardNormalBtn = document.createElement('button');
  boardNormalBtn.className = 'board-demo-normal';
  boardNormalBtn.textContent = t('console.board_demo_normal');
  boardNormalBtn.addEventListener('click', () => {
    boardCustody = SANDBOX_CUSTODY_AGREEMENT;
    renderBoard();
  });
  const boardIncidentBtn = document.createElement('button');
  boardIncidentBtn.className = 'board-demo-incident';
  boardIncidentBtn.textContent = t('console.board_demo_incident');
  boardIncidentBtn.addEventListener('click', () => {
    boardCustody = SANDBOX_CUSTODY_INCIDENT;
    renderBoard();
  });
  boardDemo.append(boardNormalBtn, boardIncidentBtn);
  main.append(boardHeading, boardSection, boardDemo);

  // WO-6.9-d — the EXCEPTIONS DESK (D4): every failed delivery lands here with a
  // STRUCTURED reason + evidence, and the dispatcher applies EXACTLY ONE outcome
  // from the ratified family retry · reschedule · return · incident — there is NO
  // generic « échec » (SE-I10; the canon family is exactly those four, so a
  // generic failure is not even a value — see test/exceptions.test.ts). A package
  // is NEVER unowned: custody stays with the rider or the hub until the two-key
  // return handoff. READ-ONLY: the desk renders the resolution; issuing refunds/
  // payouts and mutating custody are NOT the console's (§8.3). The (aperçu) levers
  // only swap which demo SET is shown — never a custody write.
  const deskHeading = document.createElement('h2');
  deskHeading.textContent = t('console.desk_heading');
  const deskSection = document.createElement('section');
  deskSection.className = 'exceptions-desk';
  let deskEntries: readonly DeskEntry[] = SANDBOX_DESK_ROUTINE;
  const renderDesk = () => {
    deskSection.replaceChildren();
    for (const e of deskEntries) {
      const row = deriveDeskRow(e.outcome, e.evidence, e.custody);
      const card = document.createElement('div');
      card.className = `desk-row ${row.isIncident ? 'incident' : ''}`.trim();
      const name = document.createElement('p');
      name.className = 'desk-pkg-name';
      name.textContent = e.label;
      card.appendChild(name);
      // The STRUCTURED reason — its human ref is a register-tagged catalog key.
      const reason = document.createElement('p');
      reason.className = 'desk-reason';
      reason.textContent = `${t('console.desk_reason_label')} : ${t(row.humanReasonRef)}`;
      card.appendChild(reason);
      // The ONE applied outcome — always one of the four (a generic « échec » is not a value).
      const outcome = document.createElement('p');
      outcome.className = 'desk-outcome';
      outcome.textContent = `${t('console.desk_outcome_label')} : ${t(`console.family_${row.family}`)}`;
      card.appendChild(outcome);
      // Custody stays legible — never unowned (SE-I10).
      const custody = document.createElement('p');
      custody.className = 'desk-custody';
      custody.textContent = `${t('console.board_custody')} : ${custodianLabel(row.currentCustodian)}`;
      card.appendChild(custody);
      if (row.hasEvidence) {
        const ev = document.createElement('p');
        ev.className = 'desk-evidence';
        ev.textContent = t('console.desk_evidence_present');
        card.appendChild(ev);
      }
      if (row.isIncident) {
        const note = document.createElement('p');
        note.className = 'desk-incident-note';
        note.textContent = t('console.desk_incident_note');
        card.appendChild(note);
      }
      deskSection.appendChild(card);
    }
    // The desk's standing reassurance — a package is never left without a keeper.
    const never = document.createElement('p');
    never.className = 'desk-never-unowned';
    never.textContent = t('console.desk_never_unowned');
    deskSection.appendChild(never);
  };
  renderDesk();
  const deskDemo = document.createElement('section');
  deskDemo.className = 'sos-demo-controls';
  const deskRoutineBtn = document.createElement('button');
  deskRoutineBtn.className = 'desk-demo-routine';
  deskRoutineBtn.textContent = t('console.desk_demo_routine');
  deskRoutineBtn.addEventListener('click', () => {
    deskEntries = SANDBOX_DESK_ROUTINE;
    renderDesk();
  });
  const deskIncidentBtn = document.createElement('button');
  deskIncidentBtn.className = 'desk-demo-incident';
  deskIncidentBtn.textContent = t('console.desk_demo_incident');
  deskIncidentBtn.addEventListener('click', () => {
    deskEntries = SANDBOX_DESK_WITH_INCIDENT;
    renderDesk();
  });
  deskDemo.append(deskRoutineBtn, deskIncidentBtn);
  main.append(deskHeading, deskSection, deskDemo);

  // WO-6.9-e — the BREAK-GLASS honest shell (D5, PART 8 §5, the maker-checker
  // seam). The dispatcher's surface: the HandoffAuthorization state machine
  // RENDERED READ-ONLY (provider-confirm + issuance honestly « en attente »,
  // E3-gated — no UI pretends the network confirmed), the dispatcher's GROUND-
  // verification capture ONLY, and an explicit note that ISSUING is the payment
  // operator's, NOT here (« nobody holds both halves »). The fourth secret
  // (signature) and every franc are structurally absent from the view; NO issuing
  // lever exists (proven in test/break-glass.test.ts). The one lever is the
  // dispatcher's ground half — it never advances the authorization.
  const bgHeading = document.createElement('h2');
  bgHeading.textContent = t('console.bg_heading');
  const bgSection = document.createElement('section');
  bgSection.className = 'break-glass';
  let bgGroundVerified = false;
  const renderBreakGlass = () => {
    bgSection.replaceChildren();
    const board = deriveBreakGlassBoard(SANDBOX_BREAK_GLASS, bgGroundVerified);
    const rider = document.createElement('p');
    rider.className = 'bg-rider';
    rider.textContent = SANDBOX_BREAK_GLASS_RIDER;
    bgSection.appendChild(rider);
    const meta = document.createElement('p');
    meta.className = 'bg-meta';
    meta.textContent = `${t('console.bg_source_label')} : ${t('console.bg_source_break_glass')} · ${t('console.bg_case_label')} : ${board.caseId}`;
    bgSection.appendChild(meta);
    const reason = document.createElement('p');
    reason.className = 'bg-reason';
    reason.textContent = `${t('console.bg_reason_label')} : ${t(board.reasonRef)}`;
    bgSection.appendChild(reason);
    // The HandoffAuthorization state machine — READ-ONLY. Later steps render
    // « en attente »: provider-confirm and issuance are not the console's to reach.
    const steps = document.createElement('div');
    steps.className = 'bg-steps';
    for (const step of board.steps) {
      const row = document.createElement('p');
      row.className = `bg-step ${step.status}`;
      const mark = step.status === 'done' ? '✓ ' : step.status === 'current' ? '→ ' : '· ';
      const suffix = step.status === 'pending' ? ` — ${t('console.bg_pending')}` : '';
      row.textContent = `${mark}${t(`console.bg_state_${step.state}`)}${suffix}`;
      steps.appendChild(row);
    }
    bgSection.appendChild(steps);
    // The dispatcher's GROUND half — captured locally; it never advances the state.
    if (board.groundVerified) {
      const done = document.createElement('p');
      done.className = 'bg-ground-done';
      done.textContent = t('console.bg_ground_done');
      bgSection.appendChild(done);
    }
    // Maker-checker, stated plainly: issuing is the operator's, never here.
    const mc = document.createElement('p');
    mc.className = 'bg-maker-checker';
    mc.textContent = t('console.bg_maker_checker');
    bgSection.appendChild(mc);
  };
  renderBreakGlass();
  // The ONLY lever here is the dispatcher's GROUND verification — there is NO
  // issuing lever (issuing is the payment operator's, in the platform ops surface).
  const bgControls = document.createElement('section');
  bgControls.className = 'sos-demo-controls';
  const bgGroundBtn = document.createElement('button');
  bgGroundBtn.className = 'bg-ground';
  bgGroundBtn.textContent = t('console.bg_ground_action');
  bgGroundBtn.addEventListener('click', () => {
    bgGroundVerified = true;
    renderBreakGlass();
    bgGroundBtn.hidden = true;
  });
  bgControls.append(bgGroundBtn);
  main.append(bgHeading, bgSection, bgControls);

  // WO-2.2 — follow-up: dwell surfaced (D20: recorded and shown, never
  // enforced) + the delivery-outcome timeline on the canonical families.
  const followHeading = document.createElement('h2');
  followHeading.textContent = t('console.followup');
  const followCard = document.createElement('section');
  followCard.className = 'follow-card';
  const dwellLine = document.createElement('p');
  dwellLine.className = 'status-line';
  dwellLine.textContent = `${t('console.dwell_label')} : ${SANDBOX_DWELL.dwellSec} s — ${t(SANDBOX_DWELL.withinTarget ? 'console.dwell_in_target' : 'console.dwell_out_target')}`;
  followCard.appendChild(dwellLine);
  // WO-2.7 item 2 — the door-payment line is SIGNAL-DRIVEN: « Confirmé par le
  // réseau » renders ONLY once the provider-class signal has been consumed.
  const doorFollower = new DoorSignalFollower();
  const doorLine = document.createElement('p');
  doorLine.className = 'status-line door-line';
  const doorDemo = document.createElement('button');
  doorDemo.className = 'door-demo';
  doorDemo.textContent = t('console.door_demo');
  const renderDoorLine = () => {
    const confirmed = doorFollower.isConfirmed(SANDBOX_DOOR_ORDER);
    doorLine.textContent = `${t('console.door_label')} : ${t(confirmed ? 'console.door_confirmed' : 'console.door_pending')}`;
    doorDemo.hidden = confirmed;
  };
  doorDemo.addEventListener('click', () => {
    doorFollower.consume(SANDBOX_DOOR_PAID_SIGNAL);
    renderDoorLine();
  });
  renderDoorLine();
  followCard.appendChild(doorLine);
  followCard.appendChild(doorDemo);
  const outcomeHeading = document.createElement('p');
  outcomeHeading.className = 'rider-label';
  outcomeHeading.textContent = t('console.outcome_heading');
  followCard.appendChild(outcomeHeading);
  for (const outcome of SANDBOX_OUTCOMES) {
    const row = document.createElement('p');
    row.className = 'status-line';
    row.textContent = `${outcome.at} · ${t(`console.family_${outcome.family}`)} · ${t(`console.reason_${outcome.reason}`)}`;
    followCard.appendChild(row);
  }
  main.append(followHeading, followCard);

  // WO-6.3 — sandbox « (aperçu) » levers that raise the demo SOS incident into
  // the alert at the top (never faked as a live safety stream), mirroring the
  // door « Essai » path: one raises the in-hours incident (dispatcher answers),
  // one raises the queued/offline variant (ack DISABLED — not yet arrived).
  const sosDemo = document.createElement('section');
  sosDemo.className = 'sos-demo-controls';
  const raiseBtn = document.createElement('button');
  raiseBtn.className = 'sos-raise';
  raiseBtn.textContent = t('console.sos_demo_raise');
  raiseBtn.addEventListener('click', () => {
    currentIncident = SANDBOX_INCIDENT_RAISED;
    renderIncident();
  });
  const raiseQueuedBtn = document.createElement('button');
  raiseQueuedBtn.className = 'sos-raise-queued';
  raiseQueuedBtn.textContent = t('console.sos_demo_raise_queued');
  raiseQueuedBtn.addEventListener('click', () => {
    currentIncident = SANDBOX_INCIDENT_QUEUED;
    renderIncident();
  });
  sosDemo.append(raiseBtn, raiseQueuedBtn);
  main.append(sosDemo);

  // WO-6.9-e — D6 drill status: the SOS raise→ack path above IS the drill
  // mechanism (WO-6.3, verified present). This line is HONEST about the pre-pilot
  // drill — « à faire avant le pilote » — never a fake « réussi ». A live SOS +
  // dispatcher-response drill must PASS before the pilot (PART 8 §6).
  const drillStatus = document.createElement('p');
  drillStatus.className = 'drill-status';
  drillStatus.textContent = t('console.drill_status');
  main.append(drillStatus);

  /* ─────────────────── SE-LIVE-4e — THE RIDER CODE DESK ────────────────────
   *
   * FOUNDER ORDER (2026-08-08): « build the rider code screen in the dispatch
   * console. » He could not sign into the rider app — it asks for a code, and
   * no screen anywhere could mint one. The routes had existed since SE-LIVE-1
   * with no surface; the only way in was a curl carrying the ops secret.
   *
   * ONE OF THE TWO LIVE SECTIONS IN THIS CONSOLE (with « Courses du
   * tableau » above it); everything higher is sandbox. This
   * talks to the real logistics Worker, so it is gated behind the founder's own
   * key and every state it can be in is designed: not-configured, key-asked,
   * key-refused, loading, failed, empty, list.
   *
   * ⚠ THE KEY LIVES IN THIS VARIABLE AND NOWHERE ELSE — no localStorage, no
   * URL, no log. It opens the rider registry and the SOS board for every rider
   * in the system, and this console runs on his own machine, so retyping it
   * after a reload costs one line and buys a secret that is never written down.
   */
  const codesHeading = document.createElement('h2');
  codesHeading.textContent = t('codes.section');
  const codesSection = document.createElement('section');
  codesSection.className = 'desk codes-desk';

  let opsKey: string | null = null;
  let codesRead: CodesRead = { kind: 'loading' };
  let codesUi: CodesUi = CODES_IDLE;
  let notice: string | null = null;

  const port = () => resolveRiderCodes(opsKey ?? '');

  const refreshCodes = async (): Promise<void> => {
    if (opsKey === null) return;
    codesRead = { kind: 'loading' };
    renderCodes();
    const answer = await port().list();
    codesRead =
      answer.kind === 'ok'
        ? { kind: 'ok', riders: answer.value }
        : answer.kind === 'bad_key'
          ? { kind: 'bad_key' }
          : { kind: 'failed' };
    renderCodes();
  };

  const line = (cls: string, text: string): HTMLParagraphElement => {
    const p = document.createElement('p');
    p.className = cls;
    p.textContent = text;
    return p;
  };

  const field = (cls: string, placeholder: string): HTMLInputElement => {
    const input = document.createElement('input');
    input.className = cls;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
    return input;
  };

  /** One act, through the reducer, so a second tap can never start a second. */
  const runAct = async (
    act: 'mint' | `revoke:${string}`,
    riderId: string,
    call: () => Promise<{ ok: boolean; code?: string | undefined; badKey?: boolean }>,
  ): Promise<void> => {
    const refusal = refuseAct(codesUi);
    if (refusal !== null) {
      notice = t(refusal);
      renderCodes();
      return;
    }
    const started = actStart(codesUi, act);
    if (started === null) return;
    codesUi = started;
    notice = null;
    renderCodes();
    const answer = await call();
    if (answer.badKey === true) {
      codesUi = CODES_IDLE;
      codesRead = { kind: 'bad_key' };
      renderCodes();
      return;
    }
    codesUi = actSettled(codesUi, act, answer.ok ? { ok: true, riderId, ...(answer.code !== undefined ? { code: answer.code } : {}) } : { ok: false });
    renderCodes();
    // The roster only reflects the server AFTER the server answered.
    if (answer.ok) await refreshCodes();
  };

  function renderCodes(): void {
    codesSection.replaceChildren();

    // Not configured — an honest state, never an empty desk that reads as
    // « no riders yet ».
    if (logisticsBase() === '') {
      codesSection.append(
        line('codes-state', t('codes.pas_relie')),
        line('codes-hint', t('codes.pas_relie_aide')),
      );
      return;
    }

    // The key door. One sentence about where the key goes, then the field.
    if (opsKey === null) {
      codesSection.append(line('codes-state', t('codes.cle_titre')), line('codes-hint', t('codes.cle_aide')));
      const input = field('codes-key', t('codes.cle_placeholder'));
      input.type = 'password';
      const open = document.createElement('button');
      open.className = 'codes-key-open';
      open.textContent = t('codes.cle_entrer');
      const enter = () => {
        const typed = input.value.trim();
        if (typed === '') return;
        opsKey = typed;
        input.value = '';
        void refreshCodes();
        // ONE key door for the whole live half of this console — the courses
        // desk below opens on the same key, so it reads the board now rather
        // than sitting on « entrez la clé » next to an open codes desk.
        void refreshCourses();
        // REPROGRAMMATION-1 — and the next-passage desk, on the same key.
        void refreshReprog();
        // MANIFESTE-1 — and the riders' manifests.
        void refreshManifestes();
        // FLOTTE-1 — and the fleet book.
        void refreshFlotte();
      };
      open.addEventListener('click', enter);
      input.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') enter();
      });
      codesSection.append(input, open);
      return;
    }

    // ⚠ A REFUSED KEY ESCALATES THE WHOLE DESK — one door, one sentence. A
    // « failed » table here would send him looking at the service instead of
    // his key.
    if (codesRead.kind === 'bad_key') {
      codesSection.append(
        line('codes-state', t('codes.cle_refusee')),
        line('codes-hint', t('codes.cle_refusee_aide')),
      );
      const again = document.createElement('button');
      again.className = 'codes-key-reset';
      again.textContent = t('codes.cle_entrer');
      again.addEventListener('click', () => {
        opsKey = null;
        codesRead = { kind: 'loading' };
        renderCodes();
        // Same one door: dropping the key closes the courses desk too, rather
        // than leaving a board on screen that no key can act on any more.
        coursesRead = { kind: 'loading' };
        renderCourses();
        reprogRead = { kind: 'loading' };
        renderReprog();
        manifesteRead = { kind: 'loading' };
        renderManifestes();
        flotteRead = { kind: 'loading' };
        renderFlotte();
      });
      codesSection.appendChild(again);
      return;
    }

    codesSection.appendChild(line('codes-hint', t('codes.intro')));

    // ⚠ THE ONE-TIME CODE, AND IT BLOCKS EVERYTHING. The plaintext exists
    // nowhere else — the server hands it over once and never again.
    if (codesUi.nouveau !== null) {
      const card = document.createElement('div');
      card.className = 'codes-nouveau';
      card.append(
        line('codes-nouveau-title', t('codes.nouveau_titre')),
        line('codes-nouveau-who', codesUi.nouveau.riderId),
        line('codes-nouveau-code', codesUi.nouveau.code),
        line('codes-hint', t('codes.nouveau_aide')),
      );
      const noted = document.createElement('button');
      noted.className = 'codes-noted';
      noted.textContent = t('codes.note');
      noted.addEventListener('click', () => {
        codesUi = dismissCode(codesUi);
        notice = null;
        renderCodes();
      });
      card.appendChild(noted);
      codesSection.appendChild(card);
    }

    if (notice !== null) codesSection.appendChild(line('codes-notice', notice));
    if (codesUi.echec !== null) codesSection.appendChild(line('codes-notice', t('codes.acte_echoue')));

    const view = codesView(codesRead);
    if (view === null) return;
    if (view.kind !== 'liste') {
      codesSection.appendChild(line('codes-state', t(view.message)));
      if (view.kind === 'failed') codesSection.appendChild(line('codes-hint', t('codes.echec_aide')));
      if (view.kind === 'empty') codesSection.appendChild(line('codes-hint', t('codes.vide_aide')));
    } else {
      for (const r of view.riders) {
        const row = document.createElement('div');
        row.className = 'codes-row';
        row.append(
          line('codes-row-who', r.displayName),
          line('codes-row-id', r.riderId),
          line(
            r.hasCode ? 'codes-row-has' : 'codes-row-none',
            r.hasCode
              ? `${t('codes.a_un_code')}${r.mintedAt !== undefined ? ` · ${t('codes.depuis')} ${r.mintedAt.slice(0, 10)}` : ''}`
              : t('codes.pas_de_code'),
          ),
        );
        const give = document.createElement('button');
        give.className = 'codes-give';
        give.textContent = t('codes.donner');
        give.disabled = codesUi.busy !== null || codesUi.nouveau !== null;
        give.addEventListener('click', () => {
          void runAct('mint', r.riderId, async () => {
            const a = await port().mint(r.riderId);
            return { ok: a.kind === 'ok', code: a.kind === 'ok' ? a.value : undefined, badKey: a.kind === 'bad_key' };
          });
        });
        row.appendChild(give);
        if (r.hasCode) {
          const take = document.createElement('button');
          take.className = 'codes-revoke';
          take.textContent = t('codes.retirer');
          take.disabled = codesUi.busy !== null || codesUi.nouveau !== null;
          take.addEventListener('click', () => {
            void runAct(`revoke:${r.riderId}`, r.riderId, async () => {
              const a = await port().revoke(r.riderId);
              return { ok: a.kind === 'ok', badKey: a.kind === 'bad_key' };
            });
          });
          row.appendChild(take);
        }
        codesSection.appendChild(row);
      }
    }

    // ── register a new rider ────────────────────────────────────────────────
    const form = document.createElement('div');
    form.className = 'codes-form';
    form.appendChild(line('codes-form-title', t('codes.inscrire_titre')));
    const idField = field('codes-new-id', t('codes.champ_id'));
    const nameField = field('codes-new-name', t('codes.champ_nom'));
    const phoneField = field('codes-new-phone', t('codes.champ_tel'));
    const avisLine = line('codes-avis', '');
    // The warning follows what he types, BEFORE he taps — « this rider already
    // has a code and the new one kills it now » is a fact he needs first.
    const showAvis = () => {
      const typed = idField.value.trim();
      const riders = codesRead.kind === 'ok' ? codesRead.riders : [];
      avisLine.textContent = typed === '' ? '' : t(mintAvisKey(mintAvis(riders, typed)));
    };
    idField.addEventListener('input', showAvis);
    const add = document.createElement('button');
    add.className = 'codes-register';
    add.textContent = t('codes.inscrire');
    add.disabled = codesUi.busy !== null || codesUi.nouveau !== null;
    add.addEventListener('click', () => {
      const riderId = idField.value.trim();
      const displayName = nameField.value.trim();
      const phoneAlias = phoneField.value.trim();
      if (riderId === '' || displayName === '' || phoneAlias === '') return;
      void runAct('mint', riderId, async () => {
        const reg = await port().register({ riderId, displayName, phoneAlias });
        if (reg.kind === 'bad_key') return { ok: false, badKey: true };
        // `already_registered` is not a failure to mint — fall through and give
        // the existing rider a code, which is what he came here to do.
        if (reg.kind === 'unreachable') return { ok: false };
        const a = await port().mint(riderId);
        return { ok: a.kind === 'ok', code: a.kind === 'ok' ? a.value : undefined, badKey: a.kind === 'bad_key' };
      });
    });
    form.append(idField, nameField, phoneField, avisLine, add);
    codesSection.appendChild(form);
  }

  renderCodes();

  /* ───────────── PURGE-ESSAI — LES COURSES DU TABLEAU (live) ─────────────
   *
   * FOUNDER RULING (2026-08-10): « remove all of them … cause i want to use
   * new products again », and for Séra « BOARD YES, CUSTODY NO ». This is the
   * second live section in this console: it reads the REAL `/ops/board` and
   * lets him retire one test course at a time, on the same ops key as the
   * codes desk above.
   *
   * THE DESTRUCTIVE DISCIPLINE, stated where the buttons are: retiring is
   * NEVER the primary action here — the levers are the whispering secondary
   * grammar. Nothing is removed without a confirmation that NAMES what leaves
   * and says, in words, that the custody proof is untouched. « Tout retirer »
   * is a LOOP IN THIS SCREEN over the rows he can see, one call per order, and
   * a course that refuses is named (« cette course n'a pas pu être retirée »)
   * instead of being skipped in silence. The board is RE-READ at the end — the
   * desk never claims a removal it has not seen for itself.
   */
  const coursesHeading = document.createElement('h2');
  coursesHeading.textContent = t('courses.section');
  const coursesSection = document.createElement('section');
  coursesSection.className = 'courses-desk';

  let coursesRead: CoursesRead = { kind: 'loading' };
  let retrait: RetraitUi = RETRAIT_IDLE;

  const coursesPort = () => resolveCourses(opsKey ?? '');

  async function refreshCourses(): Promise<void> {
    if (opsKey === null) {
      renderCourses();
      return;
    }
    coursesRead = { kind: 'loading' };
    renderCourses();
    const answer = await coursesPort().board();
    coursesRead =
      answer.kind === 'ok'
        ? { kind: 'ok', courses: answer.value }
        : answer.kind === 'bad_key'
          ? { kind: 'bad_key' }
          : { kind: 'failed' };
    renderCourses();
  }

  /** The sweep: ONE door call per order, in turn. A refused course is recorded
   *  and the run carries on — losing the whole sweep to one refusal would hide
   *  the ones that did leave. */
  async function lancerRetrait(): Promise<void> {
    const started = commencer(retrait);
    if (started === null) return;
    retrait = started.ui;
    renderCourses();
    for (const orderId of started.orderIds) {
      const answer = await coursesPort().retirer(orderId);
      retrait = avancer(retrait, orderId, answer.kind === 'ok');
      renderCourses();
      // A refused key ends the run: every remaining call would refuse too, and
      // marking them all « échoué » would blame the courses for the door.
      if (answer.kind === 'bad_key') {
        retrait = terminer(retrait);
        coursesRead = { kind: 'bad_key' };
        renderCourses();
        return;
      }
    }
    retrait = terminer(retrait);
    await refreshCourses();
  }

  function renderCourses(): void {
    coursesSection.replaceChildren();

    if (logisticsBase() === '') {
      coursesSection.append(
        line('courses-state', t('codes.pas_relie')),
        line('courses-hint', t('courses.pas_relie_aide')),
      );
      return;
    }
    if (opsKey === null) {
      coursesSection.appendChild(line('courses-state', t('courses.cle_dabord')));
      return;
    }
    if (coursesRead.kind === 'bad_key') {
      coursesSection.append(
        line('courses-state', t('codes.cle_refusee')),
        line('courses-hint', t('codes.cle_refusee_aide')),
      );
      return;
    }

    coursesSection.appendChild(line('courses-hint', t('courses.intro')));

    // THE CONFIRMATION, and while it is on screen it is the only thing that
    // can act: the row levers below render disabled, so a second tap on the
    // course he is already being asked about cannot start a second removal.
    const demande = retrait.demande;
    if (demande !== null) {
      const card = document.createElement('div');
      card.className = 'courses-confirme';
      card.append(
        line('courses-confirme-titre', t(demandeKey(demande))),
        // WHAT will leave, NAMED — every order, spelled out. A bare count
        // ( « 3 courses » ) would ask him to confirm a number; he confirms
        // commandes, and he must be able to recognise them.
        line('courses-confirme-ligne', demande.orderIds.join(' · ')),
        line('courses-confirme-ligne', t('courses.confirmer_detail')),
        // The custody sentence is not decoration: « board yes, custody no » is
        // the founder's own ruling, and he reads it before every removal.
        line('courses-confirme-ligne', t('courses.confirmer_garde')),
      );
      const oui = document.createElement('button');
      oui.className = 'courses-confirmer';
      oui.textContent = t('courses.confirmer');
      oui.addEventListener('click', () => {
        void lancerRetrait();
      });
      const non = document.createElement('button');
      non.className = 'courses-annuler';
      non.textContent = t('courses.annuler');
      non.addEventListener('click', () => {
        retrait = annuler(retrait);
        renderCourses();
      });
      card.append(oui, non);
      coursesSection.appendChild(card);
    }

    // The honest in-flight line — « 2 sur 5 », never a spinner that says
    // nothing about how far a destructive sweep has gone.
    const encours = retrait.encours;
    if (encours !== null) {
      coursesSection.appendChild(
        line('courses-state', `${t('courses.en_cours')} — ${encours.faits} ${t('courses.sur')} ${encours.total}`),
      );
    }

    const view = coursesView(coursesRead);
    if (view === null) return;
    if (view.kind !== 'liste') {
      coursesSection.appendChild(line('courses-state', t(view.message)));
      if (view.kind === 'failed') coursesSection.appendChild(line('courses-hint', t('courses.echec_aide')));
      if (view.kind === 'empty') coursesSection.appendChild(line('courses-hint', t('courses.vide_aide')));
    } else {
      const bloque = enVol(retrait) || retrait.demande !== null;
      for (const course of view.courses) {
        const row = document.createElement('div');
        row.className = 'courses-row';
        const etat =
          course.riderName === undefined
            ? t(etatKey(course))
            : `${t(etatKey(course))} ${course.riderName}`;
        row.append(line('courses-row-order', course.orderId), line('courses-row-etat', etat));
        // A course that did NOT leave says so on its own row — never a silent
        // skip, and never a whole-desk error that hides which one survived.
        if (aEchoue(retrait, course.orderId)) {
          row.appendChild(line('courses-notice', t('courses.ligne_echec')));
        }
        const retirer = document.createElement('button');
        retirer.className = 'courses-retirer';
        retirer.textContent = t('courses.retirer');
        retirer.disabled = bloque;
        retirer.addEventListener('click', () => {
          retrait = demander(retrait, { kind: 'une', orderIds: [course.orderId] });
          renderCourses();
        });
        row.appendChild(retirer);
        coursesSection.appendChild(row);
      }
      const actions = document.createElement('div');
      actions.className = 'courses-actions';
      const tout = document.createElement('button');
      tout.className = 'courses-tout';
      tout.textContent = t('courses.tout_retirer');
      tout.disabled = bloque;
      tout.addEventListener('click', () => {
        retrait = demander(retrait, { kind: 'toutes', orderIds: view.courses.map((c) => c.orderId) });
        renderCourses();
      });
      actions.appendChild(tout);
      coursesSection.appendChild(actions);
    }

    // Always a way to ask the board again — after a failed read, and after a
    // sweep, the truth is one tap away rather than a page reload.
    const relire = document.createElement('button');
    relire.className = 'courses-relire';
    relire.textContent = t('courses.relire');
    relire.disabled = enVol(retrait);
    relire.addEventListener('click', () => {
      void refreshCourses();
    });
    coursesSection.appendChild(relire);
  }

  renderCourses();

  /* ───────── REPROGRAMMATION-1 — LE PROCHAIN PASSAGE À FIXER (live) ─────────
   *
   * SE6.1 live (Sera-Build-Spec §6.5: « dispatcher applies retry / reschedule /
   * return / incident; custody stays with courier »). A buyer was absent, or
   * the place could not be found, or the payment provider was down: custody
   * recorded a `reschedule`, the rider KEEPS the package, and the course
   * arrives here over the seventh wire. The founder fixes ONE window — a day,
   * a start, an end — and the same course moves onto its follow-up task; the
   * rider's phone then says « 2e passage » with that window.
   *
   * This is LIVE WORK, not administration: a rider is holding a package for
   * it. So the section sits ABOVE the two administrative desks, and its one
   * lever is a primary action. The list is the BOARD's own truth: a fixed
   * passage leaves the list on the re-read, never on the response, and the
   * report of what was fixed stays on screen — as the retire desk keeps its
   * failures — until he reloads.
   */
  /**
   * ═══ MANIFESTE-1 — THE RIDERS' MANIFESTS AND THE END-OF-SERVICE EXCEPTION ═══
   *
   * SE-I03 (« at most one active RouteManifest and one current stop ») made
   * visible: one row per rider with a course or a package, the ONE current
   * stop as logistics derives it from its book and custody's own word, and
   * the packages the ledger places with him. SE3.2's lever: a rider carrying
   * a package cannot end his service until the founder authorizes it here,
   * naming where the package goes next — one confirmation card at a time,
   * nothing leaves the desk before « Le colis revient à la base Séra » or
   * « Un autre coursier reprend le colis ».
   */
  const manifesteHeading = document.createElement('h2');
  manifesteHeading.textContent = t('manifeste.titre');
  const manifesteSection = document.createElement('section');
  manifesteSection.className = 'manifeste-desk';

  type ManifesteRead = { kind: 'loading' } | { kind: 'ok'; rows: readonly ManifesteRow[] } | { kind: 'bad_key' } | { kind: 'failed' };
  let manifesteRead: ManifesteRead = { kind: 'loading' };
  let finService: FinServiceUi = FIN_SERVICE_IDLE;
  // The courier typed on the open card — kept across the desk's re-renders
  // (a refusal redraws the card), cleared when the card closes.
  let coursierReprise = '';

  async function refreshManifestes(): Promise<void> {
    if (opsKey === null) {
      renderManifestes();
      return;
    }
    manifesteRead = { kind: 'loading' };
    renderManifestes();
    const answer = await coursesPort().manifestes();
    manifesteRead =
      answer.kind === 'ok' ? { kind: 'ok', rows: answer.value } : answer.kind === 'bad_key' ? { kind: 'bad_key' } : { kind: 'failed' };
    renderManifestes();
  }

  /** ONE call on the founder's confirmed word, then the board's own re-read. */
  async function autoriserFin(riderId: string, nextOwner: NextOwner): Promise<void> {
    const started = commencerFin(finService, riderId);
    if (started === null) return;
    finService = started.ui;
    renderManifestes();
    const answer = await coursesPort().autoriserFinDeService(riderId, nextOwner, started.commandId);
    if (answer.kind === 'bad_key') {
      finService = finEchouee(finService, riderId, 'codes.cle_refusee');
      manifesteRead = { kind: 'bad_key' };
      renderManifestes();
      return;
    }
    if (answer.kind !== 'ok') {
      finService = finEchouee(finService, riderId, answer.kind === 'refused' ? finRefusKey(answer.reason) : 'fin_service.echec');
      renderManifestes();
      return;
    }
    finService = finFaite(finService, riderId);
    coursierReprise = '';
    await refreshManifestes();
  }

  function leverFin(row: HTMLDivElement, m: ManifesteRow): void {
    const occupe = finService.encours !== null;
    if (finService.demande?.riderId === m.riderId) {
      const card = document.createElement('div');
      card.className = 'reprog-renvoi-card fin-service-card';
      card.append(
        line('reprog-renvoi-titre', t('fin_service.question')),
        line('reprog-renvoi-ligne', m.riderName),
        line('reprog-renvoi-ligne', t('fin_service.aide')),
      );
      // The base has no task of its own yet (the hub road is the next slice):
      // its reference is the packages themselves. A hand-off names WHO.
      const ref = m.packageIds.join(',');
      const base = document.createElement('button');
      base.className = 'reprog-renvoi-confirmer fin-service-base';
      base.textContent = t('fin_service.base');
      base.disabled = occupe;
      base.addEventListener('click', () => {
        void autoriserFin(m.riderId, { kind: 'return_to_hub_task', ref });
      });
      const qui = document.createElement('input');
      qui.className = 'reprog-champ fin-service-coursier';
      qui.type = 'text';
      qui.placeholder = t('fin_service.coursier_qui');
      qui.value = coursierReprise;
      qui.disabled = occupe;
      qui.addEventListener('input', () => {
        coursierReprise = qui.value;
      });
      const autre = document.createElement('button');
      autre.className = 'reprog-renvoi-confirmer fin-service-autre';
      autre.textContent = t('fin_service.autre_coursier');
      autre.disabled = occupe;
      autre.addEventListener('click', () => {
        const reprend = refReprise(coursierReprise);
        if (reprend === null) {
          // Nobody named: refused HERE, nothing sent — the card stays.
          finService = finEchouee(finService, m.riderId, 'fin_service.coursier_manquant');
          renderManifestes();
          return;
        }
        void autoriserFin(m.riderId, { kind: 'reassignment', ref: reprend });
      });
      const non = document.createElement('button');
      non.className = 'reprog-renvoi-annuler fin-service-annuler';
      non.textContent = t('fin_service.annuler');
      non.addEventListener('click', () => {
        coursierReprise = '';
        finService = annulerFin(finService);
        renderManifestes();
      });
      card.append(base, qui, autre, non);
      row.appendChild(card);
      const echec = finService.echecs[m.riderId];
      if (echec !== undefined) row.appendChild(line('reprog-notice', t(echec)));
      return;
    }
    const lever = document.createElement('button');
    lever.className = 'reprog-renvoyer fin-service-lever';
    lever.textContent = t(finService.encours === m.riderId ? 'reprog.en_cours' : 'fin_service.autoriser');
    lever.disabled = occupe;
    lever.addEventListener('click', () => {
      finService = demanderFin(finService, m.riderId, finServiceCommandId(m.riderId));
      renderManifestes();
    });
    row.appendChild(lever);
    const echec = finService.echecs[m.riderId];
    if (echec !== undefined) row.appendChild(line('reprog-notice', t(echec)));
  }

  function renderManifestes(): void {
    manifesteSection.replaceChildren();
    if (logisticsBase() === '') {
      manifesteSection.append(line('reprog-state', t('codes.pas_relie')), line('reprog-hint', t('reprog.pas_relie_aide')));
      return;
    }
    if (opsKey === null) {
      manifesteSection.appendChild(line('reprog-state', t('reprog.cle_dabord')));
      return;
    }
    if (manifesteRead.kind === 'bad_key') {
      manifesteSection.append(line('reprog-state', t('codes.cle_refusee')), line('reprog-hint', t('codes.cle_refusee_aide')));
      return;
    }
    manifesteSection.appendChild(line('reprog-hint', t('manifeste.intro')));
    const names = new Map<string, string>();
    if (manifesteRead.kind === 'ok') for (const r of manifesteRead.rows) names.set(r.riderId, r.riderName);
    for (const riderId of finService.faits) {
      manifesteSection.appendChild(line('reprog-fait', `${names.get(riderId) ?? riderId} — ${t('fin_service.fait')}`));
    }
    if (manifesteRead.kind === 'loading') {
      manifesteSection.appendChild(line('reprog-state', t('manifeste.lecture')));
      return;
    }
    if (manifesteRead.kind === 'failed') {
      manifesteSection.append(line('reprog-state', t('manifeste.echec')), line('reprog-hint', t('reprog.echec_aide')));
    } else if (manifesteRead.rows.length === 0) {
      manifesteSection.appendChild(line('reprog-state', t('manifeste.vide')));
    } else {
      for (const m of manifesteRead.rows) {
        const row = document.createElement('div');
        row.className = 'reprog-row manifeste-row';
        row.appendChild(line('reprog-row-order', m.riderName));
        if (m.currentStop !== null) {
          row.appendChild(line('reprog-row-etat', `${t('manifeste.etape')} : ${t(etapeManifesteKey(m.currentStop.kind))} · ${m.currentStop.orderId}`));
        } else if (m.packageIds.length > 0) {
          row.appendChild(line('reprog-notice', t('manifeste.sans_course')));
        }
        if (m.packageIds.length > 0) row.appendChild(line('reprog-row-depuis', `${m.packageIds.length} ${t('manifeste.colis_garde')}`));
        if (m.lectureInconnue) row.appendChild(line('reprog-notice', t('manifeste.lecture_inconnue')));
        if (m.finDeService !== null) {
          row.appendChild(line('reprog-fait', `${t('fin_service.en_attente')} · ${t(nextOwnerKey(m.finDeService.nextOwner))}`));
        } else if (m.packageIds.length > 0) {
          leverFin(row, m);
        }
        manifesteSection.appendChild(row);
      }
    }
    const relire = document.createElement('button');
    relire.className = 'reprog-relire manifeste-relire';
    relire.textContent = t('reprog.relire');
    relire.disabled = finService.encours !== null;
    relire.addEventListener('click', () => {
      void refreshManifestes();
    });
    manifesteSection.appendChild(relire);
  }

  renderManifestes();

  const reprogHeading = document.createElement('h2');
  reprogHeading.textContent = t('reprog.section');
  const reprogSection = document.createElement('section');
  reprogSection.className = 'reprog-desk';

  let reprogRead: ReprogRead = { kind: 'loading' };
  let fixation: FixationUi = FIXATION_IDLE;
  let renvoi: RenvoiUi = RENVOI_IDLE;
  /** What he typed, per course — kept across renders so a refusal never
   *  wipes the day he chose. */
  const saisies = new Map<string, FenetreSaisie>();

  async function refreshReprog(): Promise<void> {
    if (opsKey === null) {
      renderReprog();
      return;
    }
    reprogRead = { kind: 'loading' };
    renderReprog();
    // The two lists of this desk, off the board: a refused key on either is
    // the one door sentence; a board that did not answer either is « failed ».
    const [attente, deuxiemes] = await Promise.all([coursesPort().reprogrammations(), coursesPort().deuxiemesPassages()]);
    reprogRead =
      attente.kind === 'ok' && deuxiemes.kind === 'ok'
        ? { kind: 'ok', rows: attente.value, deuxiemes: deuxiemes.value }
        : attente.kind === 'bad_key' || deuxiemes.kind === 'bad_key'
          ? { kind: 'bad_key' }
          : { kind: 'failed' };
    renderReprog();
  }

  /**
   * REPROGRAMMATION-2 — the package goes home, on the founder's confirmed
   * word: ONE call, then the board's own re-read (the course leaves both
   * lists because logistics says so, never because the desk assumed it).
   */
  async function renvoyerAuVendeur(orderId: string): Promise<void> {
    const started = commencerRenvoi(renvoi, orderId, () => renvoiCommandId(orderId));
    if (started === null) return;
    renvoi = started.ui;
    renderReprog();
    const answer = await coursesPort().renvoyer(orderId, started.commandId);
    if (answer.kind === 'bad_key') {
      renvoi = renvoiEchoue(renvoi, orderId, 'codes.cle_refusee');
      reprogRead = { kind: 'bad_key' };
      renderReprog();
      return;
    }
    if (answer.kind === 'ok') {
      renvoi = renvoiFait(renvoi, orderId, answer.value.decideAt);
      renderReprog();
      await refreshReprog();
      return;
    }
    renvoi = renvoiEchoue(renvoi, orderId, answer.kind === 'refused' ? renvoiRefusKey(answer.reason) : 'reprog.injoignable');
    renderReprog();
  }

  /** The lever home, on a row of either list; the confirmation card under it
   *  when he asked. While anything flies on this desk, the lever waits. */
  function leverRenvoi(row: HTMLDivElement, orderId: string): void {
    const occupe = fixation.enVol !== null || renvoi.enVol !== null;
    if (renvoi.demande === orderId) {
      const card = document.createElement('div');
      card.className = 'reprog-renvoi-card';
      card.append(
        line('reprog-renvoi-titre', t('reprog.renvoi_titre')),
        line('reprog-renvoi-ligne', orderId),
        // The money sentence is the decision's meaning, read before every act.
        line('reprog-renvoi-ligne', t('reprog.renvoi_confirm')),
      );
      const oui = document.createElement('button');
      oui.className = 'reprog-renvoi-confirmer';
      oui.textContent = t('reprog.renvoi_confirmer');
      // One act at a time on this desk: a fix in flight holds the return too.
      oui.disabled = occupe;
      oui.addEventListener('click', () => {
        void renvoyerAuVendeur(orderId);
      });
      const non = document.createElement('button');
      non.className = 'reprog-renvoi-annuler';
      non.textContent = t('courses.annuler');
      non.addEventListener('click', () => {
        renvoi = annulerRenvoi(renvoi);
        renderReprog();
      });
      card.append(oui, non);
      row.appendChild(card);
      return;
    }
    const lever = document.createElement('button');
    lever.className = 'reprog-renvoyer';
    lever.textContent = t(renvoi.enVol === orderId ? 'reprog.en_cours' : 'reprog.renvoyer');
    lever.disabled = occupe;
    lever.addEventListener('click', () => {
      renvoi = demanderRenvoi(renvoi, orderId);
      renderReprog();
    });
    row.appendChild(lever);
    const echec = renvoi.echecs[orderId];
    if (echec !== undefined) row.appendChild(line('reprog-notice', t(echec)));
  }

  /** One fix, through the reducer: the window is judged here first (the same
   *  three refusals the door has), then ONE call, then the board's own word. */
  async function fixerPassage(orderId: string): Promise<void> {
    const composee = composerFenetre(saisies.get(orderId) ?? { jour: '', debut: '', fin: '' }, new Date());
    if (!composee.ok) {
      fixation = fixationEchouee(fixation, orderId, saisieKey(composee.reason));
      renderReprog();
      return;
    }
    const started = commencerFixation(fixation, orderId, { start: composee.start, end: composee.end }, () => reprogCommandId(orderId));
    if (started === null) return;
    fixation = started.ui;
    renderReprog();
    const answer = await coursesPort().reprogrammer(orderId, { start: composee.start, end: composee.end }, started.commandId);
    if (answer.kind === 'bad_key') {
      // A refused key escalates the whole desk — one door, one sentence.
      fixation = fixationEchouee(fixation, orderId, 'codes.cle_refusee');
      reprogRead = { kind: 'bad_key' };
      renderReprog();
      return;
    }
    if (answer.kind === 'ok') {
      fixation = fixationFaite(fixation, orderId, { start: composee.start, end: composee.end });
      saisies.delete(orderId);
      renderReprog();
      // The board's own truth: the row leaves because logistics says so.
      await refreshReprog();
      return;
    }
    fixation = fixationEchouee(fixation, orderId, answer.kind === 'refused' ? refusKey(answer.reason) : 'reprog.injoignable');
    renderReprog();
  }

  function renderReprog(): void {
    reprogSection.replaceChildren();

    if (logisticsBase() === '') {
      reprogSection.append(line('reprog-state', t('codes.pas_relie')), line('reprog-hint', t('reprog.pas_relie_aide')));
      return;
    }
    if (opsKey === null) {
      reprogSection.appendChild(line('reprog-state', t('reprog.cle_dabord')));
      return;
    }
    if (reprogRead.kind === 'bad_key') {
      reprogSection.append(line('reprog-state', t('codes.cle_refusee')), line('reprog-hint', t('codes.cle_refusee_aide')));
      return;
    }

    reprogSection.appendChild(line('reprog-hint', t('reprog.intro')));

    // The report of what was fixed this session stays on screen, in his words.
    for (const [orderId, fenetre] of Object.entries(fixation.faits)) {
      reprogSection.appendChild(line('reprog-fait', `${orderId} — ${t('reprog.fait')} ${fenetreLisible(fenetre)}. ${t('reprog.fait_aide')}`));
    }
    for (const orderId of Object.keys(renvoi.faits)) {
      reprogSection.appendChild(line('reprog-fait', `${orderId} — ${t('reprog.renvoi_fait')}`));
    }

    const view = reprogView(reprogRead);
    if (view === null) return;
    if (view.kind !== 'liste') {
      reprogSection.appendChild(line('reprog-state', t(view.message)));
      if (view.kind === 'failed') reprogSection.appendChild(line('reprog-hint', t('reprog.echec_aide')));
      if (view.kind === 'empty') reprogSection.appendChild(line('reprog-hint', t('reprog.vide_aide')));
    } else {
      for (const course of view.rows) {
        const row = document.createElement('div');
        row.className = 'reprog-row';
        const etat = course.riderName === undefined
          ? t(raisonKey(course.reasonCode))
          : `${t(raisonKey(course.reasonCode))} · ${t('reprog.colis_avec')} ${course.riderName}`;
        row.append(line('reprog-row-order', course.orderId), line('reprog-row-etat', etat));
        const depuis = new Date(course.recordedAt);
        if (!Number.isNaN(depuis.getTime())) {
          row.appendChild(line('reprog-row-depuis', `${t('reprog.depuis')} ${depuis.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${hhmm(course.recordedAt)}`));
        }

        // The window: a day and two hours, in HIS local time. The typed values
        // survive a refusal and a re-render.
        const form = document.createElement('div');
        form.className = 'reprog-form';
        const saisie = saisies.get(course.orderId) ?? { jour: '', debut: '', fin: '' };
        const champ = (cle: 'jour' | 'debut' | 'fin', type: 'date' | 'time'): HTMLLabelElement => {
          const label = document.createElement('label');
          label.className = 'reprog-champ';
          label.append(t(`reprog.${cle}`));
          const input = document.createElement('input');
          input.type = type;
          input.value = saisie[cle];
          input.setAttribute('aria-label', t(`reprog.${cle}`));
          input.disabled = fixation.enVol !== null;
          input.addEventListener('input', () => {
            saisies.set(course.orderId, { ...(saisies.get(course.orderId) ?? { jour: '', debut: '', fin: '' }), [cle]: input.value });
          });
          label.appendChild(input);
          return label;
        };
        form.append(champ('jour', 'date'), champ('debut', 'time'), champ('fin', 'time'));
        const fixer = document.createElement('button');
        fixer.className = 'reprog-fixer';
        fixer.textContent = t(fixation.enVol === course.orderId ? 'reprog.en_cours' : 'reprog.fixer');
        fixer.disabled = fixation.enVol !== null || renvoi.enVol !== null;
        fixer.addEventListener('click', () => {
          void fixerPassage(course.orderId);
        });
        form.appendChild(fixer);
        row.appendChild(form);

        // A refused fix says why, on its own row — never a silent no-op.
        const echec = fixation.echecs[course.orderId];
        if (echec !== undefined) row.appendChild(line('reprog-notice', t(echec)));
        // The other decision, whispering under the fixer: home instead.
        leverRenvoi(row, course.orderId);
        reprogSection.appendChild(row);
      }
      // REPROGRAMMATION-2 — the courses already on their next passage: the
      // window he fixed, the rider by name, and the one lever home.
      for (const course of view.deuxiemes) {
        const row = document.createElement('div');
        row.className = 'reprog-row reprog-row-deuxieme';
        const etat = course.riderName === undefined
          ? t('reprog.deuxieme_etat')
          : `${t('reprog.deuxieme_etat')} · ${t('reprog.colis_avec')} ${course.riderName}`;
        row.append(line('reprog-row-order', course.orderId), line('reprog-row-etat', etat));
        row.appendChild(line('reprog-row-depuis', course.fenetre === null ? t('reprog.deuxieme_sans_fenetre') : `${t('reprog.deuxieme_fenetre')} ${fenetreLisible(course.fenetre)}`));
        leverRenvoi(row, course.orderId);
        reprogSection.appendChild(row);
      }
    }

    const relire = document.createElement('button');
    relire.className = 'reprog-relire';
    relire.textContent = t('reprog.relire');
    relire.disabled = fixation.enVol !== null || renvoi.enVol !== null;
    relire.addEventListener('click', () => {
      void refreshReprog();
    });
    reprogSection.appendChild(relire);
  }

  renderReprog();
  /**
   * THE NEXT-PASSAGE DESK IS LIVE WORK AND SITS ABOVE THE TWO ADMINISTRATIVE
   * DESKS. Then: THE COURSES DESK SITS ABOVE THE CODES DESK, AND BOTH SIT AT
   * THE BOTTOM. A dispatcher's screen is ordered by urgency and neither of
   * those two is live work: one cleans the board, the other hands out
   * identities. The codes desk stays LAST (its own e2e pins that), the courses
   * desk just above it — the two administrative sections together, under
   * everything operational.
   */
  /**
   * ═══ FLOTTE-1 (SE7.2) — THE FLEET DESK ═══
   *
   * « Vehicle docs/maintenance/fuel/odometer; DeliveryCost decomposition
   * (direct/return/allocated/fully-loaded, low/base/high); utilization +
   * deliveries/moto/day. » The founder's facts, typed here and kept on the
   * logistics Worker; the figures derived there and read back. ⏳ The cost
   * hypotheses are HIS numbers — the desk shows « à renseigner » until he
   * types them and never a default figure. Administrative: it sits with the
   * courses and codes desks, under everything operational.
   */
  const flotteHeading = document.createElement('h2');
  flotteHeading.textContent = t('flotte.titre');
  const flotteSection = document.createElement('section');
  flotteSection.className = 'flotte-desk';

  type FlotteRead = { kind: 'loading' } | { kind: 'ok'; vue: FlotteVue } | { kind: 'bad_key' } | { kind: 'failed' };
  let flotteRead: FlotteRead = { kind: 'loading' };
  /** ONE act in flight on this desk. */
  let flotteBusy: string | null = null;
  let flotteNotice: string | null = null;
  const flotteFaits: string[] = [];
  const hypSaisie: Record<string, string> = {};
  let hypSaisieChargee = false;
  const noterSaisie = new Map<string, Record<string, string>>();
  const declarerSaisie = { label: '', tranche: '' };
  const coutSaisie = { orderId: '', d: '' };
  let couts: Readonly<Record<Scenario, CoutLigne>> | null = null;
  let coutNotice: string | null = null;
  const flottePort = () => resolveFlotte(opsKey ?? '');

  async function refreshFlotte(): Promise<void> {
    if (opsKey === null) {
      renderFlotte();
      return;
    }
    flotteRead = { kind: 'loading' };
    renderFlotte();
    const answer = await flottePort().lire();
    flotteRead = answer.kind === 'ok' ? { kind: 'ok', vue: answer.value } : answer.kind === 'bad_key' ? { kind: 'bad_key' } : { kind: 'failed' };
    // What he typed comes back to him, once, from the book — never overwriting a draft.
    if (answer.kind === 'ok' && answer.value.hypotheses !== null && !hypSaisieChargee) {
      Object.assign(hypSaisie, saisieDepuisHypotheses(answer.value.hypotheses));
      hypSaisieChargee = true;
    }
    renderFlotte();
  }

  /** One act through one gate: a second tap cannot start a second act; a
   *  refused key escalates the whole desk; a refusal is said by name. */
  async function acteFlotte(acte: string, call: () => Promise<{ kind: string; reason?: string }>, fait: string): Promise<void> {
    if (flotteBusy !== null) return;
    flotteBusy = acte;
    flotteNotice = null;
    renderFlotte();
    const answer = await call();
    flotteBusy = null;
    if (answer.kind === 'bad_key') {
      flotteRead = { kind: 'bad_key' };
      renderFlotte();
      return;
    }
    if (answer.kind !== 'ok') {
      flotteNotice = answer.kind === 'refused' ? flotteRefusKey(answer.reason ?? '') : 'flotte.echec';
      renderFlotte();
      return;
    }
    flotteFaits.push(fait);
    await refreshFlotte();
  }

  const champ = (cls: string, placeholder: string, value: string, onInput: (v: string) => void, type = 'text'): HTMLInputElement => {
    const input = document.createElement('input');
    input.className = cls;
    input.type = type;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
    input.value = value;
    input.disabled = flotteBusy !== null;
    input.addEventListener('input', () => onInput(input.value));
    return input;
  };
  const bouton = (cls: string, label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    b.disabled = flotteBusy !== null;
    b.addEventListener('click', onClick);
    return b;
  };
  const entier = (raw: string): number | undefined => {
    const v = raw.trim();
    return v === '' ? undefined : Number(v);
  };

  function renderFlotte(): void {
    flotteSection.replaceChildren();
    if (logisticsBase() === '') {
      flotteSection.append(line('reprog-state', t('codes.pas_relie')), line('reprog-hint', t('flotte.pas_relie_aide')));
      return;
    }
    if (opsKey === null) {
      flotteSection.appendChild(line('reprog-state', t('reprog.cle_dabord')));
      return;
    }
    if (flotteRead.kind === 'bad_key') {
      flotteSection.append(line('reprog-state', t('codes.cle_refusee')), line('reprog-hint', t('codes.cle_refusee_aide')));
      return;
    }
    flotteSection.appendChild(line('reprog-hint', t('flotte.intro')));
    for (const fait of flotteFaits) flotteSection.appendChild(line('reprog-fait', t(fait)));
    if (flotteNotice !== null) flotteSection.appendChild(line('reprog-notice flotte-notice', t(flotteNotice)));
    if (flotteRead.kind === 'loading') {
      flotteSection.appendChild(line('reprog-state', t('flotte.lecture')));
      return;
    }
    if (flotteRead.kind === 'failed') {
      flotteSection.append(line('reprog-state', t('flotte.echec_lecture')), line('reprog-hint', t('reprog.echec_aide')));
      return;
    }
    const vue = flotteRead.vue;
    const riders = codesRead.kind === 'ok' ? codesRead.riders : [];
    const nom = (riderId: string | null): string => (riderId === null ? '' : (riders.find((r) => r.riderId === riderId)?.displayName ?? riderId));
    const motoLabel = (vehicleId: string | null): string => (vehicleId === null ? '' : (vue.motos.find((m) => m.vehicleId === vehicleId)?.label ?? vehicleId));

    // ── The motos ──
    if (vue.motos.length === 0) flotteSection.appendChild(line('reprog-state flotte-vide', t('flotte.vide')));
    for (const m of vue.motos) {
      const row = document.createElement('div');
      row.className = 'reprog-row flotte-moto';
      row.append(
        line('reprog-row-order flotte-moto-label', m.label),
        line('reprog-row-etat flotte-moto-etat', `${t(motoStatutKey(m.status))} · ${t('flotte.tranche')} ${m.fleetTranche} · ${m.odometerKm} ${t('flotte.km')}`),
      );
      if (m.docs.length > 0) {
        row.appendChild(line('reprog-row-depuis flotte-moto-docs', `${t('flotte.papiers')} : ${m.docs.map((d) => `${d.kind} — ${d.expiresAt.slice(0, 10)}`).join(' · ')}`));
      }
      row.appendChild(line('reprog-row-depuis flotte-moto-garde', m.checkedOutBy === null ? t('flotte.libre') : `${t('flotte.confiee_a')} ${nom(m.checkedOutBy)}`));

      // Who holds it.
      const confier = document.createElement('div');
      confier.className = 'reprog-form flotte-confier';
      const select = document.createElement('select');
      select.className = 'flotte-confier-select';
      select.setAttribute('aria-label', t('flotte.confier'));
      select.disabled = flotteBusy !== null;
      const none = document.createElement('option');
      none.value = '';
      none.textContent = t('flotte.personne');
      select.appendChild(none);
      for (const r of riders) {
        const o = document.createElement('option');
        o.value = r.riderId;
        o.textContent = r.displayName;
        if (r.riderId === m.checkedOutBy) o.selected = true;
        select.appendChild(o);
      }
      confier.append(
        select,
        bouton('reprog-fixer flotte-confier-btn', t('flotte.confier'), () => {
          const riderId = select.value === '' ? null : select.value;
          void acteFlotte(`confier:${m.vehicleId}`, () => flottePort().confier({ commandId: flotteCommandId('confier'), vehicleId: m.vehicleId, riderId }), riderId === null ? 'flotte.reprise' : 'flotte.confiee');
        }),
      );
      row.appendChild(confier);

      // A note on the moto: a repair, a charge, a reading, a paper.
      const saisie = noterSaisie.get(m.vehicleId) ?? { kind: 'maintenance', note: '', km: '', cout: '', kwh: '', docKind: '', docDate: '' };
      noterSaisie.set(m.vehicleId, saisie);
      const noter = document.createElement('div');
      noter.className = 'reprog-form flotte-noter';
      const kind = document.createElement('select');
      kind.className = 'flotte-noter-kind';
      kind.setAttribute('aria-label', t('flotte.noter'));
      kind.disabled = flotteBusy !== null;
      for (const k of ENTRY_KINDS) {
        const o = document.createElement('option');
        o.value = k;
        o.textContent = t(entreeKey(k));
        if (k === saisie['kind']) o.selected = true;
        kind.appendChild(o);
      }
      kind.addEventListener('change', () => {
        saisie['kind'] = kind.value;
        renderFlotte();
      });
      noter.appendChild(kind);
      const k = saisie['kind'] as EntryKind;
      if (k === 'document') {
        noter.append(
          champ('flotte-noter-doc-kind', t('flotte.doc_kind_placeholder'), saisie['docKind'] ?? '', (v) => { saisie['docKind'] = v; }),
          champ('flotte-noter-doc-date', t('flotte.doc_date'), saisie['docDate'] ?? '', (v) => { saisie['docDate'] = v; }, 'date'),
        );
      } else {
        if (k !== 'energie') noter.appendChild(champ('flotte-noter-km', t('flotte.km_placeholder'), saisie['km'] ?? '', (v) => { saisie['km'] = v; }, 'number'));
        if (k !== 'compteur') noter.appendChild(champ('flotte-noter-cout', t('flotte.cout_placeholder'), saisie['cout'] ?? '', (v) => { saisie['cout'] = v; }, 'number'));
        if (k === 'energie') noter.appendChild(champ('flotte-noter-kwh', t('flotte.kwh_placeholder'), saisie['kwh'] ?? '', (v) => { saisie['kwh'] = v; }, 'number'));
        noter.appendChild(champ('flotte-noter-note', t('flotte.note_placeholder'), saisie['note'] ?? '', (v) => { saisie['note'] = v; }));
      }
      noter.appendChild(
        bouton('reprog-fixer flotte-noter-btn', t('flotte.envoyer'), () => {
          const km = entier(saisie['km'] ?? '');
          const cout = entier(saisie['cout'] ?? '');
          const kwh = saisie['kwh'] === undefined || saisie['kwh'].trim() === '' ? undefined : Number(saisie['kwh'].replace(',', '.'));
          const doc = k === 'document' ? { kind: (saisie['docKind'] ?? '').trim(), expiresAt: (saisie['docDate'] ?? '').trim() === '' ? '' : new Date(`${saisie['docDate']}T00:00:00.000Z`).toISOString() } : undefined;
          void acteFlotte(
            `noter:${m.vehicleId}`,
            () => flottePort().noter({ commandId: flotteCommandId('noter'), vehicleId: m.vehicleId, kind: k, note: saisie['note'] ?? '', odometerKm: km, costFcfa: cout, kwh, doc }),
            'flotte.notee',
          ).then(() => {
            if (flotteNotice === null) noterSaisie.set(m.vehicleId, { ...saisie, note: '', km: '', cout: '', kwh: '', docKind: '', docDate: '' });
          });
        }),
      );
      row.appendChild(noter);
      flotteSection.appendChild(row);
    }

    // ── Declare a moto ──
    const declarer = document.createElement('div');
    declarer.className = 'reprog-form flotte-declarer';
    declarer.append(
      line('reprog-row-etat', t('flotte.declarer_titre')),
      champ('flotte-label', t('flotte.label_placeholder'), declarerSaisie.label, (v) => { declarerSaisie.label = v; }),
      champ('flotte-tranche', t('flotte.tranche_placeholder'), declarerSaisie.tranche, (v) => { declarerSaisie.tranche = v; }, 'number'),
      bouton('reprog-fixer flotte-declarer-btn', t('flotte.declarer'), () => {
        const tranche = entier(declarerSaisie.tranche) ?? 1;
        void acteFlotte('declarer', () => flottePort().declarerMoto({ commandId: flotteCommandId('moto'), label: declarerSaisie.label, fleetTranche: tranche }), 'flotte.declaree').then(() => {
          if (flotteNotice === null) {
            declarerSaisie.label = '';
            declarerSaisie.tranche = '';
          }
        });
      }),
    );
    flotteSection.appendChild(declarer);

    // ── Papers due ──
    const docs = document.createElement('div');
    docs.className = 'reprog-row flotte-docs-dus';
    docs.appendChild(line('reprog-row-order', t('flotte.docs_titre')));
    if (vue.documentsDus.length === 0) docs.appendChild(line('reprog-row-depuis', t('flotte.docs_vide')));
    for (const d of vue.documentsDus) {
      docs.appendChild(line(d.expire ? 'reprog-notice' : 'reprog-row-etat', `${d.label} · ${d.kind} · ${d.expiresAt.slice(0, 10)} · ${t(d.expire ? 'flotte.papier_expire' : 'flotte.papier_a_renouveler')}`));
    }
    flotteSection.appendChild(docs);

    // ── Utilization ──
    const u = vue.utilisation;
    const util = document.createElement('div');
    util.className = 'reprog-row flotte-util';
    util.appendChild(line('reprog-row-order', `${t('flotte.util_titre')} (${u.windowDays} ${t('flotte.jours')})`));
    util.appendChild(line('reprog-row-etat', `${u.livrees} ${t('flotte.util_livrees')} · ${u.retournees} ${t('flotte.util_retournees')} · ${u.motosActives} ${t('flotte.util_motos')}`));
    util.appendChild(
      line('reprog-row-etat flotte-util-yardstick', u.livraisonsParMotoParJour === null ? t('flotte.util_sans_moto') : `${u.livraisonsParMotoParJour} ${t('flotte.util_par_moto_jour')}`),
    );
    util.appendChild(line('reprog-row-depuis', u.tauxEchec === null ? t('flotte.util_aucune_course') : `${Math.round(u.tauxEchec * 100)} % ${t('flotte.util_taux_echec')}`));
    for (const p of u.parMoto) util.appendChild(line('reprog-row-depuis', `${p.label} : ${p.livrees} ${t('flotte.util_livrees')} · ${p.retournees} ${t('flotte.util_retournees')}`));
    flotteSection.appendChild(util);

    // ── Shifts ──
    const services = document.createElement('div');
    services.className = 'reprog-row flotte-services';
    services.appendChild(line('reprog-row-order', t('flotte.services_titre')));
    if (vue.shifts.length === 0) services.appendChild(line('reprog-row-depuis', t('flotte.services_vide')));
    for (const s of vue.shifts.slice(0, 10)) {
      const debut = `${s.startedAt.slice(0, 10)} ${hhmm(s.startedAt)}`;
      const fin = s.endedAt === null ? t('flotte.service_en_cours') : hhmm(s.endedAt);
      services.appendChild(line('reprog-row-depuis', `${nom(s.riderId)} · ${motoLabel(s.vehicleId) || t('flotte.sans_moto')} · ${debut} → ${fin}`));
    }
    flotteSection.appendChild(services);

    // ── The cost of a delivery: his hypotheses, then the decomposition ──
    const cout = document.createElement('div');
    cout.className = 'reprog-row flotte-cout';
    cout.append(line('reprog-row-order', t('flotte.cout_titre')), line('reprog-hint', t('flotte.hyp_intro')));
    if (vue.hypotheses === null) cout.appendChild(line('reprog-notice flotte-hyp-absentes', t('flotte.hyp_absentes')));
    const table = document.createElement('table');
    table.className = 'flotte-hyp';
    const head = document.createElement('tr');
    head.append(document.createElement('th'));
    for (const s of SCENARIOS) {
      const th = document.createElement('th');
      th.textContent = t(`flotte.scenario_${s}`);
      head.appendChild(th);
    }
    table.appendChild(head);
    for (const f of [...SCALAR_FIELDS, ...OVERHEAD_ITEMS]) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = t(`flotte.h_${f}`);
      tr.appendChild(th);
      for (const s of SCENARIOS) {
        const td = document.createElement('td');
        const key = `${s}.${f}`;
        td.appendChild(champ('flotte-hyp-champ', t(`flotte.h_${f}`), hypSaisie[key] ?? '', (v) => { hypSaisie[key] = v; }));
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    cout.appendChild(table);
    cout.appendChild(
      bouton('reprog-fixer flotte-hyp-btn', t('flotte.hyp_enregistrer'), () => {
        const composed = hypothesesDepuisSaisie(hypSaisie);
        if (!composed.ok) {
          const [s, f] = composed.champ.split('.');
          flotteNotice = null;
          coutNotice = `${t('flotte.hyp_champ_invalide')} ${t(`flotte.scenario_${s}`)} — ${t(`flotte.h_${f}`)}`;
          renderFlotte();
          return;
        }
        coutNotice = null;
        void acteFlotte('hypotheses', () => flottePort().hypotheses({ commandId: flotteCommandId('hypotheses'), hypotheses: composed.hypotheses }), 'flotte.hyp_enregistrees');
      }),
    );
    if (coutNotice !== null) cout.appendChild(line('reprog-notice flotte-cout-notice', coutNotice));
    if (vue.hypotheses !== null) {
      const calc = document.createElement('div');
      calc.className = 'reprog-form flotte-calcul';
      calc.append(
        champ('flotte-cout-order', t('flotte.cout_order_placeholder'), coutSaisie.orderId, (v) => { coutSaisie.orderId = v; }),
        champ('flotte-cout-d', t('flotte.cout_d_placeholder'), coutSaisie.d, (v) => { coutSaisie.d = v; }, 'number'),
        bouton('reprog-fixer flotte-cout-btn', t('flotte.calculer'), () => {
          const d = entier(coutSaisie.d);
          if (coutSaisie.orderId.trim() === '' || d === undefined || !Number.isInteger(d) || d < 0) {
            coutNotice = t('flotte.refus_saisie');
            renderFlotte();
            return;
          }
          if (flotteBusy !== null) return;
          flotteBusy = 'cout';
          coutNotice = null;
          renderFlotte();
          void flottePort().cout(coutSaisie.orderId.trim(), d).then((answer) => {
            flotteBusy = null;
            if (answer.kind === 'bad_key') {
              flotteRead = { kind: 'bad_key' };
            } else if (answer.kind !== 'ok') {
              couts = null;
              coutNotice = t(answer.kind === 'refused' ? flotteRefusKey(answer.reason) : 'flotte.echec');
            } else {
              couts = answer.value;
            }
            renderFlotte();
          });
        }),
      );
      cout.appendChild(calc);
      if (couts !== null) {
        const res = document.createElement('table');
        res.className = 'flotte-cout-table';
        const h = document.createElement('tr');
        h.append(document.createElement('th'));
        for (const s of SCENARIOS) {
          const th = document.createElement('th');
          th.textContent = t(`flotte.scenario_${s}`);
          h.appendChild(th);
        }
        res.appendChild(h);
        for (const l of COUT_LIGNES) {
          const tr = document.createElement('tr');
          tr.className = 'flotte-cout-ligne';
          const th = document.createElement('th');
          th.textContent = t(`flotte.cout_${l}`);
          tr.appendChild(th);
          for (const s of SCENARIOS) {
            const td = document.createElement('td');
            td.textContent = francs(couts[s][l]);
            tr.appendChild(td);
          }
          res.appendChild(tr);
        }
        cout.appendChild(res);
      }
    }
    flotteSection.appendChild(cout);

    const relire = bouton('reprog-relire flotte-relire', t('flotte.relire'), () => {
      void refreshFlotte();
    });
    flotteSection.appendChild(relire);
  }

  renderFlotte();

  // MANIFESTE-1 — the riders' live state sits above the next-passage desk;
  // FLOTTE-1 — the fleet desk is administrative and sits with the courses
  // and codes desks (the codes desk stays LAST).
  main.append(manifesteHeading, manifesteSection, reprogHeading, reprogSection, coursesHeading, coursesSection, flotteHeading, flotteSection, codesHeading, codesSection);

  // The REAL service-side deadline, ONE sweep for BOTH stores (WO-4.3).
  setInterval(() => {
    void dispatch.expireDue(new Date().toISOString()).then(({ requeued }) => {
      if (requeued.length > 0) render({ key: 'console.requeued' });
    });
  }, 60_000);

  app.append(header, strip, main);
}
