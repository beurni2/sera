import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare } from 'miniflare';

/**
 * The REAL custody Worker behind logistics' `CUSTODY` binding, for a test
 * whose subject is not custody but whose door now asks it: an accepted course
 * is taken back or cleared only once custody says its goods were not checked
 * and left unsealed, and an unwired custody refuses (never a guess). Nothing
 * here answers in custody's place; the rider door is not wired (no test
 * using this drives a rider act at custody).
 */
export const PRODUCE_KEY_REEL = 'test-produce-key-reelle';
const SCRIPT = join(import.meta.dirname, '..', '..', 'custody-service', 'dist-worker', 'worker.mjs');

export function custodyReelle(live: Miniflare[]): (request: Request) => Promise<Response> {
  const mf = new Miniflare({
    modules: [{ type: 'ESModule', path: 'custody-worker.mjs', contents: readFileSync(SCRIPT, 'utf8') }],
    compatibilityDate: '2025-07-05',
    compatibilityFlags: ['nodejs_compat'],
    durableObjects: { CUSTODY: 'CustodyDO', PACKAGE_CLAIM: 'PackageClaimDO' },
    durableObjectsPersist: mkdtempSync(join(tmpdir(), 'custody-reelle-')),
    bindings: { SERA_CUSTODY_OPS_SECRET: 'test-custody-ops-reelle', SERA_PRODUCE_SECRET: PRODUCE_KEY_REEL },
  });
  live.push(mf);
  return (request) => mf.dispatchFetch(request.url, request as never) as never;
}
