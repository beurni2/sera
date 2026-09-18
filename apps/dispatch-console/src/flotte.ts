/**
 * ═══ FLOTTE-1 (SE7.2) · the fleet desk — pure ═══
 *
 * Building-Plan SE7.2: « Vehicle docs/maintenance/fuel/odometer; DeliveryCost
 * decomposition (direct/return/allocated/fully-loaded, low/base/high);
 * utilization + deliveries/moto/day. » The desk reads the fleet book the
 * logistics Worker keeps and lets the founder type its facts. ⏳ The cost
 * hypotheses are HIS numbers: the desk carries no default figure — an unset
 * set is « à renseigner », never a guess.
 *
 * Pure: no DOM, no fetch, no clock. Every string is a CATALOG KEY. Read
 * defensively — a malformed row must not blank the desk.
 */

export const OVERHEAD_ITEMS = [
  'depreciation',
  'batteryReserve',
  'maintenance',
  'tyresBrakes',
  'insurance',
  'registration',
  'theftAccidentReserve',
  'riderPhoneData',
  'chargingInfra',
  'downtime',
  'supervision',
  'supportReconciliation',
] as const;
export type OverheadItem = (typeof OVERHEAD_ITEMS)[number];
export const SCALAR_FIELDS = ['riderCostPerShiftFcfa', 'deliveriesPerShift', 'electricityPerDeliveryFcfa', 'failedAttemptRate', 'monthlyDispatchOverheadFcfa', 'monthlyDeliveries'] as const;
export type ScalarField = (typeof SCALAR_FIELDS)[number];
export type Scenario = 'low' | 'base' | 'high';
export const SCENARIOS: readonly Scenario[] = ['low', 'base', 'high'];

export type MotoStatus = 'active' | 'maintenance' | 'retired';
export type EntryKind = 'maintenance' | 'energie' | 'compteur' | 'document';
export const ENTRY_KINDS: readonly EntryKind[] = ['maintenance', 'energie', 'compteur', 'document'];

export interface MotoRow {
  readonly vehicleId: string;
  readonly label: string;
  readonly fleetTranche: number;
  readonly status: MotoStatus;
  readonly odometerKm: number;
  readonly docs: readonly { kind: string; expiresAt: string }[];
  readonly checkedOutBy: string | null;
}
export interface EntryRow {
  readonly entryId: string;
  readonly vehicleId: string;
  readonly at: string;
  readonly kind: EntryKind;
  readonly note: string;
  readonly odometerKm: number | null;
  readonly costFcfa: number | null;
  readonly kwh: number | null;
}
export interface ShiftRow {
  readonly riderId: string;
  readonly vehicleId: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}
