import type { ConnectivityPort } from '../offline/connectivity';
import type { OutboxEntry, FlushOutcome } from '../offline/outbox';
import { SOS_RAISE_KIND, type SosRaiseIntent } from '../offline/sos';

/**
 * ═══ SE-LIVE-4d · THE SOS SENDER — the alert finally leaves the phone ═══
 *
 * FOUNDER ORDER (2026-08-07): « Build the SOS wire. »
 *
 * ⚠ WHAT THIS REPLACES. `App.tsx` flushed the outbox through
 * `sandboxReconnectSender` — `async () => 'applied'` — a function that says
 * every queued write succeeded without sending anything. For the SOS that was
 * not a placeholder, it was a **false safety promise**: the raise went to the
 * demo store, the backlog cleared, and the sheet said « Alerte envoyée. / On
 * cherche quelqu'un pour vous. » while nothing had left the handset.
 *
 * This sender posts the raise to `POST /rider/sos` on the logistics Worker,
 * Bearer = the rider's own personal code, and reports what the SERVER said.
 *
 * ═══ WHY THE SOS *DOES* RIDE THE OUTBOX (unlike the custody acts) ═══
 *
 * The custody acts are deliberately not queued, because they carry two of the
 * four secrets and the outbox writes its payload to the phone's disk
 * (`custody-acts.ts`). **An SOS carries no secret** — a rider id, a shift flag,
 * a course id, a timestamp. Queueing it is not only safe, it is the whole
 * point: a rider in trouble in a dead zone must have their alert delivered the
 * moment there is signal, without touching the phone again. That is exactly
 * what the durable outbox was built for, and the `command_id` minted once at
 * the gesture means the retries can never become two emergencies.
 *
 * ⚠ AND IT STILL DOES NOT RING A PHONE. The server RECEIVES and RECORDS; the
 * out-of-hours escalation channel is unbound (`safety.ts`
 * ESCALATION_TRANSPORT). What the app may honestly say after a successful send
 * is « Séra a reçu l'alerte » — never « someone is coming ».
 */

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Bounded like every other request in this app — a raise that hangs is a
 *  raise that never arrives, and the rider would never know. */
const SOS_TIMEOUT_MS = 15_000;

/**
 * Build the outbox sender for SOS entries.
 *
 * ⚠ IT ONLY CLAIMS SUCCESS ON A REAL 200. Anything else keeps the entry
 * PENDING (`collision-refused` is the outbox's keep-and-surface outcome), so
 * the backlog still shows the alert as undelivered and the next reconnect
 * tries again with the same `command_id`. An SOS is the last thing that may
 * ever be silently dropped.
 *
 * Entries of other kinds are left to the caller's existing handling — this
 * sender speaks only for `sos.raise`.
 */
export function httpSosSender(
  base: string,
  code: string,
  fetchFn: FetchFn = globalThis.fetch,
  timeoutMs: number = SOS_TIMEOUT_MS,
): (entry: OutboxEntry) => Promise<FlushOutcome> {
  const root = base.replace(/\/+$/, '');
  return async (entry: OutboxEntry): Promise<FlushOutcome> => {
    if (entry.kind !== SOS_RAISE_KIND) {
      // Not ours. Keep it pending rather than reporting a success we did not
      // perform — the outbox never silently drops what it did not deliver.
      return 'collision-refused';
    }
    const intent = entry.payload as SosRaiseIntent;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(`${root}/rider/sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${code}` },
        signal: controller.signal,
        body: JSON.stringify({
          // The outbox's PERSISTED id — minted once at the gesture, never
          // recomputed, so a retry finds the incident it already opened.
          command_id: entry.commandId,
          // `riderId` is sent as context only; the server takes the identity
          // from the CODE and ignores this, exactly as the custody door does.
          riderId: intent.riderId,
          hours: intent.hours,
          onShift: intent.onShift,
          activeCourseId: intent.activeCourseId,
          raisedAt: intent.raisedAt,
        }),
      });
      if (!res.ok) return 'collision-refused';
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (body?.['ok'] !== true) return 'collision-refused';
      // The server already had this alert: the raise is delivered, not
      // duplicated. Settling is correct — retrying forever would be the lie.
      return body['duplicate'] === true ? 'idempotentReplay' : 'applied';
    } catch {
      // Timed out or the socket died: still pending, still queued, still
      // shown in the backlog. Never « sent ».
      return 'collision-refused';
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * What the rider may honestly be told once a raise has settled at the server.
 * Deliberately NOT « on cherche quelqu'un » — the server has received the
 * alert; nobody has necessarily seen it, and no phone has rung.
 */
export function sosReachedSera(outcome: FlushOutcome): boolean {
  return outcome === 'applied' || outcome === 'idempotentReplay';
}

/** True when this build can deliver an SOS at all. An app with no logistics
 *  base cannot send one, and must say so rather than appear to. */
export function canSendSos(
  base: string | undefined,
  code: string | null,
  connectivity: ConnectivityPort,
): boolean {
  return typeof base === 'string' && base.trim() !== '' && code !== null && connectivity.current() === 'online';
}
