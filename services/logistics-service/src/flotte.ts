import type { CostHypothesesSet } from './delivery-cost.js';

/**
 * ═══ FLOTTE-1 (SE7.2) — fleet and shift RECORDS, pure ═══
 *
 * Building-Plan SE7.2: « Vehicle docs/maintenance/fuel/odometer; DeliveryCost
 * decomposition (direct/return/allocated/fully-loaded, low/base/high);
 * utilization + deliveries/moto/day. » Sera-Build-Spec §5: « RiderProfile ·
 * RiderShift · Motorcycle{ fleetTranche } » (Séra-local shapes — no canon
 * schema exists for them; `fleetTranche` is the one field canon names,
 * because §7.2's release gates key on it — SE7.3, the NEXT slice, not this).
 *
 * WHAT THIS IS: a book of facts the founder types (a motorcycle, its papers,
 * a maintenance line, an odometer reading, a charge) and facts the system
 * records by itself (a shift opened and closed by the registry's own doors,
 * a delivery or a return counted the instant custody's wire closes the
 * course, on the vehicle the rider had that shift). Utilization is DERIVED
 * from the log — never a counter kept somewhere else — over a window.
 *
 * WHAT THIS IS NOT: no fee math (SE-I09), no payroll (SE7.3), no release
 * gate (SE7.3), no ETA or route model (Law 5). Every figure is a count or a
 * franc the founder typed.
 */

export type MotoStatus = 'active' | 'maintenance' | 'retired';
export const MOTO_STATUSES: readonly MotoStatus[] = ['active', 'maintenance', 'retired'];

export interface VehicleDoc {
  readonly kind: string;
  /** ISO date; the desk flags it when due. */
  readonly expiresAt: string;
}

export interface Motorcycle {
  readonly vehicleId: string;
  readonly label: string;
  /** §7.2 — the tranche this moto belongs to (1 = the first 3–5). */
  readonly fleetTranche: number;
  readonly status: MotoStatus;
  readonly odometerKm: number;
  readonly docs: readonly VehicleDoc[];
  /** The rider it is checked out to, if any — set by the desk. */
  readonly checkedOutBy: string | null;
  readonly declaredAt: string;
}

export type EntryKind = 'maintenance' | 'energie' | 'compteur' | 'document';
export const ENTRY_KINDS: readonly EntryKind[] = ['maintenance', 'energie', 'compteur', 'document'];

export interface FleetEntry {
  readonly entryId: string;
  readonly vehicleId: string;
  readonly at: string;
  readonly kind: EntryKind;
  readonly note: string;
  readonly odometerKm: number | null;
  readonly costFcfa: number | null;
  readonly kwh: number | null;
  readonly doc: VehicleDoc | null;
}

