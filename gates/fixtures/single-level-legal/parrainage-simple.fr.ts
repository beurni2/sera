// POSITIVE FIXTURE (AUDIT-B+1 F2) — WHAT THE single-level GATE MUST NOT BREAK.
//
// The audit recommended banning `parrain`, `filleul` and `cooptation` outright.
// That would have failed the build on a SHIPPED, founder-designed capability:
// Shop+'s Cercle carries a parrainage tile whose own comment reads
// « single-level, forever (loi 1) »
// (shop-plus `apps/reseller-app/src/cercle/screens.tsx:409`) — 12 occurrences
// across 3 files, all under scanned roots.
//
// Law 9 forbids a SECOND level — networks under networks, depth, trees, and
// commissions earned on someone else's sign-up. It does not forbid a
// single-level parrainage the founder designed and approved. A gate that fails
// an approved capability is not enforcement, it is breakage, and it teaches
// everyone to pass --no-verify.
//
// (This comment deliberately does not SPELL the banned vocabulary. It cannot:
// this file is scanned, and prose about a defect matches a scan for it. That
// is the whole point — if the words were here, the fixture would prove nothing.)
//
// This fixture is the standing proof of that boundary: the single-level gate
// MUST PASS on this file. If a future pattern makes it fail, that pattern is
// wrong — not this file. Never import this.
export interface Parrainage {
  marraineId: string;
  filleuleId: string; // one level. There is no level below this, by design.
  invitéeLe: string;
}

/** Une marraine invite une revendeuse. Un seul niveau, pour toujours (loi 1). */
export function inviterUneFilleule(marraineId: string, filleuleId: string): Parrainage {
  return { marraineId, filleuleId, invitéeLe: new Date().toISOString() };
}

/** La marraine voit ses filleules. Elle ne voit rien en dessous : il n'y a rien. */
export function mesFilleules(liens: Parrainage[], marraineId: string): string[] {
  return liens.filter((l) => l.marraineId === marraineId).map((l) => l.filleuleId);
}
