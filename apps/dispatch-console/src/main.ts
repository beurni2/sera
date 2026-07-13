import { sharedColour, seraColour, spacing, radius, type as typo, interaction, band, touch } from '@platform/ui-tokens';
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
import { t } from './i18n';

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
  button.assign, button.done {
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
  button.sos-raise, button.sos-raise-queued {
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

  // The REAL service-side deadline, ONE sweep for BOTH stores (WO-4.3).
  setInterval(() => {
    void dispatch.expireDue(new Date().toISOString()).then(({ requeued }) => {
      if (requeued.length > 0) render({ key: 'console.requeued' });
    });
  }, 60_000);

  app.append(header, strip, main);
}
