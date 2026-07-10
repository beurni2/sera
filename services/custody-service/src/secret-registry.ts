import { createHash } from 'node:crypto';

/**
 * Single-use secret registry (SE4.3, four-secrets law). Secrets are stored
 * HASHED (sha256) — the registry never holds or returns plaintext. Each
 * secret is consumable exactly once: a replay is REFUSED, a mismatch is
 * REFUSED, and the kinds are non-substitutable — presenting a pickup code
 * where a drop code is required fails on the (kind, orderId) key, never
 * falls through to another kind.
 */

export type SecretKind = 'pickup_verification_code' | 'custody_seal' | 'buyer_drop_code';

const hashSecret = (secret: string): string => createHash('sha256').update(secret, 'utf8').digest('hex');

interface SecretRecord {
  hash: string;
  consumedAt?: string;
}

export type ConsumeOutcome =
  | { ok: true }
  | { ok: false; reason: 'secret_unknown' | 'secret_mismatch' | 'secret_already_used' };

export class SecretRegistry {
  private readonly records = new Map<string, SecretRecord>();

  private key(kind: SecretKind, orderId: string): string {
    return `${kind}:${orderId}`;
  }

  register(kind: SecretKind, orderId: string, secret: string): void {
    this.records.set(this.key(kind, orderId), { hash: hashSecret(secret) });
  }

  consume(kind: SecretKind, orderId: string, presented: string, at: string): ConsumeOutcome {
    const record = this.records.get(this.key(kind, orderId));
    if (!record) return { ok: false, reason: 'secret_unknown' };
    if (record.consumedAt !== undefined) return { ok: false, reason: 'secret_already_used' };
    if (record.hash !== hashSecret(presented)) return { ok: false, reason: 'secret_mismatch' };
    record.consumedAt = at;
    return { ok: true };
  }
}
