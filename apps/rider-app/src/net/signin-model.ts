import { normalizeRiderCode } from './rider-code';
import type { RiderSession, RiderSessionPort } from './rider-session';

/**
 * SE-LIVE-4c-ii · THE SIGN-IN STATE MODEL — pure, so the screen stays thin and
 * the behaviour is testable without rendering anything.
 *
 * ⚠ WHAT THIS EXISTS TO GET RIGHT: the rider is told WHICH of four different
 * things went wrong, because each has a different next action:
 *
 *   unreadable  → « check the code » — the shape is wrong; NOTHING IS SENT.
 *   bad_code    → « ask Séra for a new code » — the code is dead. Only the
 *                 founder can fix it, and sending them to the founder when the
 *                 real problem was a dead network wastes their whole morning.
 *   offline     → « retry when the network comes back » — nothing is broken.
 *   unreachable → « this is NOT your code; retry in a moment » — Séra is down.
 *                 Saying this out loud matters: the fear at this exact moment,
 *                 for someone whose income depends on the code, is « I have
 *                 been cut off ».
 *
 * The catalog carries all four as separate strings (`signin.*`); this model
 * only decides WHICH, never the words.
 *
 * ⚠ THE CODE IS NEVER STORED BY THIS MODEL. `submit` takes what the rider
 * typed, normalises it, hands it to the port, and returns the outcome. The
 * caller keeps the normalised code for the custody acts that follow (4c-iii /
 * 4c-iv) — this is a credential, and it exists in memory for as long as the
 * rider is signed in, nowhere else. It is never written to the outbox, never
 * to the document store, never logged.
 */

/** What the screen should show. `working` disables the button — a rider on a
 *  slow network must not be able to fire three sign-ins by tapping twice. */
export type SignInState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'working' }
  | { readonly kind: 'refused'; readonly why: 'unreadable' | 'bad_code' | 'offline' | 'unreachable' }
  | { readonly kind: 'signed_in'; readonly session: RiderSession; readonly code: string };

export const IDLE: SignInState = { kind: 'idle' };

/**
 * Attempt a sign-in with what the rider typed.
 *
 * The shape is checked FIRST and locally: an unreadable code never reaches the
 * network, so a rider who fat-fingered a character is told immediately instead
 * of waiting on a request that was always going to fail — and Séra is not
 * asked to resolve garbage.
 */
export async function submit(port: RiderSessionPort, typed: string): Promise<SignInState> {
  const code = normalizeRiderCode(typed);
  if (code === null) return { kind: 'refused', why: 'unreadable' };
  const result = await port.signIn(code);
  if (result.ok) return { kind: 'signed_in', session: result.session, code };
  return {
    kind: 'refused',
    // The port's three refusals map one-to-one onto three different sentences.
    // `unauthorized` is the ONLY one that means « your code is dead ».
    why: result.reason === 'unauthorized' ? 'bad_code' : result.reason,
  };
}

/** The catalog keys for a refusal — headline + what to do next. Kept here so
 *  the mapping is pinned by a test rather than living inline in the screen. */
export function refusalKeys(why: 'unreadable' | 'bad_code' | 'offline' | 'unreachable'): {
  readonly title: string;
  readonly hint: string;
} {
  switch (why) {
    case 'unreadable':
      return { title: 'signin.unreadable', hint: 'signin.unreadable_hint' };
    case 'bad_code':
      return { title: 'signin.bad_code', hint: 'signin.bad_code_hint' };
    case 'offline':
      return { title: 'signin.offline', hint: 'signin.offline_hint' };
    case 'unreachable':
      return { title: 'signin.unreachable', hint: 'signin.unreachable_hint' };
  }
}
