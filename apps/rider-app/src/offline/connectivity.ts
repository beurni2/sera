/**
 * SERA-S4 · the CONNECTIVITY PORT (GP-SERA · closes the durability arc). Real
 * connectivity behind an interface — retiring the compile-time
 * `custody-flow.CONNECTIVITY = 'online'` constant that lied (it made every offline
 * decline/SOS look ONLINE). The device binding is `expoConnectivity.ts`
 * (expo-network); a manual port drives the demo toggle + the tests. Offline-first
 * law (SE-I06 family): queued = pending, never done — the port is what tells the
 * truth about which it is.
 *
 * PURE + PORT-BASED (mirrors the OutboxStore port): last-known state is read
 * SYNCHRONOUSLY (`current`), changes arrive via `subscribe`. No custody write, no franc.
 */

export type Connectivity = 'online' | 'offline';

/** The connectivity port. `current()` returns the last-known state; `subscribe`
 * fires on every change and returns an unsubscribe. */
export interface ConnectivityPort {
  current(): Connectivity;
  subscribe(listener: (c: Connectivity) => void): () => void;
}

/** A manual in-memory port — the demo toggle's source of truth AND the test fake.
 * `set` notifies subscribers only on an actual change (no spurious reconnect flush). */
export interface ManualConnectivity extends ConnectivityPort {
  set(next: Connectivity): void;
}

export function createManualConnectivity(initial: Connectivity = 'online'): ManualConnectivity {
  let state: Connectivity = initial;
  const listeners = new Set<(c: Connectivity) => void>();
  return {
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      if (next === state) return; // no change → no notification (no phantom reconnect)
      state = next;
      for (const listener of listeners) listener(next);
    },
  };
}
