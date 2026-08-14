/**
 * ═══ RENDU-RÉEL — expo-audio, WITH ITS REAL FAILURE MODES ═══
 *
 * ⚠ THIS DOUBLE EXISTS TO BE HARSH, NOT KIND. The « écran blanc » the founder
 * hit was a native throw: `SharedObject.release()` detaches the JS object from
 * its native counterpart, and expo-modules-core documents that « any
 * subsequent calls to native functions of the object will throw ». `remove()`
 * IS such a native function (`AudioModule.types.d.ts` l.176, over
 * `requireNativeModule('ExpoAudio')`).
 *
 * A double that let a released player keep answering would make the crash
 * unreproducible here — and the whole point of this harness is that the crash
 * must be reproducible. So: `release()` kills the object, and every native
 * call afterwards throws exactly as the device does.
 *
 * ═══ BOUNDS (stated per the standing order — this double may NEVER exceed them) ═══
 *
 * · APPEARANCE: NOTHING. This double stands in for a sound pipe, not a
 *   screen — it may never claim layout, colour, spacing, touch-target size
 *   or animation, and it has nothing with which to claim them.
 * · STATUS SHAPES: only what the installed expo-audio 1.1.1 actually emits.
 *   Every real status carries `isLoaded` (`Audio.types.d.ts` l.161, set from
 *   `playbackState == STATE_READY` — `AudioPlayer.kt` l.204/218). Android's
 *   `playbackState` is only ever 'ready' | 'buffering' | 'idle' | 'ended' |
 *   'unknown' (`AudioPlayer.kt` l.242-248 — the `EtatLecture` type below makes
 *   any other value a COMPILE ERROR here). There is NO 'failed'/'error' value
 *   and NO error listener anywhere in the library (zero `onPlayerError` hits
 *   in its android source): a failed load on Android drops to the 'idle'
 *   terminal, and on iOS emits NOTHING AT ALL — `playbackStatusUpdate` fires
 *   only on `.readyToPlay`. The failing modes below are exactly those two
 *   shapes, and no kinder ones.
 *
 * Contract-certified to the same bounds as `test/repere-audio.test.ts`'s fake,
 * which was derived from the installed package and the native sources.
 */

/** The ONLY strings `playbackStateToString` can mint (`AudioPlayer.kt` l.242-248). */
type EtatLecture = 'ready' | 'buffering' | 'idle' | 'ended' | 'unknown';

type Status = {
  currentTime?: number;
  playing?: boolean;
  didJustFinish?: boolean;
  playbackState?: EtatLecture;
  isLoaded?: boolean;
};

/**
 * ═══ VOIX-MUETTE-2 — how the NEXT load behaves ═══
 *
 * · null       — the load succeeds: the first status carries `isLoaded: true`,
 *                as a real 'ready' player's does.
 * · 'silence'  — the iOS failure: a failed item emits NOTHING, ever.
 * · 'idle'     — the Android failure: buffering, then the 'idle' error
 *                terminal, `isLoaded` never true.
 *
 * Set by the walk BEFORE pressing « Écouter », reset to null in the file's
 * beforeEach — a leaked failing mode must never bleed into the next test.
 */
let modeChargement: 'silence' | 'idle' | null = null;
export function __modeChargement(mode: 'silence' | 'idle' | null): void {
  modeChargement = mode;
}

class AudioPlayer {
  private dead = false;
  private listener: ((s: Status) => void) | null = null;
  constructor(readonly source: string) {}

  private native(name: string): void {
    if (this.dead) {
      throw new Error(`Unable to find the native object associated with the given JavaScript object (${name})`);
    }
  }

  play(): void {
    this.native('play');
    // The iOS failure: a failed item is ETERNAL SILENCE — no status, no error.
    if (modeChargement === 'silence') return;
    if (modeChargement === 'idle') {
      // The Android failure: a healthy start (buffering)…
      this.listener?.({ playbackState: 'buffering', isLoaded: false, playing: false, currentTime: 0 });
      // …then the drop to ExoPlayer's error terminal. Nothing else ever comes.
      this.listener?.({ playbackState: 'idle', isLoaded: false, playing: false, currentTime: 0 });
      return;
    }
    // A successful load: `isLoaded` rides every real status of a 'ready'
    // player (`AudioPlayer.kt` l.204/210) — a double that omitted it would
    // starve the port's load-confirmation and false-fire its watchdog.
    this.listener?.({ playing: true, currentTime: 0, isLoaded: true, playbackState: 'ready' });
  }
  pause(): void {
    this.native('pause');
  }
  seekTo(): void {
    this.native('seekTo');
  }
  /** Native: drops the module's reference. Does NOT detach. */
  remove(): void {
    this.native('remove');
  }
  /** SharedObject.release(): DETACHES. Safe on an already-detached object. */
  release(): void {
    this.dead = true;
  }
  addListener(_event: 'playbackStatusUpdate', fn: (s: Status) => void): { remove: () => void } {
    this.listener = fn;
    return { remove: () => { this.listener = null; } };
  }
}

export function createAudioPlayer(source: string): AudioPlayer {
  return new AudioPlayer(source);
}

export async function setAudioModeAsync(): Promise<void> {}
