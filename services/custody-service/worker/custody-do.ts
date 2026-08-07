import { CustodySpine, type ChainIds } from '../src/custody-spine.js';
import type { VerificationInput } from '../src/pickup-verification-policy.js';

/**
 * ═══ CustodyDO — ONE OBJECT PER ORDER, and the ledger is its memory ═══
 *
 * SE-LIVE-3 (M4). Custody is the part of this platform where a mistake costs
 * someone their goods, so this object is built to be boring in the one way
 * that matters: **it adds no custody law of its own.** Every rule — SE-I04
 * (exactly one current custodian), SE-I05 (verify → seal → custody), the
 * four-secrets single-use law, the hash-chained append-only ledger — lives in
 * `../src`, where ~200 tests already hold it, and this class only decides
 * WHICH command to hand it and WHEN to persist.
 *
 * ═══ WHY A COMMAND LOG, NOT A SERIALIZED SPINE ═══
 *
 * `CustodySpine` is a stateful aggregate with ~25 private fields and it OWNS
 * its ledger and secret registry. Serializing it field-by-field would mean
 * adding a snapshot surface to the most sensitive file in the repo, where ONE
 * field forgotten today — or added next year without being added to the
 * snapshot — is silent custody corruption that no test would notice until a
 * package went missing.
 *
 * So nothing is serialized. This object keeps an APPEND-ONLY LOG OF ACCEPTED
 * COMMANDS and, on wake, rebuilds the spine by REPLAYING them in order. The
 * custody core is imported and used exactly as written — not one line of it
 * changed for this slice. Replay is exact because every spine act is
 * deterministic: instants arrive as arguments (`at`), never from a clock
 * inside, and the source-scan gate enforces that. It is also the pattern this
 * ecosystem already uses for its other stateful aggregate — Shop+'s OrderDO
 * replays an input log through `applyOrderInput`.
 *
 * Cost, stated: replay is O(commands) per wake. A delivery is a handful of
 * acts, so at pilot scale this is nothing; if a journey ever grew long, a
 * checkpoint would be the answer, and it would be a deliberate slice.
 *
 * ⚠ AND THE PRICE OF REPLAY, STATED PLAINLY: the log stores each command AS IT
 * ARRIVED, so a pickup code's PLAINTEXT lives in this object's storage. The
 * registry itself still holds only a sha256 — but replay calls `register()`
 * and `verifyPickup()`, and both take plaintext, so the log must keep it. The
 * SE-LIVE-3 verifier read `"secret"` straight out of the SQLite file. This is
 * a deliberate, DISCLOSED trade-off awaiting the founder's ruling (JOURNAL,
 * SE-LIVE-3 verifier round 1, blocker ②): either the custody core gains
 * hash-accepting entry points, or plaintext-at-rest inside the object is
 * accepted knowingly. It is NOT to be described anywhere as « hashed at rest ».
 *
 * ═══ node:crypto ═══
 *
 * The ledger and the registry hash with node's SYNCHRONOUS `createHash`.
 * MEASURED on real workerd before this was written: with `nodejs_compat` they
 * run unchanged (ledger appends, chain verifies, secret consumes); without
 * the flag the module will not even resolve. That measurement is why the
 * custody core needed no rewrite — and why `wrangler.toml` carries the flag.
 */

export const CUSTODY_ACTOR = 'ops:sera:fondateur';

const CHAIN_KEY = 'custody:chain:v1';
const LOG_KEY = 'custody:command-log:v1';

/** The commands this object accepts. SE-LIVE-3 ships the opening of an order,
 *  the arming of its secrets, and pickup verification. Seal and the custody
 *  transitions arrive with the rider's own authenticated hand (SE-LIVE-4);
 *  no route writes them today, so no half-built custody path exists. */
export type CustodyCommand =
  | { kind: 'arm_secret'; command_id: string; secretKind: 'pickup_verification_code' | 'custody_seal' | 'buyer_drop_code'; secret: string; at: string }
  | { kind: 'verify_pickup'; command_id: string; input: VerificationInput; presentedPickupCode: string; at: string };

export interface OrderChain extends ChainIds {
  supplierId: string;
  paymentMode: 'FULL_PREPAY' | 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR';
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const isIso = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

/**
 * A stable fingerprint of what the caller ASKED FOR — keys sorted, so two
 * structurally identical commands agree and any difference in the act (its
 * kind, its secret, its rider, its checks, its dwell, its evidence)
 * disagrees.
 *
 * TWO FIELDS ARE EXCLUDED, deliberately. `command_id` is the key being
 * compared. `at` is the INSTANT, which this object mints itself whenever the
 * caller does not supply one — always for an arm. Including it made every
 * honest redelivery a « conflict », because a redelivery arrives at a
 * different millisecond: an at-least-once producer retrying its own arm was
 * told its id was taken. A differing instant under a repeated id is a
 * REDELIVERY, never a second act. The logged command keeps the FIRST instant,
 * so replay stays exact and the ledger records one time, not two.
 */
function fingerprint(cmd: CustodyCommand): string {
  const { command_id: _id, at: _at, ...content } = cmd as Record<string, unknown> & { command_id: string; at: string };
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, stable(x)]));
    }
    return v;
  };
  return JSON.stringify(stable(content));
}

