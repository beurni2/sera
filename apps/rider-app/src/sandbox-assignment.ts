/**
 * E1 SANDBOX assignment for the rider shell — the same sandbox world the
 * console assigns from (task-e1-0001, Gounghin). This is runtime location
 * DATA feeding the card, not interface copy — UI strings live in the i18n
 * catalog. The live server push replaces this at E1 assembly.
 */

export interface AssignmentView {
  /** Landmark-first lines (SE0.3): [landmark, directions, zone]. */
  locationLines: readonly [string, string, string];
  ackState: 'none' | 'ack_pending';
}

export const SANDBOX_ASSIGNMENT: AssignmentView = {
  locationLines: [
    'Face à la pharmacie du marché',
    'Deuxième porte bleue après le kiosque',
    'Gounghin',
  ],
  ackState: 'none',
};
