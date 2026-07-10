import { LocationSchema, type Location } from '@platform/kernel-types';

/**
 * SE0.3 — delivery locations built EXCLUSIVELY on the pinned kernel
 * Location {pin, zone, landmark, directions, maskedRelay}. The schema is
 * strict: a streetAddress key is a parse FAILURE, not a warning (acceptance
 * SE4: "no street address"). Landmark-first is the display law both shells
 * follow; the masked relay carries an expiry — access is temporary by
 * construction. Failed contact is a CLOSED structured reason, never free
 * text.
 */

export interface DeliveryPoint {
  location: Location;
  /** Masked-relay access expires (SE0.3: "access expires"). E1: placeholder relay + expiry field. */
  relayExpiresAt: string;
}

export type DeliveryPointOutcome =
  | { ok: true; point: DeliveryPoint }
  | { ok: false; reason: 'not_canonical_location' };

export function buildDeliveryPoint(rawLocation: unknown, relayExpiresAt: string): DeliveryPointOutcome {
  const parsed = LocationSchema.safeParse(rawLocation);
  if (!parsed.success) return { ok: false, reason: 'not_canonical_location' };
  return { ok: true, point: { location: parsed.data, relayExpiresAt } };
}

/**
 * Landmark-first display order (SE0.3) — both shells render exactly this
 * sequence. The GPS pin never leads; the words a rider actually navigates
 * by do.
 */
export function landmarkFirstLines(location: Location): readonly [string, string, string] {
  return [location.landmark, location.directions, location.zone];
}

/** SE4 acceptance: "structured failed-contact reason" — closed list, no free text. */
export const FAILED_CONTACT_REASONS = [
  'no_answer',
  'relay_expired',
  'wrong_recipient',
  'refused_contact',
] as const;
export type FailedContactReason = (typeof FAILED_CONTACT_REASONS)[number];

export interface FailedContactRecord {
  taskId: string;
  reason: FailedContactReason;
  at: string;
}

export type FailedContactOutcome =
  | { ok: true; record: FailedContactRecord }
  | { ok: false; reason: 'unstructured_reason' };

export function recordFailedContact(taskId: string, reason: string, at: string): FailedContactOutcome {
  if (!(FAILED_CONTACT_REASONS as readonly string[]).includes(reason)) {
    return { ok: false, reason: 'unstructured_reason' };
  }
  return { ok: true, record: { taskId, reason: reason as FailedContactReason, at } };
}