function malformed(reason = 'malformed'): Response {
  return Response.json({ ok: false, reason }, { status: 400 });
}

export class CustodyDO {
  private loaded = false;
  private chain: OrderChain | null = null;
  private log: CustodyCommand[] = [];
  private spine: CustodySpine | null = null;

  constructor(private readonly state: DurableObjectState) {}

  /** Rebuild from the durable log. The spine is NEVER mutated outside this
   *  replay and the request path below. INVARIANT: every command handed to
   *  the spine is logged, so in-memory state is always exactly « the log,
   *  applied in order » — the verifier round below is what made that true. */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.state.storage.get<unknown>([CHAIN_KEY, LOG_KEY]);
    this.chain = (stored.get(CHAIN_KEY) as OrderChain | undefined) ?? null;
    this.log = (stored.get(LOG_KEY) as CustodyCommand[] | undefined) ?? [];
    this.spine = this.chain === null ? null : this.replay(this.chain, this.log);
    this.loaded = true;
  }

  /** THE REPLAY. A fresh spine, then every logged command re-applied in
   *  order — the same calls, the same arguments, the same sequence. Commands
   *  that never reached the spine were never logged and cannot resurrect. */
  private replay(chain: OrderChain, log: readonly CustodyCommand[]): CustodySpine {
    const spine = new CustodySpine(
      { order_id: chain.order_id, task_id: chain.task_id, package_id: chain.package_id, correlation_id: chain.correlation_id },
      chain.supplierId,
      chain.paymentMode,
    );
    for (const cmd of log) this.apply(spine, cmd);
    return spine;
  }

  /** The ONE place a command meets the spine — used by both the live path and
   *  the replay, so a command can never behave differently on rebuild. */
  private apply(spine: CustodySpine, cmd: CustodyCommand): unknown {
    switch (cmd.kind) {
      case 'arm_secret':
        // The registry keys on the ORDER, and the order is this object's own
        // chain — never a value a caller supplied on the command.
        return spine.secrets.register(cmd.secretKind, this.chain!.order_id, cmd.secret);
      case 'verify_pickup':
        return spine.verifyPickup(cmd.input, cmd.presentedPickupCode, cmd.at);
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();
    let response: Response;
    try {
      response = await this.route(request);
    } catch {
      // In-memory state may hold a command that was applied but never
      // persisted; drop it and rebuild from the durable log next request.
      this.loaded = false;
      return Response.json({ ok: false, reason: 'internal_error' }, { status: 500 });
    }
    return response;
  }

  /** Persist the log ATOMICALLY WITH nothing else — the log IS the state.
   *  A command is applied in memory first, then committed; if the commit
   *  throws, `fetch` above drops the in-memory spine and the next request
   *  rebuilds from what actually committed. */
  private async commit(cmd: CustodyCommand): Promise<void> {
    this.log = [...this.log, cmd];
    await this.state.storage.put(LOG_KEY, this.log);
  }

  /**
   * ⚠ VERIFIER MAJOR (round 1) — AN ID IS NOT A COMMAND. The first cut
   * matched on `command_id` alone, so a DIFFERENT command reusing an id was
   * answered « duplicate »: arming `BBB` under an id that armed `AAA` replied
   * 200 while `AAA` stayed armed, and a VERIFICATION reusing an arm's id
   * replied « already on record » with an EMPTY ledger. An idempotency key
   * that collides across kinds and payloads manufactures false beliefs about
   * custody, which is the one thing this object exists not to do.
   *
   * The whole command (minus its id) is now fingerprinted: the same command
   * twice is a duplicate; the same id with different content is a CONFLICT
   * and refuses, so the caller learns their id is taken instead of being told
   * their act happened.
   */
  private priorFor(cmd: CustodyCommand): 'none' | 'duplicate' | 'conflict' {
    const prior = this.log.find((c) => c.command_id === cmd.command_id);
    if (prior === undefined) return 'none';
    return fingerprint(prior) === fingerprint(cmd) ? 'duplicate' : 'conflict';
  }

  private async route(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    /** Open the order's custody file: its chain ids and the supplier it came
     *  from. FIRST-WINS — a second open with different ids would silently
     *  re-base every later entry, so it refuses. */
    if (request.method === 'POST' && pathname === '/order/open') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (
        body === null ||
        !isStr(body['orderId']) ||
        !isStr(body['taskId']) ||
        !isStr(body['packageId']) ||
        !isStr(body['correlationId']) ||
        !isStr(body['supplierId'])
      ) {
        return malformed();
      }
      /** The name that routed this request IS the object's identity; a chain
       *  whose `order_id` differs would be filed where nobody can find it. */
      const objectName = request.headers.get('X-Custody-Object');
      if (objectName !== null && objectName !== (body['orderId'] as string).trim()) {
        return Response.json({ ok: false, reason: 'order_id_does_not_name_this_object' }, { status: 400 });
      }
      const mode = body['paymentMode'] ?? 'FULL_PREPAY';
      if (mode !== 'FULL_PREPAY' && mode !== 'DELIVERY_FEE_PREPAID_PRODUCT_AT_DOOR') return malformed('unknown_payment_mode');
      const chain: OrderChain = {
        order_id: (body['orderId'] as string).trim(),
        task_id: (body['taskId'] as string).trim(),
        package_id: (body['packageId'] as string).trim(),
        correlation_id: (body['correlationId'] as string).trim(),
        supplierId: (body['supplierId'] as string).trim(),
        paymentMode: mode,
      };
      if (this.chain !== null) {
        const same =
          this.chain.order_id === chain.order_id &&
          this.chain.task_id === chain.task_id &&
          this.chain.package_id === chain.package_id &&
          this.chain.correlation_id === chain.correlation_id &&
          this.chain.supplierId === chain.supplierId &&
          this.chain.paymentMode === chain.paymentMode;
        // An identical re-open is absorbed; a DIFFERENT one refuses — the
        // chain ids under a custody file are not re-writable.
        return same
          ? Response.json({ ok: true, status: 'already_open', chain: this.chain })
          : Response.json({ ok: false, reason: 'chain_already_open_with_other_ids' }, { status: 409 });
      }
      await this.state.storage.put(CHAIN_KEY, chain);
      this.chain = chain;
      this.spine = this.replay(chain, this.log);
      return Response.json({ ok: true, status: 'open', chain });
    }

    if (this.chain === null || this.spine === null) {
      return Response.json({ ok: false, reason: 'order_not_open' }, { status: 409 });
    }

    /** Arm one of the four secrets. The REGISTRY holds only a sha256 and this
     *  route never returns the plaintext; a spent secret can never be re-armed
     *  (the registry refuses), which is the law that makes single-use real
     *  across a restart.
     *
     *  ⚠ BUT THE LOG HOLDS THE PLAINTEXT — see the header block. An earlier
     *  version of this comment said the plaintext is « never stored by this
     *  object », which was false, and a false comment on a secret path is
     *  worse than no comment. */
    if (request.method === 'POST' && pathname === '/secrets/arm') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const kind = body?.['kind'];
      if (
        body === null ||
        !isStr(body['command_id']) ||
        !isStr(body['secret']) ||
        (kind !== 'pickup_verification_code' && kind !== 'custody_seal' && kind !== 'buyer_drop_code')
      ) {
        return malformed();
      }
      const commandId = (body['command_id'] as string).trim();
      const cmd: CustodyCommand = {
        kind: 'arm_secret',
        command_id: commandId,
        secretKind: kind,
        secret: body['secret'] as string,
        at: new Date().toISOString(),
      };
      const prior = this.priorFor(cmd);
      if (prior === 'duplicate') return Response.json({ ok: true, status: 'duplicate' });
      if (prior === 'conflict') {
        return Response.json({ ok: false, reason: 'command_id_reused_with_other_content' }, { status: 409 });
      }
      const outcome = this.apply(this.spine, cmd) as { ok: boolean; reason?: string };
      // Same rule as verification: it reached the spine, so it is logged —
      // `register` on a spent secret mutates nothing today, but the log's
      // completeness must not depend on knowing that.
      await this.commit(cmd);
      if (!outcome.ok) {
        return Response.json({ ok: false, reason: outcome.reason ?? 'refused' }, { status: 409 });
      }
      return Response.json({ ok: true, status: 'armed', kind });
    }

    /**
     * Step 11a — bounded pickup verification (SE4.2 / SE-I12). The rider's
     * single-use code is consumed INSIDE the spine; the policy decides
     * accepted/refused from objective checks only; a refusal records the
     * fault signal and custody never begins. This route hands the spine the
     * command and nothing else — no check is evaluated here.
     *
     * ⚠ WHOSE HAND: gated by the founder's ops key (founder ruling, option 2
     * — 2026-08-06). The rider's OWN authenticated act arrives in SE-LIVE-4
     * with the rider app; `riderId` is recorded as given, and until that
     * slice it is the founder's attestation of who verified, not the rider's
     * own credential. Stated here so the ledger is never read as more than
     * it is.
     */
    if (request.method === 'POST' && pathname === '/verification') {
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (
        body === null ||
        !isStr(body['command_id']) ||
        !isStr(body['riderId']) ||
        !isStr(body['presentedPickupCode']) ||
        !isStr(body['evidenceBundleId']) ||
        typeof body['dwellSec'] !== 'number' ||
        !Number.isFinite(body['dwellSec']) ||
        (body['dwellSec'] as number) < 0 ||
        body['checkResults'] === null ||
        typeof body['checkResults'] !== 'object' ||
        Array.isArray(body['checkResults']) ||
        (body['at'] !== undefined && !isIso(body['at']))
      ) {
        return malformed();
      }
      const commandId = (body['command_id'] as string).trim();
      const checkResults: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(body['checkResults'] as Record<string, unknown>)) {
        if (typeof v !== 'boolean') return malformed('check_result_not_boolean');
        checkResults[k] = v;
      }
      const cmd: CustodyCommand = {
        kind: 'verify_pickup',
        command_id: commandId,
        input: {
          orderId: this.chain.order_id,
          riderId: (body['riderId'] as string).trim(),
          checkResults,
          dwellSec: body['dwellSec'] as number,
          evidenceBundleId: (body['evidenceBundleId'] as string).trim(),
        },
        presentedPickupCode: body['presentedPickupCode'] as string,
        at: (body['at'] as string | undefined) ?? new Date().toISOString(),
      };
      const prior = this.priorFor(cmd);
      if (prior === 'duplicate') return Response.json({ ok: true, status: 'duplicate' });
      if (prior === 'conflict') {
        return Response.json({ ok: false, reason: 'command_id_reused_with_other_content' }, { status: 409 });
      }
      const outcome = this.apply(this.spine, cmd) as { kind: string; reason?: string; detail?: string };
      /**
       * ⚠ VERIFIER BLOCKER (SE-LIVE-3 round 1) — EVERY COMMAND THAT REACHED
       * THE SPINE IS LOGGED, whatever it answered. The first cut skipped the
       * log for an « invalid » outcome, reasoning that nothing was recorded.
       * That was WRONG and the verifier drove it: `verifyPickup` CONSUMES the
       * single-use code BEFORE running the policy, so an out-of-policy check
       * list mutates the registry and then returns `invalid`. Unlogged, that
       * mutation vanished on the next eviction — and a code everyone had
       * written off as burned worked again, putting an `accepted` pickup
       * verification on the chain for anyone still holding the string.
       *
       * The invariant is now structural rather than case-by-case: if it
       * touched the spine, it is in the log. Replay re-applies it and lands
       * on the same state, including the consumption. Commands refused
       * BEFORE the spine (malformed body, duplicate id) never touch it and
       * are not logged.
       */
      await this.commit(cmd);
      if (outcome.kind === 'invalid') {
        return Response.json({ ok: false, kind: 'invalid', reason: outcome.reason, detail: outcome.detail }, { status: 409 });
      }
      // accepted AND refused are both RECORDED custody facts — the refusal
      // ladder is a first-class outcome, not an error (« no generic failed
      // terminal »).
      return Response.json({
        ok: true,
        kind: outcome.kind,
        ledgerSeq: this.spine.ledger.all().length - 1,
        chainValid: this.spine.ledger.verifyChain().valid,
      });
    }

    /** THE LEDGER, READ-ONLY. Entries are returned as the store's own frozen
     *  copies; there is no write route here and no update path anywhere. */
    if (request.method === 'GET' && pathname === '/ledger') {
      return Response.json({
        ok: true,
        packageId: this.chain.package_id,
        currentCustodian: this.spine.ledger.currentCustodian(this.chain.package_id) ?? null,
        entries: this.spine.ledger.all(),
      });
    }

    /** Tamper-evidence, on demand: recompute every link. A ledger that has
     *  been altered under this object answers `valid: false` with the seq it
     *  broke at — the whole point of a hash chain is that it can be ASKED. */
    if (request.method === 'GET' && pathname === '/ledger/verify') {
      return Response.json({ ok: true, ...this.spine.ledger.verifyChain() });
    }

    /** The events the spine has emitted for this order (canonical shapes) —
     *  the read the settlement/fund consumers will use in later slices. */
    if (request.method === 'GET' && pathname === '/events') {
      return Response.json({ ok: true, events: this.spine.allEvents() });
    }

    return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
  }
}
