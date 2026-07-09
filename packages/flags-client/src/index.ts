/**
 * Read-only flag / kill-switch CLIENT stub (Execution Contract §7.2).
 * Shop+ consumes a remotely served snapshot; it never writes flag state.
 * The flag/kill-switch service is ecosystem infrastructure (E0 harness),
 * not built in this repo.
 */

/** §7.2: "Kill switches: checkout · dispatch · payout · any single product category." */
export const KILL_SWITCHES = ['checkout', 'dispatch', 'payout', 'category'] as const;
export type KillSwitch = (typeof KILL_SWITCHES)[number];

export interface FlagSnapshot {
  /** Snapshot version from the flag service — consumers never mutate it. */
  version: string;
  flags: Readonly<Record<string, boolean>>;
  /** Killed switches; for 'category' the killed category ids. */
  kills: readonly KillSwitch[];
  killedCategories: readonly string[];
}

/** Fail-safe default: nothing enabled, nothing killed, until a snapshot arrives. */
export const EMPTY_SNAPSHOT: FlagSnapshot = {
  version: 'none',
  flags: {},
  kills: [],
  killedCategories: [],
};

/** A capability behind a flag is OFF unless the snapshot explicitly enables it. */
export function isEnabled(snapshot: FlagSnapshot, flag: string): boolean {
  return snapshot.flags[flag] === true;
}

export function isKilled(snapshot: FlagSnapshot, kill: KillSwitch, categoryId?: string): boolean {
  if (kill === 'category') {
    return categoryId !== undefined && snapshot.killedCategories.includes(categoryId);
  }
  return snapshot.kills.includes(kill);
}

/** Parse a snapshot served by the flag service. Throws on malformed input — a bad snapshot must never half-apply. */
export function parseSnapshot(raw: unknown): FlagSnapshot {
  if (typeof raw !== 'object' || raw === null) throw new Error('flag snapshot: not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o['version'] !== 'string') throw new Error('flag snapshot: missing version');
  const flags = o['flags'];
  if (typeof flags !== 'object' || flags === null) throw new Error('flag snapshot: missing flags');
  for (const [k, v] of Object.entries(flags)) {
    if (typeof v !== 'boolean') throw new Error(`flag snapshot: flag ${k} is not boolean`);
  }
  const kills = Array.isArray(o['kills']) ? o['kills'] : undefined;
  if (kills === undefined) throw new Error('flag snapshot: missing kills');
  for (const k of kills) {
    if (!(KILL_SWITCHES as readonly string[]).includes(k as string)) {
      throw new Error(`flag snapshot: unknown kill switch ${String(k)}`);
    }
  }
  const killedCategories = Array.isArray(o['killedCategories']) ? o['killedCategories'] : undefined;
  if (killedCategories === undefined) throw new Error('flag snapshot: missing killedCategories');
  for (const c of killedCategories) {
    if (typeof c !== 'string') throw new Error('flag snapshot: killedCategories must be strings');
  }
  return {
    version: o['version'],
    flags: { ...(flags as Record<string, boolean>) },
    kills: kills as KillSwitch[],
    killedCategories: killedCategories as string[],
  };
}
