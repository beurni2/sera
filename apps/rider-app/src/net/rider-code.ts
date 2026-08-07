/**
 * SE-LIVE-4c-ii · READING THE CODE OFF A PAPER SLIP.
 *
 * The founder mints a rider's personal code in logistics as
 * `SR-XXXX-XXXX-XXXX` over `CODE_ALPHABET` (`logistics-do.ts:117`) — an
 * unambiguous alphabet with **I, L, O, U, 0 and 1 deliberately removed**, so a
 * handwritten code cannot be misread between `O`/`0` or `I`/`1`.
 *
 * ⚠ THE DROP-CODE KEYPAD CANNOT BE REUSED HERE. That keypad is 0–9 (the
 * buyer's drop code is six digits); a rider code is alphanumeric. This is the
 * app's one place for typing letters, and it must be forgiving:
 *
 *   FORGIVING ABOUT FORM — a rider standing in the sun, reading a slip of
 *   paper on a hot phone, types lowercase, forgets the dashes, adds a space,
 *   or leaves off the `SR-`. Every one of those is the RIGHT code typed by a
 *   person doing their best, and refusing it teaches them the app is hostile.
 *   STRICT ABOUT THE CREDENTIAL — normalising the shape is not accepting a
 *   wrong code. Only logistics decides that, and it gives one uniform 401.
 *
 * Because the removed letters are unambiguous, a typed `0` can only have meant
 * `O`… except `O` is not in the alphabet either. So we do NOT guess
 * substitutions: a character outside the alphabet makes the code unreadable,
 * and the screen says « check the code » rather than silently signing in as
 * nobody. Guessing at a credential is how you tell a rider their good code is
 * dead.
 *
 * PURE. No I/O, no storage, no logging — this function receives a credential
 * and returns one. Nothing here writes it anywhere.
 */

/** Mirrors `logistics-do.ts:117` exactly. If that alphabet ever changes, this
 *  is the second place to change — pinned by a test that spells it out. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

const PREFIX = 'SR';
/** Three groups of four, per `mintRiderCode`. */
const BODY_LEN = 12;
const GROUP = 4;

/** The canonical wire form: what logistics hashes, so what we must send. */
export function formatRiderCode(body: string): string {
  return `${PREFIX}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

/**
 * Normalise what the rider typed into the canonical `SR-XXXX-XXXX-XXXX`, or
 * null when it cannot be read as a code at all.
 *
 * Accepts: lowercase · missing dashes · missing `SR-` · spaces · extra dashes.
 * Rejects: anything containing a character outside the alphabet (after the
 * prefix is accounted for), and anything of the wrong length. Rejection here
 * means « unreadable », never « wrong » — the screen must say so differently.
 */
export function normalizeRiderCode(typed: string): string | null {
  // Keep letters and digits only: dashes, spaces and stray punctuation go.
  const bare = typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  /**
   * ⚠ THE PREFIX IS DROPPED ONLY AT LENGTH 14, and that is exact, not
   * heuristic: `S` and `R` are both IN the alphabet, so a code BODY may itself
   * begin « SR ». Length disambiguates completely — 14 means prefix+body, 12
   * means the body alone — so a rider who types only the body of a code that
   * happens to start with SR is not silently truncated.
   */
  const body = bare.length === BODY_LEN + PREFIX.length && bare.startsWith(PREFIX)
    ? bare.slice(PREFIX.length)
    : bare;
  if (body.length !== BODY_LEN) return null;
  for (const ch of body) {
    // No substitution guessing — see the header block.
    if (!CODE_ALPHABET.includes(ch)) return null;
  }
  return formatRiderCode(body);
}

/**
 * What to show in the field as the rider types: the same normalisation, but
 * partial — it groups whatever they have so far so the shape is visible while
 * they read the slip. Never rejects; that is `normalizeRiderCode`'s job at
 * submit time.
 */
export function displayRiderCode(typed: string): string {
  const bare = typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = bare.startsWith(PREFIX) && bare.length > PREFIX.length ? bare.slice(PREFIX.length) : bare;
  const groups: string[] = [];
  for (let i = 0; i < body.length && i < BODY_LEN; i += GROUP) {
    groups.push(body.slice(i, i + GROUP));
  }
  return groups.length === 0 ? '' : `${PREFIX}-${groups.join('-')}`;
}