export interface ShiftRecord {
  readonly shiftId: string;
  readonly riderId: string;
  readonly vehicleId: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

/** One closed course, as custody's wire closed it, on the vehicle the rider had. */
export interface CourseLog {
  readonly at: string;
  readonly orderId: string;
  readonly riderId: string;
  readonly vehicleId: string | null;
  readonly kind: 'livree' | 'retournee';
}

export interface FlotteSnapshot {
  readonly motos: Readonly<Record<string, Motorcycle>>;
  readonly entries: readonly FleetEntry[];
  readonly shifts: readonly ShiftRecord[];
  readonly courses: readonly CourseLog[];
  /** ⏳ the founder's cost hypotheses — null until he types them. */
  readonly hypotheses: CostHypothesesSet | null;
  /** command_id → the id it produced: a retried act produces nothing twice. */
  readonly replays: Readonly<Record<string, string>>;
}

export const FLOTTE_VIDE: FlotteSnapshot = { motos: {}, entries: [], shifts: [], courses: [], hypotheses: null, replays: {} };

const isKm = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isFranc = isKm;
const isIsoDate = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

export type FlotteRefusal = 'malformed' | 'unknown_vehicle' | 'odometer_goes_backwards';

export interface DeclareMotoCommand {
  readonly commandId: string;
  readonly vehicleId?: string;
  readonly label: string;
  readonly fleetTranche: number;
  readonly status?: MotoStatus;
  readonly odometerKm?: number;
}

/** Declare a moto, or amend its label / tranche / status by id. */
export function declareMoto(
  snap: FlotteSnapshot,
  cmd: DeclareMotoCommand,
  now: string,
  mintId: () => string,
): { ok: true; snap: FlotteSnapshot; moto: Motorcycle; replayed: boolean } | { ok: false; reason: FlotteRefusal } {
  const replayed = snap.replays[cmd.commandId];
  if (replayed !== undefined) {
    const moto = snap.motos[replayed];
    return moto === undefined ? { ok: false, reason: 'unknown_vehicle' } : { ok: true, snap, moto, replayed: true };
  }
  if (
    typeof cmd.label !== 'string' || cmd.label.trim() === '' ||
    !Number.isInteger(cmd.fleetTranche) || cmd.fleetTranche < 1 ||
    (cmd.status !== undefined && !MOTO_STATUSES.includes(cmd.status)) ||
    (cmd.odometerKm !== undefined && !isKm(cmd.odometerKm))
  ) {
    return { ok: false, reason: 'malformed' };
  }
  const existing = cmd.vehicleId === undefined ? undefined : snap.motos[cmd.vehicleId];
  if (cmd.vehicleId !== undefined && existing === undefined) return { ok: false, reason: 'unknown_vehicle' };
  const moto: Motorcycle =
    existing === undefined
      ? {
          vehicleId: mintId(),
          label: cmd.label.trim(),
          fleetTranche: cmd.fleetTranche,
          status: cmd.status ?? 'active',
          odometerKm: cmd.odometerKm ?? 0,
          docs: [],
          checkedOutBy: null,
          declaredAt: now,
        }
      : { ...existing, label: cmd.label.trim(), fleetTranche: cmd.fleetTranche, status: cmd.status ?? existing.status, odometerKm: cmd.odometerKm ?? existing.odometerKm };
  return {
    ok: true,
    replayed: false,
    moto,
    snap: { ...snap, motos: { ...snap.motos, [moto.vehicleId]: moto }, replays: { ...snap.replays, [cmd.commandId]: moto.vehicleId } },
  };
}

export interface AddEntryCommand {
  readonly commandId: string;
  readonly vehicleId: string;
  readonly kind: EntryKind;
  readonly at?: string;
  readonly note?: string;
  readonly odometerKm?: number;
  readonly costFcfa?: number;
  readonly kwh?: number;
  readonly doc?: { kind: string; expiresAt: string };
}

/** A maintenance line, a charge, an odometer reading, or a document with its expiry. */
export function addEntry(
  snap: FlotteSnapshot,
  cmd: AddEntryCommand,
  now: string,
  mintId: () => string,
): { ok: true; snap: FlotteSnapshot; entry: FleetEntry; replayed: boolean } | { ok: false; reason: FlotteRefusal } {
  const replayed = snap.replays[cmd.commandId];
  if (replayed !== undefined) {
    const entry = snap.entries.find((e) => e.entryId === replayed);
    return entry === undefined ? { ok: false, reason: 'malformed' } : { ok: true, snap, entry, replayed: true };
  }
  const moto = snap.motos[cmd.vehicleId];
  if (moto === undefined) return { ok: false, reason: 'unknown_vehicle' };
  if (
    !ENTRY_KINDS.includes(cmd.kind) ||
    (cmd.at !== undefined && !isIsoDate(cmd.at)) ||
    (cmd.note !== undefined && typeof cmd.note !== 'string') ||
    (cmd.odometerKm !== undefined && !isKm(cmd.odometerKm)) ||
    (cmd.costFcfa !== undefined && !isFranc(cmd.costFcfa)) ||
    (cmd.kwh !== undefined && !(typeof cmd.kwh === 'number' && Number.isFinite(cmd.kwh) && cmd.kwh >= 0)) ||
    (cmd.kind === 'document' && (cmd.doc === undefined || typeof cmd.doc.kind !== 'string' || cmd.doc.kind.trim() === '' || !isIsoDate(cmd.doc.expiresAt))) ||
    (cmd.kind === 'compteur' && cmd.odometerKm === undefined)
  ) {
    return { ok: false, reason: 'malformed' };
  }
  // An odometer only climbs: a lower reading is a slip of the thumb, refused by name.
  if (cmd.odometerKm !== undefined && cmd.odometerKm < moto.odometerKm) return { ok: false, reason: 'odometer_goes_backwards' };
  const entry: FleetEntry = {
    entryId: mintId(),
    vehicleId: cmd.vehicleId,
    at: cmd.at ?? now,
    kind: cmd.kind,
    note: (cmd.note ?? '').trim(),
    odometerKm: cmd.odometerKm ?? null,
    costFcfa: cmd.costFcfa ?? null,
    kwh: cmd.kwh ?? null,
    doc: cmd.doc === undefined ? null : { kind: cmd.doc.kind.trim(), expiresAt: cmd.doc.expiresAt },
  };
  const docs = entry.doc === null ? moto.docs : [...moto.docs.filter((d) => d.kind !== entry.doc!.kind), entry.doc];
  const next: Motorcycle = { ...moto, odometerKm: cmd.odometerKm ?? moto.odometerKm, docs };
  return {
    ok: true,
    replayed: false,
    entry,
    snap: { ...snap, motos: { ...snap.motos, [moto.vehicleId]: next }, entries: [...snap.entries, entry], replays: { ...snap.replays, [cmd.commandId]: entry.entryId } },
  };
}

/** Hand a moto to a rider (or take it back with `null`); one moto per rider. */
export function confierMoto(snap: FlotteSnapshot, vehicleId: string, riderId: string | null): { ok: true; snap: FlotteSnapshot } | { ok: false; reason: FlotteRefusal } {
  const moto = snap.motos[vehicleId];
  if (moto === undefined) return { ok: false, reason: 'unknown_vehicle' };
  const motos: Record<string, Motorcycle> = { ...snap.motos };
  if (riderId !== null) {
    for (const [id, m] of Object.entries(motos)) if (m.checkedOutBy === riderId && id !== vehicleId) motos[id] = { ...m, checkedOutBy: null };
  }
  motos[vehicleId] = { ...moto, checkedOutBy: riderId };
  return { ok: true, snap: { ...snap, motos } };
}

export function motoOf(snap: FlotteSnapshot, riderId: string): Motorcycle | undefined {
  return Object.values(snap.motos).find((m) => m.checkedOutBy === riderId);
}

/** The registry confirmed a shift START: one open record, on the rider's moto. */
export function openShift(snap: FlotteSnapshot, riderId: string, now: string, mintId: () => string): FlotteSnapshot {
  if (snap.shifts.some((s) => s.riderId === riderId && s.endedAt === null)) return snap;
  const row: ShiftRecord = { shiftId: mintId(), riderId, vehicleId: motoOf(snap, riderId)?.vehicleId ?? null, startedAt: now, endedAt: null };
  return { ...snap, shifts: [...snap.shifts, row] };
}

/** The registry confirmed a shift END: the open record closes. */
export function closeShift(snap: FlotteSnapshot, riderId: string, now: string): FlotteSnapshot {
  const idx = snap.shifts.findIndex((s) => s.riderId === riderId && s.endedAt === null);
  if (idx < 0) return snap;
  const shifts = snap.shifts.slice();
  shifts[idx] = { ...shifts[idx]!, endedAt: now };
  return { ...snap, shifts };
}

/** Custody's wire closed a course: counted once per order, on the rider's moto. */
export function logCourse(snap: FlotteSnapshot, args: { orderId: string; riderId: string; kind: 'livree' | 'retournee'; at: string }): FlotteSnapshot {
  if (snap.courses.some((c) => c.orderId === args.orderId && c.kind === args.kind)) return snap;
  const open = snap.shifts.find((s) => s.riderId === args.riderId && s.endedAt === null);
  const vehicleId = open?.vehicleId ?? motoOf(snap, args.riderId)?.vehicleId ?? null;
  return { ...snap, courses: [...snap.courses, { at: args.at, orderId: args.orderId, riderId: args.riderId, vehicleId, kind: args.kind }] };
}

export interface Utilisation {
  readonly windowDays: number;
  readonly since: string;
  readonly livrees: number;
  readonly retournees: number;
  readonly motosActives: number;
  /** null when no moto is declared — never a division by an invented fleet. */
  readonly livraisonsParMotoParJour: number | null;
  /** returns / (deliveries + returns); null with no course in the window. */
  readonly tauxEchec: number | null;
  readonly parMoto: readonly { vehicleId: string; label: string; livrees: number; retournees: number }[];
}

/** Deliveries per moto per day over the window (§7.2's own yardstick), derived. */
export function utilisation(snap: FlotteSnapshot, now: string, windowDays = 14): Utilisation {
  const sinceMs = Date.parse(now) - windowDays * 86_400_000;
  const since = new Date(sinceMs).toISOString();
  const inWindow = snap.courses.filter((c) => Date.parse(c.at) >= sinceMs && Date.parse(c.at) <= Date.parse(now));
  const livrees = inWindow.filter((c) => c.kind === 'livree').length;
  const retournees = inWindow.filter((c) => c.kind === 'retournee').length;
  const actives = Object.values(snap.motos).filter((m) => m.status === 'active');
  const parMoto = actives
    .map((m) => ({
      vehicleId: m.vehicleId,
      label: m.label,
      livrees: inWindow.filter((c) => c.vehicleId === m.vehicleId && c.kind === 'livree').length,
      retournees: inWindow.filter((c) => c.vehicleId === m.vehicleId && c.kind === 'retournee').length,
    }))
    .sort((a, b) => (a.label < b.label ? -1 : 1));
  const total = livrees + retournees;
  return {
    windowDays,
    since,
    livrees,
    retournees,
    motosActives: actives.length,
    livraisonsParMotoParJour: actives.length === 0 ? null : Math.round((livrees / (actives.length * windowDays)) * 100) / 100,
    tauxEchec: total === 0 ? null : Math.round((retournees / total) * 1000) / 1000,
    parMoto,
  };
}

/** Documents already past their date, or due within `withinDays`. */
export function documentsDus(snap: FlotteSnapshot, now: string, withinDays = 30): readonly { vehicleId: string; label: string; kind: string; expiresAt: string; expire: boolean }[] {
  const nowMs = Date.parse(now);
  const limit = nowMs + withinDays * 86_400_000;
  const out: { vehicleId: string; label: string; kind: string; expiresAt: string; expire: boolean }[] = [];
  for (const m of Object.values(snap.motos)) {
    if (m.status === 'retired') continue;
    for (const d of m.docs) {
      const at = Date.parse(d.expiresAt);
      if (!Number.isFinite(at) || at > limit) continue;
      out.push({ vehicleId: m.vehicleId, label: m.label, kind: d.kind, expiresAt: d.expiresAt, expire: at < nowMs });
    }
  }
  return out.sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : 1));
}
