import { coutsVue, flotteVue, type CoutLigne, type FlotteVue, type Scenario } from './flotte';
import { logisticsBase } from './rider-codes-port';

/**
 * FLOTTE-1 — the fleet desk's port to the logistics Worker's `/ops/flotte*`
 * doors, on the founder's ops key (the same door discipline as the courses
 * port: the key rides the Authorization header, a 401/403 is `bad_key`, a
 * non-2xx is a refusal BY NAME, a transport failure is `unreachable`).
 */

export type FlotteAnswer<T> = { kind: 'ok'; value: T } | { kind: 'bad_key' } | { kind: 'refused'; reason: string } | { kind: 'unreachable' };

export interface FlottePort {
  lire(): Promise<FlotteAnswer<FlotteVue>>;
  declarerMoto(cmd: { commandId: string; vehicleId?: string; label: string; fleetTranche: number; status?: string; odometerKm?: number }): Promise<FlotteAnswer<{ status: string; vehicleId: string }>>;
  noter(cmd: { commandId: string; vehicleId: string; kind: string; note?: string; odometerKm?: number; costFcfa?: number; kwh?: number; doc?: { kind: string; expiresAt: string } }): Promise<FlotteAnswer<{ status: string }>>;
  confier(cmd: { commandId: string; vehicleId: string; riderId: string | null }): Promise<FlotteAnswer<{ status: string }>>;
  hypotheses(cmd: { commandId: string; hypotheses: unknown }): Promise<FlotteAnswer<{ status: string }>>;
  cout(orderId: string, deliveryFunding: number): Promise<FlotteAnswer<Readonly<Record<Scenario, CoutLigne>>>>;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
const TIMEOUT_MS = 15_000;

async function within(fetchFn: FetchFn, url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function statusOf(body: unknown): { status: string } | null {
  const status = body !== null && typeof body === 'object' ? (body as Record<string, unknown>)['status'] : null;
  return typeof status === 'string' && status !== '' ? { status } : null;
}

export function httpFlotte(base: string, opsKey: string, fetchFn: FetchFn = globalThis.fetch, timeoutMs: number = TIMEOUT_MS): FlottePort {
  const root = base.replace(/\/+$/, '');
  async function call<T>(path: string, init: RequestInit, take: (body: unknown) => T | null): Promise<FlotteAnswer<T>> {
    const res = await within(fetchFn, `${root}${path}`, { ...init, headers: { Authorization: `Bearer ${opsKey}`, 'Content-Type': 'application/json' } }, timeoutMs);
    if (res === null) return { kind: 'unreachable' };
    if (res.status === 401 || res.status === 403) return { kind: 'bad_key' };
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const reason = body !== null && typeof body === 'object' ? (body as Record<string, unknown>)['reason'] : null;
      return { kind: 'refused', reason: typeof reason === 'string' ? reason : 'unknown' };
    }
    const value = take(body);
    // A 200 that does not carry what it claims is a refusal, by name — the desk's law.
    if (value === null) return { kind: 'refused', reason: 'reponse_sans_statut' };
    return { kind: 'ok', value };
  }
  return {
    lire: () => call('/ops/flotte', { method: 'GET' }, flotteVue),
    declarerMoto: (cmd) =>
      call('/ops/flotte/moto', { method: 'POST', body: JSON.stringify({ command_id: cmd.commandId, vehicleId: cmd.vehicleId, label: cmd.label, fleetTranche: cmd.fleetTranche, status: cmd.status, odometerKm: cmd.odometerKm }) }, (body) => {
        const s = statusOf(body);
        const vehicleId = body !== null && typeof body === 'object' ? ((body as Record<string, unknown>)['moto'] as Record<string, unknown> | null)?.['vehicleId'] : null;
        return s === null || typeof vehicleId !== 'string' ? null : { status: s.status, vehicleId };
      }),
    noter: (cmd) =>
      call('/ops/flotte/moto/entree', { method: 'POST', body: JSON.stringify({ command_id: cmd.commandId, vehicleId: cmd.vehicleId, kind: cmd.kind, note: cmd.note, odometerKm: cmd.odometerKm, costFcfa: cmd.costFcfa, kwh: cmd.kwh, doc: cmd.doc }) }, statusOf),
    confier: (cmd) => call('/ops/flotte/moto/confier', { method: 'POST', body: JSON.stringify({ command_id: cmd.commandId, vehicleId: cmd.vehicleId, riderId: cmd.riderId }) }, statusOf),
    hypotheses: (cmd) => call('/ops/flotte/hypotheses', { method: 'POST', body: JSON.stringify({ command_id: cmd.commandId, hypotheses: cmd.hypotheses }) }, statusOf),
    cout: (orderId, deliveryFunding) => call(`/ops/flotte/cout?orderId=${encodeURIComponent(orderId)}&deliveryFunding=${encodeURIComponent(String(deliveryFunding))}`, { method: 'GET' }, coutsVue),
  };
}

export function unwiredFlotte(): FlottePort {
  const no = async (): Promise<FlotteAnswer<never>> => ({ kind: 'unreachable' });
  return { lire: no, declarerMoto: no, noter: no, confier: no, hypotheses: no, cout: no };
}

export function resolveFlotte(opsKey: string, base: string = logisticsBase()): FlottePort {
  const trimmed = base.trim();
  return trimmed === '' ? unwiredFlotte() : httpFlotte(trimmed, opsKey);
}

/** The desk's own ids — minted once per act, from the OS CSPRNG. */
export function flotteCommandId(acte: string): string {
  return `cmd-console-flotte-${acte}-${crypto.randomUUID()}`;
}
