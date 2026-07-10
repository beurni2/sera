import { seraTheme as theme } from '@platform/ui-tokens';
import { landmarkFirstLines } from '@sera/logistics-service';
import { buildSandboxWorld } from './sandbox-world';
import { SANDBOX_DWELL, SANDBOX_OUTCOMES } from './sandbox-followup';
import { t } from './i18n';

/**
 * WO-1.2 dispatch-console: the E1 MANUAL assignment form (§2.3 step 10) on
 * the REAL logistics-service intake + assignment logic (see sandbox-world).
 * One primary action: assign. No auto-assign, no ranking, no routing.
 * Locations render landmark-first (SE0.3). D7 dispatch-hours is an open
 * Decision — the staffed-hours default appears in COPY ONLY.
 */

const { queue, book, riders } = buildSandboxWorld(new Date().toISOString());

const root = document.documentElement;
root.style.setProperty('--surface', theme.colors.surface);
root.style.setProperty('--surface-raised', theme.colors.surfaceRaised);
root.style.setProperty('--ink', theme.colors.ink);
root.style.setProperty('--ink-muted', theme.colors.inkMuted);
root.style.setProperty('--line', theme.colors.line);
root.style.setProperty('--primary', theme.colors.primary);
root.style.setProperty('--space-md', `${theme.spacing.md}px`);
root.style.setProperty('--space-lg', `${theme.spacing.lg}px`);
root.style.setProperty('--space-xl', `${theme.spacing.xl}px`);
root.style.setProperty('--radius-lg', `${theme.radius.lg}px`);
root.style.setProperty('--type-title', `${theme.typeScale.title.size}px`);
root.style.setProperty('--type-heading', `${theme.typeScale.heading.size}px`);
root.style.setProperty('--type-body', `${theme.typeScale.bodyLarge.size}px`);
root.style.setProperty('--type-label', `${theme.typeScale.label.size}px`);

const style = document.createElement('style');
style.textContent = `
  body {
    margin: 0;
    background: var(--surface);
    color: var(--ink);
    font-family: system-ui, sans-serif;
  }
  header {
    padding: var(--space-lg) var(--space-xl);
    border-bottom: 1px solid var(--line);
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  h1 {
    margin: 0;
    color: var(--primary);
    font-size: var(--type-title);
    font-weight: ${theme.typeScale.title.weight};
  }
  .hours-note {
    color: var(--ink-muted);
    font-size: var(--type-label);
  }
  main {
    padding: var(--space-xl);
    display: grid;
    gap: var(--space-lg);
    max-width: 640px;
  }
  h2 {
    margin: 0;
    font-size: var(--type-heading);
    font-weight: ${theme.typeScale.heading.weight};
  }
  .task-card, .follow-card, .empty-state {
    background: var(--surface-raised);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    padding: var(--space-xl);
    font-size: var(--type-body);
  }
  .empty-state { color: var(--ink-muted); }
  .location-line { margin: 0 0 var(--space-md) 0; }
  .location-line:first-of-type { font-weight: 600; }
  .rider-row {
    display: flex;
    gap: var(--space-md);
    align-items: center;
    margin-top: var(--space-md);
  }
  .rider-label { color: var(--ink-muted); font-size: var(--type-label); }
  select { min-height: 44px; font-size: var(--type-body); }
  button.assign {
    min-height: 44px;
    padding: 0 var(--space-xl);
    border: 0;
    border-radius: var(--radius-lg);
    background: var(--primary);
    color: var(--surface);
    font-size: var(--type-body);
    cursor: pointer;
  }
  .status-line { color: var(--ink-muted); font-size: var(--type-body); margin: 0; }
`;
document.head.appendChild(style);

const app = document.querySelector('#app');
if (app) {
  const header = document.createElement('header');
  const brand = document.createElement('h1');
  brand.textContent = t('app.title');
  const hours = document.createElement('span');
  hours.className = 'hours-note';
  hours.textContent = t('console.hours_note');
  header.append(brand, hours);

  const main = document.createElement('main');
  const heading = document.createElement('h2');
  heading.textContent = t('console.ready_queue');
  const body = document.createElement('div');
  body.id = 'queue-body';
  main.append(heading, body);

  const render = (statusKey?: string) => {
    body.replaceChildren();
    const queued = queue.queuedTasks();
    if (statusKey) {
      const status = document.createElement('p');
      status.className = 'status-line';
      status.textContent = t(statusKey);
      body.appendChild(status);
    }
    if (queued.length === 0) {
      if (!statusKey) {
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
        const outcome = book.assign({
          command_id: `cmd-console-assign-${entry.task.id}`,
          taskId: entry.task.id,
          riderId: riderPick.value,
          dispatcherId: 'dispatcher-console',
          at: new Date().toISOString(),
          newAssignmentId: `as-${entry.task.id}`,
        });
        // A refusal keeps the task visible in the queue — no false claims.
        render(outcome.ok ? 'console.waiting_ack' : undefined);
      });
      riderRow.append(riderLabel, riderPick, assign);
      card.appendChild(riderRow);
      body.appendChild(card);
    }
  };
  render();

  // WO-2.2 — follow-up section: dwell surfaced (D20: recorded and shown,
  // never enforced) + the delivery-outcome timeline on the canonical
  // families. Sandbox data; live feeds arrive at E2 assembly.
  const followHeading = document.createElement('h2');
  followHeading.textContent = t('console.followup');
  const followCard = document.createElement('section');
  followCard.className = 'follow-card';
  const dwellLine = document.createElement('p');
  dwellLine.className = 'status-line';
  dwellLine.textContent = `${t('console.dwell_label')} : ${SANDBOX_DWELL.dwellSec} s — ${t(SANDBOX_DWELL.withinTarget ? 'console.dwell_in_target' : 'console.dwell_out_target')}`;
  followCard.appendChild(dwellLine);
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

  // The REAL service-side ack deadline: unacknowledged assignments return to
  // the queue (assignment.expired.v1) and the console says so honestly.
  setInterval(() => {
    const { requeued } = book.expireUnacknowledged(new Date().toISOString());
    if (requeued.length > 0) render('console.requeued');
  }, 60_000);

  app.append(header, main);
}
