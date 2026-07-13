import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveRiderBoard, isDivergence, type PackageCustody } from '../src/board';
import type { RouteManifest } from '@platform/contracts';

/**
 * WO-6.9-c · D3 live board — SE-I03 · SE-I04 · task status is never custody
 * truth (divergence renders AS AN INCIDENT), and the console-cannot-write-custody
 * absence proof (the D1 structural pattern: prove the ABSENCE of any lever).
 */

const manifest = (over: Partial<RouteManifest> = {}): RouteManifest => ({
  id: 'rm-issa-1',
  riderId: 'rider-issa',
  version: 1,
  orderedStops: ['stop-1', 'stop-2', 'stop-3'],
  custodyInventory: ['pkg-1'],
  status: 'active',
  ...over,
});
const held = (over: Partial<PackageCustody> = {}): PackageCustody => ({
  packageId: 'pkg-1',
  currentCustodian: 'rider:issa',
  taskStatus: 'en_route',
  ...over,
});

describe('WO-6.9-c D3 — the live board read-model', () => {
  it('SE-I03: exactly ONE current stop (the head of orderedStops); the rest are upcoming', () => {
    const b = deriveRiderBoard(manifest(), [held()]);
    expect(b.currentStop).toBe('stop-1');
    expect(b.upcomingStops).toEqual(['stop-2', 'stop-3']);
    // an empty manifest has NO current stop — never a fabricated one
    expect(deriveRiderBoard(manifest({ orderedStops: [] }), [held()]).currentStop).toBeNull();
  });

  it('SE-I04: exactly ONE current custodian per package; a manifest package with no custody record THROWS (never unowned)', () => {
    const b = deriveRiderBoard(manifest(), [held()]);
    expect(b.packages).toHaveLength(1);
    expect(b.packages[0]!.currentCustodian).toBe('rider:issa');
    // a package on the manifest with no custody truth is a loud fault, never rendered owned-by-nobody
    expect(() => deriveRiderBoard(manifest({ custodyInventory: ['pkg-ghost'] }), [held()])).toThrow(/never unowned/);
  });

  it('TASK STATUS IS NEVER CUSTODY TRUTH: task=delivered but custody≠customer → INCIDENT (custody wins)', () => {
    // the ugliest bug: the task claims delivered, custody says the rider still holds it
    const diverged = held({ taskStatus: 'delivered', currentCustodian: 'rider:issa' });
    expect(isDivergence(diverged)).toBe(true);
    const b = deriveRiderBoard(manifest(), [diverged]);
    expect(b.packages[0]!.render).toBe('incident'); // rendered as an incident, NOT agreement
    expect(b.packages[0]!.currentCustodian).toBe('rider:issa'); // custody truth is shown, not the task's claim
    expect(b.hasIncident).toBe(true);
  });

  it('agreement path: delivered AND custody=customer → agreement; in-transit → agreement (not every mismatch is an incident)', () => {
    expect(deriveRiderBoard(manifest(), [held({ taskStatus: 'delivered', currentCustodian: 'customer' })]).packages[0]!.render).toBe('agreement');
    expect(deriveRiderBoard(manifest(), [held({ taskStatus: 'en_route', currentCustodian: 'rider:issa' })]).packages[0]!.render).toBe('agreement');
    expect(deriveRiderBoard(manifest(), [held({ taskStatus: 'en_route' })]).hasIncident).toBe(false);
  });

  it('CONSOLE-CANNOT-WRITE-CUSTODY: no file in the console src carries a custody-mutating surface (absence proven)', () => {
    const srcDir = join(import.meta.dirname, '..', 'src');
    const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
    // a custody WRITE would look like one of these; the console has custody as a
    // READ model only (board.ts derives, main.ts renders). None may mutate custody.
    const WRITE = /\b(recordTransition|transferCustody|writeCustody|setCustodian|mutateCustody|registerSeal|custodyLedger|CustodyLedger|appendCustody|releaseCustody)\b/;
    for (const f of files) {
      const code = readFileSync(join(srcDir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(WRITE.test(code), `${f} carries a custody-mutating surface`).toBe(false);
    }
    // and board.ts's exports are pure derivations — it imports only the READ type
    const board = readFileSync(join(srcDir, 'board.ts'), 'utf8');
    expect(board).toMatch(/import type \{ RouteManifest \} from '@platform\/contracts'/);
    expect(board).not.toMatch(/\bimport\b(?!\s+type)/); // no value imports at all → nothing to write with
  });
});
