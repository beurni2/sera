import { describe, expect, it } from 'vitest';
import {
  FAILED_CONTACT_REASONS,
  buildDeliveryPoint,
  landmarkFirstLines,
  recordFailedContact,
} from '../src/delivery-location.js';

const T = '2026-07-09T12:00:00.000Z';
const canonical = {
  pin: { lat: 12.3714, lng: -1.5197 },
  zone: 'Gounghin',
  landmark: 'Face à la pharmacie du marché',
  directions: 'Deuxième porte bleue après le kiosque',
  maskedRelay: 'relay-abc',
};

describe('delivery location — SE0.3/SE4, kernel Location only', () => {
  it('a canonical kernel Location builds a delivery point with a relay expiry', () => {
    const outcome = buildDeliveryPoint(canonical, T);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.point.location).toEqual(canonical);
    expect(outcome.point.relayExpiresAt).toBe(T);
  });

  it('a streetAddress-bearing location is a strict-parse FAILURE — no street address, ever (SE4)', () => {
    const withStreet = { ...canonical, streetAddress: '12 rue de la Chance' };
    expect(buildDeliveryPoint(withStreet, T)).toEqual({ ok: false, reason: 'not_canonical_location' });
    const withAdresse = { ...canonical, adresse: 'secteur 4, rue 12.34' };
    expect(buildDeliveryPoint(withAdresse, T)).toEqual({ ok: false, reason: 'not_canonical_location' });
  });

  it('missing kernel fields refuse closed (landmark is required, not optional)', () => {
    const { landmark: _dropped, ...withoutLandmark } = canonical;
    expect(buildDeliveryPoint(withoutLandmark, T).ok).toBe(false);
  });

  it('landmark-first display order: landmark, then directions, then zone — the pin never leads', () => {
    const outcome = buildDeliveryPoint(canonical, T);
    if (!outcome.ok) throw new Error('setup');
    expect(landmarkFirstLines(outcome.point.location)).toEqual([
      'Face à la pharmacie du marché',
      'Deuxième porte bleue après le kiosque',
      'Gounghin',
    ]);
  });

  it('failed contact takes ONLY the structured closed reasons — free text refused (SE4)', () => {
    for (const reason of FAILED_CONTACT_REASONS) {
      expect(recordFailedContact('task-1', reason, T).ok).toBe(true);
    }
    expect(recordFailedContact('task-1', "le client n'était pas là", T)).toEqual({
      ok: false,
      reason: 'unstructured_reason',
    });
    expect(recordFailedContact('task-1', 'other', T).ok).toBe(false);
  });
});