export interface UtilisationVue {
  readonly windowDays: number;
  readonly livrees: number;
  readonly retournees: number;
  readonly motosActives: number;
  readonly livraisonsParMotoParJour: number | null;
  readonly tauxEchec: number | null;
  readonly parMoto: readonly { vehicleId: string; label: string; livrees: number; retournees: number }[];
}
export interface DocDu {
  readonly vehicleId: string;
  readonly label: string;
  readonly kind: string;
  readonly expiresAt: string;
  readonly expire: boolean;
}
export interface FlotteVue {
  readonly motos: readonly MotoRow[];
  readonly entries: readonly EntryRow[];
  readonly shifts: readonly ShiftRow[];
  /** The founder's typed set, or null — « à renseigner ». */
  readonly hypotheses: Readonly<Record<Scenario, Readonly<Record<string, number>>>> | null;
  readonly utilisation: UtilisationVue;
  readonly documentsDus: readonly DocDu[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const STATUSES: readonly string[] = ['active', 'maintenance', 'retired'];

export function flotteVue(body: unknown): FlotteVue {
  const motos: MotoRow[] = [];
  for (const m of array(pick(body, 'motos'))) {
    const vehicleId = str(pick(m, 'vehicleId'));
    if (vehicleId === '') continue;
    const status = str(pick(m, 'status'));
    motos.push({
      vehicleId,
      label: str(pick(m, 'label')) || vehicleId,
      fleetTranche: num(pick(m, 'fleetTranche')) ?? 1,
      status: STATUSES.includes(status) ? (status as MotoStatus) : 'active',
      odometerKm: num(pick(m, 'odometerKm')) ?? 0,
      docs: array(pick(m, 'docs')).map((d) => ({ kind: str(pick(d, 'kind')), expiresAt: str(pick(d, 'expiresAt')) })).filter((d) => d.kind !== ''),
      checkedOutBy: str(pick(m, 'checkedOutBy')) || null,
    });
  }
  const entries: EntryRow[] = [];
  for (const e of array(pick(body, 'entries'))) {
    const kind = str(pick(e, 'kind'));
    if (!(ENTRY_KINDS as readonly string[]).includes(kind)) continue;
    entries.push({
      entryId: str(pick(e, 'entryId')),
      vehicleId: str(pick(e, 'vehicleId')),
      at: str(pick(e, 'at')),
      kind: kind as EntryKind,
      note: str(pick(e, 'note')),
      odometerKm: num(pick(e, 'odometerKm')),
      costFcfa: num(pick(e, 'costFcfa')),
      kwh: num(pick(e, 'kwh')),
    });
  }
  const shifts: ShiftRow[] = [];
  for (const s of array(pick(body, 'shifts'))) {
    const riderId = str(pick(s, 'riderId'));
    if (riderId === '') continue;
    shifts.push({ riderId, vehicleId: str(pick(s, 'vehicleId')) || null, startedAt: str(pick(s, 'startedAt')), endedAt: str(pick(s, 'endedAt')) || null });
  }
  const u = pick(body, 'utilisation');
  const utilisation: UtilisationVue = {
    windowDays: num(pick(u, 'windowDays')) ?? 14,
    livrees: num(pick(u, 'livrees')) ?? 0,
    retournees: num(pick(u, 'retournees')) ?? 0,
    motosActives: num(pick(u, 'motosActives')) ?? 0,
    livraisonsParMotoParJour: num(pick(u, 'livraisonsParMotoParJour')),
    tauxEchec: num(pick(u, 'tauxEchec')),
    parMoto: array(pick(u, 'parMoto')).map((p) => ({ vehicleId: str(pick(p, 'vehicleId')), label: str(pick(p, 'label')), livrees: num(pick(p, 'livrees')) ?? 0, retournees: num(pick(p, 'retournees')) ?? 0 })),
  };
  const documentsDus: DocDu[] = array(pick(body, 'documentsDus'))
    .map((d) => ({ vehicleId: str(pick(d, 'vehicleId')), label: str(pick(d, 'label')), kind: str(pick(d, 'kind')), expiresAt: str(pick(d, 'expiresAt')), expire: pick(d, 'expire') === true }))
    .filter((d) => d.kind !== '');
  const rawH = pick(body, 'hypotheses');
  let hypotheses: FlotteVue['hypotheses'] = null;
  if (rawH !== null && typeof rawH === 'object') {
    const set: Partial<Record<Scenario, Record<string, number>>> = {};
    let whole = true;
    for (const s of SCENARIOS) {
      const h = pick(rawH, s);
      if (h === null) { whole = false; break; }
      const flat: Record<string, number> = {};
      for (const f of SCALAR_FIELDS) {
        const v = num(pick(h, f));
        if (v === null) { whole = false; break; }
        flat[f] = v;
      }
      for (const item of OVERHEAD_ITEMS) {
        const v = num(pick(pick(h, 'monthlyFleetOverheadFcfa'), item));
        if (v === null) { whole = false; break; }
        flat[item] = v;
      }
      set[s] = flat;
    }
    if (whole) hypotheses = set as Record<Scenario, Record<string, number>>;
  }
  return { motos, entries, shifts, hypotheses, utilisation, documentsDus };
}

export interface CoutLigne {
  readonly directDeliveryCost: number;
  readonly returnDeliveryCost: number;
  readonly allocatedFleetOverhead: number;
  readonly allocatedDispatchOverhead: number;
  readonly fullyLoadedDeliveryCost: number;
  readonly deliveryFunding: number;
  readonly deliveryContributionMargin: number;
}
export const COUT_LIGNES = ['directDeliveryCost', 'returnDeliveryCost', 'allocatedFleetOverhead', 'allocatedDispatchOverhead', 'fullyLoadedDeliveryCost', 'deliveryFunding', 'deliveryContributionMargin'] as const;

/** The three scenarios off the cost door; null when any line is missing — a half table is a half truth. */
export function coutsVue(body: unknown): Readonly<Record<Scenario, CoutLigne>> | null {
  const couts = pick(body, 'couts');
  const out: Partial<Record<Scenario, CoutLigne>> = {};
  for (const s of SCENARIOS) {
    const c = pick(couts, s);
    const ligne: Partial<Record<(typeof COUT_LIGNES)[number], number>> = {};
    for (const k of COUT_LIGNES) {
      const v = num(pick(c, k));
      if (v === null || !Number.isInteger(v)) return null;
      ligne[k] = v;
    }
    out[s] = ligne as CoutLigne;
  }
  return out as Record<Scenario, CoutLigne>;
}

/**
 * The founder's typed hypotheses — 18 fields × 3 scenarios, as the form's
 * strings — into the door's shape. Any field that is not a whole number
 * (the rate: a number in [0, 1)) refuses the WHOLE set, and names the field.
 */
export function hypothesesDepuisSaisie(saisie: Readonly<Record<string, string>>): { ok: true; hypotheses: Record<Scenario, Record<string, unknown>> } | { ok: false; champ: string } {
  const out: Partial<Record<Scenario, Record<string, unknown>>> = {};
  for (const s of SCENARIOS) {
    const h: Record<string, unknown> = {};
    const items: Record<string, number> = {};
    for (const f of SCALAR_FIELDS) {
      const raw = (saisie[`${s}.${f}`] ?? '').trim().replace(',', '.');
      const v = Number(raw);
      if (raw === '' || !Number.isFinite(v)) return { ok: false, champ: `${s}.${f}` };
      if (f === 'failedAttemptRate') {
        if (v < 0 || v >= 1) return { ok: false, champ: `${s}.${f}` };
        h[f] = v;
      } else {
        if (!Number.isInteger(v) || v < 0) return { ok: false, champ: `${s}.${f}` };
        h[f] = v;
      }
    }
    for (const item of OVERHEAD_ITEMS) {
      const raw = (saisie[`${s}.${item}`] ?? '').trim();
      const v = Number(raw);
      if (raw === '' || !Number.isInteger(v) || v < 0) return { ok: false, champ: `${s}.${item}` };
      items[item] = v;
    }
    h['monthlyFleetOverheadFcfa'] = items;
    out[s] = h;
  }
  return { ok: true, hypotheses: out as Record<Scenario, Record<string, unknown>> };
}

/** The stored set back into the form's strings, so what he typed comes back to him. */
export function saisieDepuisHypotheses(set: NonNullable<FlotteVue['hypotheses']>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of SCENARIOS) {
    for (const [k, v] of Object.entries(set[s])) out[`${s}.${k}`] = String(v);
  }
  return out;
}

export function motoStatutKey(status: MotoStatus): string {
  return status === 'active' ? 'flotte.statut_active' : status === 'maintenance' ? 'flotte.statut_maintenance' : 'flotte.statut_retiree';
}
export function entreeKey(kind: EntryKind): string {
  switch (kind) {
    case 'maintenance':
      return 'flotte.entree_maintenance';
    case 'energie':
      return 'flotte.entree_energie';
    case 'compteur':
      return 'flotte.entree_compteur';
    case 'document':
      return 'flotte.entree_document';
  }
}
export function flotteRefusKey(reason: string): string {
  switch (reason) {
    case 'odometer_goes_backwards':
      return 'flotte.refus_compteur';
    case 'unknown_vehicle':
      return 'flotte.refus_moto_inconnue';
    case 'unknown_rider':
      return 'flotte.refus_coursier_inconnu';
    case 'hypotheses_malformees':
      return 'flotte.refus_hypotheses';
    case 'hypotheses_absentes':
      return 'flotte.hypotheses_absentes';
    case 'malformed':
      return 'flotte.refus_saisie';
    default:
      return 'flotte.echec';
  }
}

/** Francs, spaced by thousands, the money register's plain figure. */
export function francs(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(n));
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} F`;
}

function pick(value: unknown, key: string | null): unknown {
  if (value === null || typeof value !== 'object') return null;
  return key === null ? value : ((value as Record<string, unknown>)[key] ?? null);
}
function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
