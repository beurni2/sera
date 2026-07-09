// NEGATIVE FIXTURE: off-shift ambient location capture — the
// off-shift-location gate MUST fail on this file. Never import this.
import * as Location from 'expo-location';
export async function trackRiderAlways(): Promise<unknown> {
  return Location.startLocationUpdatesAsync('ambient', {});
}
