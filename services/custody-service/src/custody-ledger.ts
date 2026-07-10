import { createHash } from 'node:crypto';
import { canonicalJsonStringify } from '@platform/contracts';

/**
 * SE4.1 — hash-chained custody/evidence ledger. APPEND-ONLY: every entry is
 * hash-linked to the prior (sha256 over the canonical bytes of the entry
 * body + prevHash), so mutating ANY committed entry breaks verification of
 * every later link — tamper-evident by construction. The
 * ONE-CURRENT-CUSTODIAN invariant lives AT THE STORE: a custody transition
 * whose `from` is not the package's current custodian is REFUSED before
 * anything is written; there is no update or delete path at all.
 */

export interface LedgerEntryBody {
  packageId: string;
  kind:
    | 'pickup_verification'
    | 'custody_seal_registered'
    | 'custody_transition'
    | 'delivery_evidence'
    | 'validation_decision';
  payload: Record<string, unknown>;
  at: string;
}

export interface LedgerEntry extends LedgerEntryBody {
  seq: number;
  prevHash: string;
  hash: string;
}

export const GENESIS_HASH = '0'.repeat(64);

function entryHash(body: LedgerEntryBody, seq: number, prevHash: string): string {
  return createHash('sha256')
    .update(canonicalJsonStringify({ ...body, seq, prevHash }))
    .digest('hex');
}

export type AppendOutcome =
  | { ok: true; entry: LedgerEntry }
  | { ok: false; reason: 'custodian_conflict' | 'malformed_transition' };

/** Recursive copy-then-freeze for the JSON-shaped ledger values: every
 * object and array in the returned structure is a fresh, frozen copy —
 * nothing aliases the internal store at any depth. */
function deepFrozenCopy(value: unknown): unknown {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFrozenCopy(item)));
  }
  if (value !== null && typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deepFrozenCopy(v)])),
    );
  }
  return value;
}

export class CustodyLedger {
  private readonly entries: LedgerEntry[] = [];
  private readonly custodianByPackage = new Map<string, string>();

  append(body: LedgerEntryBody): AppendOutcome {
    // WO-2.2 NB⑤ (the WO-2.1 verifier's write-side finding): the store owns
    // its bytes on write as it does on read — deep-copy the body BEFORE
    // hashing and storing, so a caller mutating the object it passed in
    // after append cannot poison the committed entry. (Copied, not frozen:
    // internal entries stay plain so the tamper-simulation paths in tests
    // and the ledger gate remain expressible.)
    body = structuredClone(body);
    if (body.kind === 'custody_transition') {
      const from = body.payload['from'];
      const to = body.payload['to'];
      if (typeof to !== 'string' || to.length === 0) {
        return { ok: false, reason: 'malformed_transition' };
      }
      const current = this.custodianByPackage.get(body.packageId);
      // Store-level one-current-custodian: the transition must come FROM the
      // current holder (or establish the first). A second concurrent
      // custodian write — wrong or missing `from` — is REFUSED, not merged.
      if (current !== undefined && from !== current) {
        return { ok: false, reason: 'custodian_conflict' };
      }
      if (current === undefined && from !== undefined && typeof from !== 'string') {
        return { ok: false, reason: 'malformed_transition' };
      }
      this.custodianByPackage.set(body.packageId, to);
    }
    const seq = this.entries.length;
    const prevHash = seq === 0 ? GENESIS_HASH : this.entries[seq - 1]!.hash;
    const entry: LedgerEntry = { ...body, seq, prevHash, hash: entryHash(body, seq, prevHash) };
    this.entries.push(entry);
    return { ok: true, entry };
  }

  currentCustodian(packageId: string): string | undefined {
    return this.custodianByPackage.get(packageId);
  }

  /** Recomputes every link. Any mutation of a committed entry fails here. */
  verifyChain(): { valid: true } | { valid: false; brokenAtSeq: number } {
    for (let i = 0; i < this.entries.length; i += 1) {
      const e = this.entries[i]!;
      const expectedPrev = i === 0 ? GENESIS_HASH : this.entries[i - 1]!.hash;
      const { seq, prevHash, hash, ...body } = e;
      if (prevHash !== expectedPrev || seq !== i || entryHash(body, seq, prevHash) !== hash) {
        return { valid: false, brokenAtSeq: i };
      }
    }
    return { valid: true };
  }

  /** Read-only view for tests/gates — a DEEPLY frozen defensive copy
   * (WO-2.1 finding ②, deepened after the verifier's blocking finding: a
   * shallow copy left nested payload arrays — photoRefs, reasons — aliased
   * to the store). Mutating the returned structure at ANY depth cannot
   * touch the ledger; only `append` writes, and `verifyChain` polices the
   * committed bytes. */
  all(): readonly LedgerEntry[] {
    return deepFrozenCopy(this.entries) as readonly LedgerEntry[];
  }
}
