import { decideLease, emptyLeaseState, type LeaseAuthorityState, type LeaseCommand } from '../src/assignment-lease.js';

/**
 * AssignmentLeaseDO — THE atomic assignment authority (SE2.1, WO-4.3).
 *
 * SE-I01's authority is SINGULAR: "exactly one assignment authority per
 * task; a courier MUST NOT self-assign" — so the router routes every command
 * to ONE object, idFromName('dispatch'). At pilot scale (3–5 motos, one
 * city) one object IS the honest architecture: workerd's input gate
 * serializes every acquire through that single object, which is exactly what
 * makes one-per-rider AND one-per-task atomically enforceable in one place —
 * two dispatchers (or two clicks) can never hand the same package to two
 * riders, by the runtime, not by luck. Sharding is a later-era concern, not
 * built. All law lives in the pure decideLease core (same pattern as
 * boutik's StockReservationDO); this class only loads state, decides,
 * persists non-replay successes.
 */

const STATE_KEY = 'assignment-lease-state';

export class AssignmentLeaseDO {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return Response.json({ ok: false, reason: 'method_not_allowed' }, { status: 405 });
    }
    let cmd: LeaseCommand;
    try {
      cmd = (await request.json()) as LeaseCommand;
    } catch {
      return Response.json({ ok: false, reason: 'malformed' }, { status: 400 });
    }
    if (cmd == null || typeof cmd !== 'object' || typeof cmd.command_id !== 'string') {
      return Response.json({ ok: false, reason: 'malformed' }, { status: 400 });
    }
    const current =
      (await this.state.storage.get<LeaseAuthorityState>(STATE_KEY)) ?? emptyLeaseState();
    const decision = decideLease(current, cmd);
    if (decision.ok && !decision.idempotentReplay) {
      await this.state.storage.put(STATE_KEY, decision.state);
    }
    return Response.json(decision, { status: decision.ok ? 200 : 409 });
  }
}

interface Env {
  ASSIGNMENT_LEASE: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/authority/dispatch' || request.method !== 'POST') {
      return Response.json({ ok: false, reason: 'not_found' }, { status: 404 });
    }
    const stub = env.ASSIGNMENT_LEASE.get(env.ASSIGNMENT_LEASE.idFromName('dispatch'));
    return stub.fetch(request);
  },
};
