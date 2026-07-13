import type { RouteManifest } from '@platform/contracts';
import type { PackageCustody } from './board';

/**
 * WO-6.9-c · D3 — SANDBOX live-board data (runtime DATA, like sandbox-incident;
 * UI strings live in the i18n catalog). Obviously-demo (« (démo) ») so it can
 * never pass for real fleet data. The live board reads a real `RouteManifest`
 * (pinned @platform/contracts shape) + custody truth from the custody-service;
 * here both are stand-ins. NO custody write anywhere — the board renders custody.
 */

export const SANDBOX_RIDER_NAME = 'Issa O. (démo)';

/** SE-I03: one active manifest, ordered stops — the head is the one current stop. */
export const SANDBOX_MANIFEST: RouteManifest = {
  id: 'rm-issa-1',
  riderId: 'rider-issa',
  version: 3,
  orderedStops: ['stop-gounghin', 'stop-dapoya', 'stop-tanghin'],
  custodyInventory: ['pkg-awa', 'pkg-salif'],
  status: 'active',
};

/** Landmark-first stop labels (SE0.3) — the board never shows a raw id or a street address. */
export const SANDBOX_STOP_LABELS: Record<string, string> = {
  'stop-gounghin': 'Face à la pharmacie du marché — Gounghin',
  'stop-dapoya': 'Derrière la grande mosquée — Dapoya',
  'stop-tanghin': 'Face au château d’eau — Tanghin',
};

export const SANDBOX_PKG_LABELS: Record<string, string> = {
  'pkg-awa': 'Colis pour Awa (démo)',
  'pkg-salif': 'Colis pour Salif (démo)',
};

/** Everything in cohérence: each package's task status agrees with custody. */
export const SANDBOX_CUSTODY_AGREEMENT: readonly PackageCustody[] = [
  { packageId: 'pkg-awa', currentCustodian: 'rider:issa', taskStatus: 'en_route' },
  { packageId: 'pkg-salif', currentCustodian: 'rider:issa', taskStatus: 'door_inspection' },
];

/** The ugliest bug, made visible: pkg-salif's TASK claims « delivered », but
 * custody says the rider still holds it. Custody wins → the board renders it as
 * an INCIDENT, never as agreement (PART 8 §3 · SE-I04). */
export const SANDBOX_CUSTODY_INCIDENT: readonly PackageCustody[] = [
  { packageId: 'pkg-awa', currentCustodian: 'rider:issa', taskStatus: 'en_route' },
  { packageId: 'pkg-salif', currentCustodian: 'rider:issa', taskStatus: 'delivered' },
];
