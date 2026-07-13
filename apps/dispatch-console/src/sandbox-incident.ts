/**
 * WO-6.3 SANDBOX SOS incident data for the console (SE8). Runtime DATA feeding
 * the alert card — like sandbox-followup.ts, not interface copy (UI strings
 * live in the i18n catalog). The event names MIRROR the pinned
 * @platform/contracts EVENT_NAMES (safety.sos_created.v1 · incident.opened.v1);
 * the SERVICE emits, the console reflects. Live safety.* streams replace this
 * at assembly. NO franc anywhere — Séra emits signals, never money.
 */

export type SosStatus = 'queued' | 'raised' | 'escalated' | 'acknowledged';
export type SosResponder = 'dispatcher' | 'founder';

export const SOS_EVENTS = {
  created: 'safety.sos_created.v1',
  acknowledged: 'safety.sos_acknowledged.v1',
  incidentOpened: 'incident.opened.v1',
} as const;

export interface IncidentView {
  id: string;
  correlationId: string;
  riderId: string;
  riderName: string;
  /** The rider's active task/lease, if any — shown so custody stays legible. */
  activeTaskId: string | null;
  /** SE-I08: a coarse landmark IFF the rider is on shift, else null. */
  coarseLocation: string | null;
  onShift: boolean;
  hours: 'in_hours' | 'out_of_hours';
  responder: SosResponder;
  status: SosStatus;
  acknowledgedBy: SosResponder | null;
}

/**
 * The honesty law, mirrored on the console: a dispatcher can acknowledge ONLY a
 * LIVE incident (raised or escalated). A queued incident has NOT arrived — you
 * cannot ack what has not arrived; the guard THROWS, exactly like the rider
 * store's acknowledgeSos. The acknowledged event is the canon name.
 */
export function acknowledgeSos(incident: IncidentView, by: SosResponder): IncidentView {
  if (incident.status !== 'raised' && incident.status !== 'escalated') {
    throw new Error(`cannot acknowledge an SOS at '${incident.status}' — only 'raised' or 'escalated'`);
  }
  return { ...incident, status: 'acknowledged', acknowledgedBy: by };
}

/** Whether the ack lever may be enabled — false for a not-yet-arrived incident. */
export function canAcknowledge(incident: IncidentView): boolean {
  return incident.status === 'raised' || incident.status === 'escalated';
}

/**
 * The in-hours raised incident the console renders at the top (loudest). Coarse
 * location present because the rider is on shift (SE-I08). Obviously demo data
 * (« (démo) ») — it can never pass for a real rider.
 */
export const SANDBOX_INCIDENT_RAISED: IncidentView = {
  id: 'sos-rider-issa-demo',
  correlationId: 'corr-sos-e1-0001',
  riderId: 'rider-issa',
  riderName: 'Issa O. (démo)',
  activeTaskId: 'task-e1-0001',
  coarseLocation: 'Vers le grand marché — secteur 1 (démo)',
  onShift: true,
  hours: 'in_hours',
  responder: 'dispatcher',
  status: 'raised',
  acknowledgedBy: null,
};

/**
 * The queued (offline) variant — known to the demo but NOT yet delivered: the
 * console shows « En attente du réseau » and the ack lever is DISABLED (you
 * cannot ack what has not arrived).
 */
export const SANDBOX_INCIDENT_QUEUED: IncidentView = {
  ...SANDBOX_INCIDENT_RAISED,
  id: 'sos-rider-issa-demo-queued',
  status: 'queued',
};
