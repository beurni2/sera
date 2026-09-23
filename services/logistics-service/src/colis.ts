import { OrderPackageSchema } from '@platform/contracts';

/**
 * ═══ COLIS-FOURNISSEUR-1 — ONE COURSE, ONE PACKAGE, SEVERAL ORDERS ═══
 *
 * Founder ruling 2026-09-23 (« Proceed with your recommendations », then
 * « build option 1 »), canon 3.20.0, Sera-Build-Spec SE3: « a package may
 * hold the orders of ONE supplier, for ONE buyer, to ONE address, paid
 * together; it is still one job — one pickup, one drop, one current stop —
 * and each order keeps its own custody file, its own inspection at the door
 * and its own drop. »
 *
 * So the course stays ONE task and ONE assignment (SE-I01, one lease, one
 * current stop — untouched), and the package is the list of orders that
 * course carries. The first order of the list names the task; every order
 * keeps its own custody chain, opened under its own `pkg-<orderId>` — at the
 * door the bag can split (decision c: one article refused, the rest kept),
 * and one custodian per ARTICLE is the only reading of SE-I04 that survives
 * that split.
 *
 * WHO SAYS WHICH ORDERS TRAVEL TOGETHER: Shop+, on each order's funding fact
 * (the canon `OrderPackageSchema`, the same package every member names). This
 * module never groups by itself — no supplier, no address, no guess.
 */

export interface ColisMembership {
  readonly packageId: string;
  /** Every order in the package, in the package's own order. */
  readonly orderIds: readonly string[];
}

/** The package a funding fact names — `undefined` when it names none,
 *  `'malformed'` when what it names is not a package this order is in. */
export function lireColis(raw: unknown, orderId: string): ColisMembership | 'malformed' | undefined {
  if (raw === undefined) return undefined;
  const parsed = OrderPackageSchema.safeParse(raw);
  if (!parsed.success) return 'malformed';
  if (!parsed.data.orderIds.includes(orderId)) return 'malformed';
  return { packageId: parsed.data.packageId, orderIds: [...parsed.data.orderIds] };
}

export function memeColis(a: ColisMembership | undefined, b: ColisMembership | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return (
    a.packageId === b.packageId &&
    a.orderIds.length === b.orderIds.length &&
    a.orderIds.every((id, i) => b.orderIds[i] === id)
  );
}

/**
 * The orders of this order's package that still TRAVEL: every member whose
 * funding fact is not `cancelled`, in the package's own order — the first is
 * the course's own. An order alone is its own list.
 *
 * `'incomplet'` when a member has no funding fact yet, or names a different
 * package: the course waits for every member's word rather than leaving
 * with half a bag nobody decided on.
 */
export function voyageurs(
  orderId: string,
  colisDe: Readonly<Record<string, ColisMembership>>,
  statutFinancement: (orderId: string) => string | undefined,
): string[] | 'incomplet' {
  const colis = colisDe[orderId];
  if (colis === undefined) return [orderId];
  for (const membre of colis.orderIds) {
    if (!memeColis(colisDe[membre], colis)) return 'incomplet';
    if (statutFinancement(membre) === undefined) return 'incomplet';
  }
  return colis.orderIds.filter((membre) => statutFinancement(membre) !== 'cancelled');
}

/** How each order of a course ended, as custody's own wires said it. */
export type Reglement = 'livree' | 'retournee';

/** The course is over when every order it carries is delivered or home. */
export function colisRegle(orderIds: readonly string[], reglement: Readonly<Record<string, Reglement>>): boolean {
  return orderIds.every((id) => reglement[id] !== undefined);
}
