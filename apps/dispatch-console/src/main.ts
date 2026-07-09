import { seraTheme as theme } from '@platform/ui-tokens';
import { t } from './i18n';

/**
 * SE0.1 dispatch-console shell: one sparse page on ui-tokens (sera theme —
 * road-and-custody clarity) and catalog strings. The ready-queue is an
 * honest, designed empty state; dispatch logic is SE2.x (FORBIDDEN here).
 * Sparse ≠ ugly.
 */

const root = document.documentElement;
root.style.setProperty('--surface', theme.colors.surface);
root.style.setProperty('--surface-raised', theme.colors.surfaceRaised);
root.style.setProperty('--ink', theme.colors.ink);
root.style.setProperty('--ink-muted', theme.colors.inkMuted);
root.style.setProperty('--line', theme.colors.line);
root.style.setProperty('--primary', theme.colors.primary);
root.style.setProperty('--space-lg', `${theme.spacing.lg}px`);
root.style.setProperty('--space-xl', `${theme.spacing.xl}px`);
root.style.setProperty('--radius-lg', `${theme.radius.lg}px`);
root.style.setProperty('--type-title', `${theme.typeScale.title.size}px`);
root.style.setProperty('--type-heading', `${theme.typeScale.heading.size}px`);
root.style.setProperty('--type-body', `${theme.typeScale.bodyLarge.size}px`);

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
  }
  h1 {
    margin: 0;
    color: var(--primary);
    font-size: var(--type-title);
    font-weight: ${theme.typeScale.title.weight};
  }
  main {
    padding: var(--space-xl);
    display: grid;
    gap: var(--space-lg);
  }
  h2 {
    margin: 0;
    font-size: var(--type-heading);
    font-weight: ${theme.typeScale.heading.weight};
  }
  .empty-state {
    background: var(--surface-raised);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    padding: var(--space-xl);
    color: var(--ink-muted);
    font-size: var(--type-body);
  }
`;
document.head.appendChild(style);

const app = document.querySelector('#app');
if (app) {
  const header = document.createElement('header');
  const brand = document.createElement('h1');
  brand.textContent = t('app.title');
  header.appendChild(brand);

  const main = document.createElement('main');
  const heading = document.createElement('h2');
  heading.textContent = t('console.ready_queue');
  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = t('console.empty_state');
  main.append(heading, empty);

  app.append(header, main);
}
