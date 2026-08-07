import type { ConnectivityPort } from '../offline/connectivity';
import { httpRiderSession } from './httpRiderSession';
import type { RiderSession, RiderSessionPort, SignInResult } from './rider-session';

/**
 * SE-LIVE-4c-i · WHICH WORLD THE APP IS TALKING TO, decided in one place.
 *
 * `EXPO_PUBLIC_SERA_LOGISTICS_BASE` is a PUBLIC URL, inlined at build time —
 * that is the only thing that may be bundled. The rider's personal CODE is a
 * credential and is typed by the rider on the sign-in screen; it is never an
 * `EXPO_PUBLIC_*`, never in `app.json`, never in a commit. (Standing secret
 * law: this repo is public.)
 *
 * Set   ⇒ the real logistics Worker.
 * Unset ⇒ the DEMO port, which refuses every code with `unauthorized` and says
 *         so on the screen. It does NOT fabricate a rider. A demo world that
 *         hands out a session would make an unconfigured build look signed-in
 *         and working — the « mock that makes integration look healthier than
 *         it is » failure (§9.8). The honest unconfigured state is « this
 *         build cannot reach Séra », and the screen says exactly that.
 */

/** A rider whose code opens nothing, because there is no directory to ask.
 *  Deliberately not a fake session — see the header block. */
export function demoRiderSession(): RiderSessionPort {
  return {
    async signIn(): Promise<SignInResult> {
      return { ok: false, reason: 'unauthorized' };
    },
  };
}

/** True when this build was given a logistics base URL to talk to. The screen
 *  uses it to explain an unconfigured build honestly rather than blaming the
 *  rider's code. */
export function isWired(base: string | undefined = process.env.EXPO_PUBLIC_SERA_LOGISTICS_BASE): boolean {
  return typeof base === 'string' && base.trim() !== '';
}

export function resolveRiderSession(
  connectivity: ConnectivityPort,
  base: string | undefined = process.env.EXPO_PUBLIC_SERA_LOGISTICS_BASE,
): RiderSessionPort {
  return isWired(base) ? httpRiderSession((base as string).trim(), connectivity) : demoRiderSession();
}

export type { RiderSession, RiderSessionPort, SignInResult };
