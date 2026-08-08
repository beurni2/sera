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
      for (const line of landmarkFirstLines(entry.task.location)) {
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
   * ⚠ THE ONLY LIVE SECTION IN THIS CONSOLE. Everything above is sandbox. This
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
  main.append(codesHeading, codesSection);



  // The REAL service-side deadline, ONE sweep for BOTH stores (WO-4.3).
  setInterval(() => {
    void dispatch.expireDue(new Date().toISOString()).then(({ requeued }) => {
      if (requeued.length > 0) render({ key: 'console.requeued' });
    });
  }, 60_000);

  app.append(header, strip, main);
}
