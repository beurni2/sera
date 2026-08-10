/**
 * ═══ RENDU-RÉEL — expo-audio, WITH ITS REAL FAILURE MODE ═══
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
 * Contract-certified to the same bounds as `test/repere-audio.test.ts`'s fake,
 * which was derived from the installed package and the native sources.
 */

type Status = { currentTime?: number; playing?: boolean; didJustFinish?: boolean; playbackState?: string };

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
    this.listener?.({ playing: true, currentTime: 0 });
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
