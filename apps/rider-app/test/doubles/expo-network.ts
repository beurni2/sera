/**
 * RENDU-RÉEL — expo-network. The harness drives connectivity through the app's
 * OWN `ConnectivityPort` (the manual one), which is the seam the screens
 * actually read; this double only has to exist so the module resolves.
 * It reports ONLINE and never changes: a test that wants offline sets it on
 * the port, where the app reads it.
 */
export async function getNetworkStateAsync(): Promise<{ isConnected: boolean; isInternetReachable: boolean }> {
  return { isConnected: true, isInternetReachable: true };
}
export function addNetworkStateListener(): { remove: () => void } {
  return { remove: () => {} };
}
