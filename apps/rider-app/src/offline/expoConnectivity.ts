import { addNetworkStateListener, getNetworkStateAsync } from 'expo-network';
import type { Connectivity, ManualConnectivity } from './connectivity';

/**
 * SERA-S4 · the DEVICE binding for the connectivity port — `expo-network` (the
 * CTO-authorized substrate). It forwards the device's REAL network state into the
 * manual port: seed from `getNetworkStateAsync`, then push every change from
 * `addNetworkStateListener`. `isInternetReachable` is the truth (a captive-portal
 * Wi-Fi is "connected" but not reachable); it falls back to `isConnected`.
 *
 * Thin I/O only — the port + its consumers (backlog, reconnect drain) are tested
 * with the manual fake; this native surface never runs under vitest. No franc.
 */

const toConnectivity = (s: { isConnected?: boolean; isInternetReachable?: boolean }): Connectivity =>
  (s.isInternetReachable ?? s.isConnected ?? false) ? 'online' : 'offline';

/** Bind real device connectivity into `port`: seed once, then forward every change.
 * Returns an unbind that stops the seed race and removes the listener. */
export function bindDeviceConnectivity(port: ManualConnectivity): () => void {
  let active = true;
  void getNetworkStateAsync().then((s) => {
    if (active) port.set(toConnectivity(s));
  });
  const sub = addNetworkStateListener((e) => port.set(toConnectivity(e)));
  return () => {
    active = false;
    sub.remove();
  };
}
