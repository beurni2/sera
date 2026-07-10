import { createHash } from 'node:crypto';

/**
 * Single-use secret registry (SE4.3, four-secrets law). Secrets are stored
 * HASHED (sha256) — the registry never holds or returns plaintext. Each
 * secret is consumable exactly once: a replay is REFUSED, a mismatch is
 * REFUSED, and the kinds are non-substitutable — presenting a pickup code
 * where a drop code is required fails on the (kind, orderId) key, never
 * falls through to another kind. Re-registration over a CONSUMED record is
 * REFUSED at the door (WO-2.1 finding ③): a spent secret cannot be re-armed.
 */

/** Store-key kinds for this registry (WO-2.1 finding ④: renamed — the
 * canonical `SecretKind` in @platform/contracts is a different enum with
 * different values; this local key type must not shadow it). WO-2.2 adds
 * the return-flow kinds (SE6.2): the return-bag seal and the TWO handover
 * keys — same branded discipline, single-use, hashed at rest. */
export type StoredSecretKind =
  | 'pickup_verification_code'
  | 'custody_seal'
  | 'buyer_drop_code'
  | 'return_seal'
  | 'seller_return_acceptance'
  | 'rider_return_confirmation';

const hashSecret = (secret: string): string => createHash('sha256').update(secret, 'utf8').digest('hex');

interface SecretRecord {
  hash: string;
  consumedAt?: string;
}

export type ConsumeOutcome =
  | { ok: true }
  | { ok: false; reason: 'secret_unknown' | 'secret_mismatch' | 'secret_already_used' };

export type RegisterOutcome =
  | { ok: true }
  | { ok: false; reason: 'secret_already_used' };

export class SecretRegistry {
  private readonly records = new Map<string, SecretRecord>();

  private key(kind: StoredSecretKind, orderId: string): string {
    return `${kind}:${orderId}`;
  }

  register(kind: StoredSecretKind, orderId: string, secret: string): RegisterOutcome {
    const existing = this.records.get(this.key(kind, orderId));
    // A consumed secret is SPENT: re-arming it (to enable a second
    // presentation) dies here at the registry door, not downstream.
    if (existing?.consumedAt !== undefined) {
      return { ok: false, reason: 'secret_already_used' };
    }
    this.records.set(this.key(kind, orderId), { hash: hashSecret(secret) });
    return { ok: true };
  }

  consume(kind: StoredSecretKind, orderId: string, presented: string, at: string): ConsumeOutcome {
    const record = this.records.get(this.key(kind, orderId));
    if (!record) return { ok: false, reason: 'secret_unknown' };
    if (record.consumedAt !== undefined) return { ok: false, reason: 'secret_already_used' };
    if (record.hash !== hashSecret(presented)) return { ok: false, reason: 'secret_mismatch' };
    record.consumedAt = at;
    return { ok: true };
  }

  /** Non-consuming validity check — used ONLY to make two-key consumption
   * both-or-neither; single-use is still enforced by consume(). */
  private isConsumable(kind: StoredSecretKind, orderId: string, presented: string): ConsumeOutcome {
    const record = this.records.get(this.key(kind, orderId));
    if (!record) return { ok: false, reason: 'secret_unknown' };
    if (record.consumedAt !== undefined) return { ok: false, reason: 'secret_already_used' };
    if (record.hash !== hashSecret(presented)) return { ok: false, reason: 'secret_mismatch' };
    return { ok: true };
  }

  /**
   * SE6.2 two-key handover: BOTH keys must be valid or NEITHER is consumed —
   * a single-key attempt burns nothing and transfers nothing. Verify both
   * first, then consume both.
   */
  consumeTwoKeys(
    a: { kind: StoredSecretKind; orderId: string; presented: string },
    b: { kind: StoredSecretKind; orderId: string; presented: string },
    at: string,
  ):
    | { ok: true }
    | { ok: false; failedKey: 'first' | 'second'; reason: 'secret_unknown' | 'secret_mismatch' | 'secret_already_used' } {
    const checkA = this.isConsumable(a.kind, a.orderId, a.presented);
    if (!checkA.ok) return { ok: false, failedKey: 'first', reason: checkA.reason };
    const checkB = this.isConsumable(b.kind, b.orderId, b.presented);
    if (!checkB.ok) return { ok: false, failedKey: 'second', reason: checkB.reason };
    this.consume(a.kind, a.orderId, a.presented, at);
    this.consume(b.kind, b.orderId, b.presented, at);
    return { ok: true };
  }
}
