/**
 * ═══ MANIFESTE-1 · the riders' manifests and the end-shift exception — pure ═══
 *
 * SE-I03: « A courier has at most one active RouteManifest and one current
 * stop. » SE3.1: « Ordered manifest; one active route + one current stop;
 * package accounted at close; cancelled task can't leave custody inventory. »
 * SE3.2: « End-shift-with-custody exception — mandatory transfer/hub
 * exception. » The desk reads the manifests logistics DERIVES from its book
 * and custody's own word, and lets the founder authorize — by name, naming
 * the package's next owner — a carrying rider's end of service.
 *
 * Pure: no DOM, no fetch, no clock. Every string is a CATALOG KEY (Contract
 * §10.5). Read defensively — a malformed row must not blank the desk.
 */

export type EtapeKind = 'ramassage' | 'livraison' | 'retour';
export type NextOwnerKind = 'return_to_hub_task' | 'reassignment';
export interface NextOwner {
  readonly kind: NextOwnerKind;
  readonly ref: string;
}

export interface ManifesteRow {
  readonly riderId: string;
  readonly riderName: string;
  /** The ONE current stop — or none (a package with no course: the desk's turn). */
  readonly currentStop: { readonly kind: EtapeKind; readonly orderId: string } | null;
  readonly stopsCount: number;
  /** What the ledger places with him, as last heard. */
  readonly packageIds: readonly string[];
  /** A course whose custody could not be read: said, never hidden. */
  readonly lectureInconnue: boolean;
  /** The pending end-shift exception, if the founder already gave one. */
  readonly finDeService: { readonly nextOwner: NextOwnerKind; readonly packageIds: readonly string[]; readonly at: string } | null;
}

const ETAPES: readonly string[] = ['ramassage', 'livraison', 'retour'];
const OWNERS: readonly string[] = ['return_to_hub_task', 'reassignment'];

export function manifesteRows(body: unknown): readonly ManifesteRow[] {
  const board = pick(pick(body, 'board'), null);
  const riders = new Map<string, string>();
  for (const entry of array(pick(board, 'riders'))) {
    const riderId = str(pick(entry, 'riderId'));
    if (riderId === '') continue;
    const name = str(pick(entry, 'displayName'));
    riders.set(riderId, name === '' ? riderId : name);
  }
  const pending = pick(board, 'finDeService');
  const rows: ManifesteRow[] = [];
  const manifestes = pick(board, 'manifestes');
  if (manifestes === null || typeof manifestes !== 'object') return rows;
  for (const [riderId, raw] of Object.entries(manifestes as Record<string, unknown>)) {
    if (riderId === '') continue;
    const stop = pick(raw, 'currentStop');
    const kind = str(pick(stop, 'kind'));
    const orderId = str(pick(stop, 'orderId'));
    const readings = array(pick(raw, 'custodyReadings'));
    const fin = pick(pending, riderId);
    const finKind = str(pick(pick(fin, 'nextOwner'), 'kind'));
    rows.push({
      riderId,
      riderName: riders.get(riderId) ?? riderId,
      currentStop: ETAPES.includes(kind) && orderId !== '' ? { kind: kind as EtapeKind, orderId } : null,
      stopsCount: array(pick(raw, 'stops')).length,
      packageIds: array(pick(raw, 'custodyInventory')).map(str).filter((id) => id !== ''),
      lectureInconnue: readings.some((r) => str(pick(r, 'reading')) === 'inconnue'),
      finDeService:
        fin !== null && OWNERS.includes(finKind)
          ? { nextOwner: finKind as NextOwnerKind, packageIds: array(pick(fin, 'packageIds')).map(str).filter((id) => id !== ''), at: str(pick(fin, 'at')) }
          : null,
    });
  }
  return rows.sort((a, b) => (a.riderName < b.riderName ? -1 : a.riderName > b.riderName ? 1 : a.riderId < b.riderId ? -1 : 1));
}

export function etapeKey(kind: EtapeKind): string {
  switch (kind) {
    case 'ramassage':
      return 'manifeste.etape_ramassage';
    case 'livraison':
      return 'manifeste.etape_livraison';
    case 'retour':
      return 'manifeste.etape_retour';
  }
}

export function nextOwnerKey(kind: NextOwnerKind): string {
  return kind === 'return_to_hub_task' ? 'fin_service.base' : 'fin_service.autre_coursier';
}

/** A door refusal, in the founder's words. */
export function finRefusKey(reason: string): string {
  switch (reason) {
    case 'rider_not_carrying':
      return 'fin_service.refus_pas_de_colis';
    case 'custody_unverifiable':
      return 'fin_service.refus_garde_illisible';
    default:
      return 'fin_service.echec';
  }
}

/**
 * The desk's own state: ONE confirmation card open at a time, ONE act in
 * flight, the command id minted once per request and REUSED on a retry (the
 * door replays by id, so a retry can never authorize twice).
 */
export interface FinServiceUi {
  /** The rider whose confirmation card is open, with the id minted for it. */
  readonly demande: { readonly riderId: string; readonly commandId: string } | null;
  readonly encours: string | null;
  readonly faits: readonly string[];
  readonly echecs: Readonly<Record<string, string>>;
}

export const FIN_SERVICE_IDLE: FinServiceUi = { demande: null, encours: null, faits: [], echecs: {} };

export function demanderFin(ui: FinServiceUi, riderId: string, commandId: string): FinServiceUi {
  if (ui.encours !== null) return ui;
  // A retry on the same rider keeps the id it already minted.
  const reuse = ui.demande !== null && ui.demande.riderId === riderId ? ui.demande.commandId : commandId;
  return { ...ui, demande: { riderId, commandId: reuse } };
}

export function annulerFin(ui: FinServiceUi): FinServiceUi {
  return ui.encours !== null ? ui : { ...ui, demande: null };
}

/** Commit: only the rider whose card is open, only when nothing is in flight. */
export function commencerFin(ui: FinServiceUi, riderId: string): { ui: FinServiceUi; commandId: string } | null {
  if (ui.encours !== null || ui.demande === null || ui.demande.riderId !== riderId) return null;
  const { [riderId]: _gone, ...echecs } = ui.echecs;
  return { ui: { ...ui, encours: riderId, echecs }, commandId: ui.demande.commandId };
}

export function finFaite(ui: FinServiceUi, riderId: string): FinServiceUi {
  return { ...ui, demande: null, encours: null, faits: ui.faits.includes(riderId) ? ui.faits : [...ui.faits, riderId] };
}

/** The card stays open on a refusal — the way out is the founder's, never a dead end. */
export function finEchouee(ui: FinServiceUi, riderId: string, reasonKey: string): FinServiceUi {
  return { ...ui, encours: null, echecs: { ...ui.echecs, [riderId]: reasonKey } };
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
