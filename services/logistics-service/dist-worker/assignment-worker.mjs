// src/assignment-lease.ts
var ASSIGNMENT_LEASE_TTL = { name: "assignment-lease-ttl.v1", ms: 5 * 60 * 1e3 };
var RELEASE_CAUSES = ["declined", "completed", "reschedule_closed", "grant_rolled_back"];
function emptyLeaseState() {
  return { leases: [], versions: {}, appliedCommands: {} };
}
var isNonEmptyString = (v) => typeof v === "string" && v.length > 0;
var isIso = (v) => isNonEmptyString(v) && Number.isFinite(Date.parse(v));
function malformed(state) {
  return { ok: false, state, reason: "malformed_command" };
}
function decideLease(state, cmd) {
  if (!isNonEmptyString(cmd.command_id)) return malformed(state);
  const replay = state.appliedCommands[cmd.command_id];
  if (replay !== void 0) {
    if (replay.kind === "expire_due") return { ok: true, state, expired: replay.expired, idempotentReplay: true };
    return { ok: true, state, lease: replay.lease, idempotentReplay: true };
  }
  switch (cmd.kind) {
    case "acquire": {
      if (!isNonEmptyString(cmd.taskId) || !isNonEmptyString(cmd.riderId) || !isIso(cmd.grantedAt) || cmd.eligibility == null || !isIso(cmd.eligibility.checkedAt) || !isNonEmptyString(cmd.correlationId)) {
        return malformed(state);
      }
      if (cmd.eligibility.riderAssignable !== true || cmd.eligibility.taskAssignable !== true) {
        return { ok: false, state, reason: "eligibility_not_attested" };
      }
      for (const lease of state.leases) {
        if (lease.status !== "active") continue;
        if (lease.riderId === cmd.riderId) return { ok: false, state, reason: "rider_already_leased" };
      }
      for (const lease of state.leases) {
        if (lease.status !== "active") continue;
        if (lease.taskId === cmd.taskId) return { ok: false, state, reason: "task_already_leased" };
      }
      const version = (state.versions[cmd.taskId] ?? 0) + 1;
      const granted = {
        taskId: cmd.taskId,
        riderId: cmd.riderId,
        grantedAt: cmd.grantedAt,
        expiresAt: new Date(Date.parse(cmd.grantedAt) + ASSIGNMENT_LEASE_TTL.ms).toISOString(),
        correlationId: cmd.correlationId,
        eligibilityCheckedAt: cmd.eligibility.checkedAt,
        version,
        status: "active"
      };
      const next = {
        leases: [...state.leases, granted],
        versions: { ...state.versions, [cmd.taskId]: version },
        appliedCommands: { ...state.appliedCommands, [cmd.command_id]: { kind: "acquire", lease: granted } }
      };
      return { ok: true, state: next, lease: granted, idempotentReplay: false };
    }
    case "release": {
      if (!isNonEmptyString(cmd.taskId) || !RELEASE_CAUSES.includes(cmd.cause)) return malformed(state);
      const index = state.leases.findIndex((l) => l.status === "active" && l.taskId === cmd.taskId);
      if (index === -1) return { ok: false, state, reason: "no_active_lease" };
      const released = { ...state.leases[index], status: "released", releaseCause: cmd.cause };
      const next = {
        leases: state.leases.map((l, i) => i === index ? released : l),
        versions: state.versions,
        appliedCommands: { ...state.appliedCommands, [cmd.command_id]: { kind: "release", lease: released } }
      };
      return { ok: true, state: next, lease: released, idempotentReplay: false };
    }
    case "anchor": {
      if (!isNonEmptyString(cmd.taskId) || !isIso(cmd.at)) return malformed(state);
      const index = state.leases.findIndex((l) => l.status === "active" && l.taskId === cmd.taskId);
      if (index === -1) return { ok: false, state, reason: "no_active_lease" };
      const anchored = { ...state.leases[index], anchoredAt: cmd.at };
      const next = {
        leases: state.leases.map((l, i) => i === index ? anchored : l),
        versions: state.versions,
        appliedCommands: { ...state.appliedCommands, [cmd.command_id]: { kind: "anchor", lease: anchored } }
      };
      return { ok: true, state: next, lease: anchored, idempotentReplay: false };
    }
    case "expire_due": {
      if (!isIso(cmd.nowIso)) return malformed(state);
      const nowMs = Date.parse(cmd.nowIso);
      const expired = [];
      const leases = state.leases.map((lease) => {
        if (lease.status !== "active" || lease.anchoredAt !== void 0 || Date.parse(lease.expiresAt) >= nowMs) {
          return lease;
        }
        const gone = { ...lease, status: "expired" };
        expired.push(gone);
        return gone;
      });
      const next = {
        leases,
        versions: state.versions,
        appliedCommands: { ...state.appliedCommands, [cmd.command_id]: { kind: "expire_due", expired } }
      };
      return { ok: true, state: next, expired, idempotentReplay: false };
    }
    default:
      return malformed(state);
  }
}

// worker/assignment-lease-do.ts
var STATE_KEY = "assignment-lease-state";
var AssignmentLeaseDO = class {
  constructor(state) {
    this.state = state;
  }
  async fetch(request) {
    if (request.method !== "POST") {
      return Response.json({ ok: false, reason: "method_not_allowed" }, { status: 405 });
    }
    let cmd;
    try {
      cmd = await request.json();
    } catch {
      return Response.json({ ok: false, reason: "malformed" }, { status: 400 });
    }
    if (cmd == null || typeof cmd !== "object" || typeof cmd.command_id !== "string") {
      return Response.json({ ok: false, reason: "malformed" }, { status: 400 });
    }
    const current = await this.state.storage.get(STATE_KEY) ?? emptyLeaseState();
    const decision = decideLease(current, cmd);
    if (decision.ok && !decision.idempotentReplay) {
      await this.state.storage.put(STATE_KEY, decision.state);
    }
    return Response.json(decision, { status: decision.ok ? 200 : 409 });
  }
};
var assignment_lease_do_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/authority/dispatch" || request.method !== "POST") {
      return Response.json({ ok: false, reason: "not_found" }, { status: 404 });
    }
    const stub = env.ASSIGNMENT_LEASE.get(env.ASSIGNMENT_LEASE.idFromName("dispatch"));
    return stub.fetch(request);
  }
};
export {
  AssignmentLeaseDO,
  assignment_lease_do_default as default
};
