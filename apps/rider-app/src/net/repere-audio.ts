/**
 * ═══ COURSE-BRIEF — the buyer's repère, in their own voice ═══
 *
 * FOUNDER REPORT (2026-08-09): « on rider's app sera when order arrives on the
 * screen there is nowhere to listen the repère audio that the product carries ».
 * The note existed — recorded at checkout, heard by the founder in the Boutik+
 * console — and had no player on the one screen where someone is actually
 * looking for the door.
 *
 * WHY A PORT. `expo-audio` is a NATIVE module: it exists in a real build and
 * not in the vitest process, and a screen that imports it directly cannot be
 * tested and dies on a build that lacks it. So playback lives behind this
 * interface, resolved once. When the module is absent the resolver answers
 * `null` and the screen renders NO control — never a button that does nothing
 * (the same law the Boutik+ console's player follows).
 *
 * Law 5 (deterministic only): this plays a RECORDING. Nothing here synthesises
 * a voice, and nothing transcribes one.
 */

/**
 * ═══ VOIX-ÉTAT-2 — THE PORT HAD NO STATE TO REPORT (founder, 2026-08-09) ═══
 *
 * « the button is not displaying the pause sign and the seconds are not
 * counting ». On this screen it could not: the port exposed `play` and `stop`
 * and nothing else, so the row it drives had no way to know whether the note
 * was running, how far in it was, or that it had ended. The screen guessed —
 * it set « playing » on tap and never unset it.
 *
 * So the port now REPORTS. `expo-audio` already emits `playbackStatusUpdate`
 * with `currentTime`, `playing` and `didJustFinish` (Audio.types `AudioStatus`);
 * this forwards exactly those three facts and invents nothing.
 */
export interface RepereAudioEtat {
  /** Is sound coming out RIGHT NOW, as the player itself reports it. */
  readonly playing: boolean;
  /** How far into the note we are, in whole seconds. */
  readonly seconds: number;
}

export interface RepereAudioPort {
  /** Start (or restart) the note. Resolves when playback has been asked for. */
  play(url: string): Promise<void>;
  /** Pause where we are — the note keeps its position, a second tap resumes. */
  pause(): void;
  /** Stop and release — called when the screen leaves, always. */
  stop(): void;
  /** Watch playback. Returns the unsubscribe; the screen calls it on unmount. */
  subscribe(fn: (etat: RepereAudioEtat) => void): () => void;
}

/** Exactly the fields of `expo-audio`'s `AudioStatus` this port reads. */
type StatusLike = { currentTime?: number; playing?: boolean; didJustFinish?: boolean };
type SubscriptionLike = { remove?: () => void };
type PlayerLike = {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => Promise<void> | void;
  addListener?: (event: 'playbackStatusUpdate', fn: (status: StatusLike) => void) => SubscriptionLike | undefined;
  release?: () => void;
  remove?: () => void;
};
type AudioModule = { createAudioPlayer: (source: string) => PlayerLike };

/**
 * The real port over `expo-audio`, given the module. Kept separate from the
 * resolver so a test can drive the whole behaviour with a fake module — the
 * seam the native boundary would otherwise hide.
 *
 * ONE PLAYER AT A TIME: a second tap re-seeks the same note to the start
 * rather than stacking a second voice over the first.
 */
export function repereAudioOver(mod: AudioModule): RepereAudioPort {
  let player: PlayerLike | null = null;
  let current: string | null = null;
  let sub: SubscriptionLike | undefined;
  /** Has this note run out? Only then does the next tap rewind to the start. */
  let finished = false;
  /** The position the last status reported — what `pause()` keeps on screen. */
  let lastSeconds = 0;
  const watchers = new Set<(e: RepereAudioEtat) => void>();
  /** The last state we told the screen — so `stop()` and the end of a note
   *  both land on the same honest rest, and nothing lingers as « playing ». */
  const emit = (e: RepereAudioEtat): void => {
    for (const w of watchers) w(e);
  };
  const detach = (): void => {
    sub?.remove?.();
    sub = undefined;
    player?.pause();
    player?.release?.();
    player?.remove?.();
    player = null;
    current = null;
  };
  return {
    async play(url: string): Promise<void> {
      if (player !== null && current === url) {
        // ⚠ RESUME, NEVER RESTART. Tapping « Pause » then tapping again must
        // continue where the buyer's sentence was cut, not replay it from the
        // top — a rider re-listening to « portail bleu » should not have to
        // sit through « face à la pharmacie » again. Only a note that has
        // RUN OUT goes back to the start.
        if (finished) await player.seekTo(0);
        player.play();
        return;
      }
      // A different note replaces the old one — and the old one is RELEASED,
      // because a rider's phone is a 1 GB Android and a leaked player is a
      // crash three courses later.
      detach();
      player = mod.createAudioPlayer(url);
      current = url;
      finished = false;
      sub = player.addListener?.('playbackStatusUpdate', (status: StatusLike) => {
        // The note ENDING is the state the screen could never see before, and
        // it is the one that left « Pause » sitting over silence.
        if (status.didJustFinish === true) {
          finished = true;
          lastSeconds = 0;
          emit({ playing: false, seconds: 0 });
          return;
        }
        lastSeconds = Math.max(0, Math.floor(status.currentTime ?? 0));
        emit({ playing: status.playing === true, seconds: lastSeconds });
      });
      player.play();
    },
    pause(): void {
      player?.pause();
      // Reported immediately: `playbackStatusUpdate` may not fire again once
      // the sound stops, and a button that waits for an event that never comes
      // is the same dead face this whole change is about.
      emit({ playing: false, seconds: lastSeconds });
    },
    stop(): void {
      detach();
      finished = false;
      lastSeconds = 0;
      emit({ playing: false, seconds: 0 });
    },
    subscribe(fn: (e: RepereAudioEtat) => void): () => void {
      watchers.add(fn);
      return () => {
        watchers.delete(fn);
      };
    },
  };
}

/**
 * « m:ss » — the SAME shape the buyer's own player and the Boutik+ console use
 * (`fmtVoiceDuration`), so one note reads identically wherever it is heard. A
 * seven-second repère is « 0:07 », never a bare number and never « 7 s ».
 */
export function dureeVoix(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Resolve the port, or `null` on a build where the native module is absent.
 * `require` is deliberate: a static import would make the bundle fail to load
 * everywhere the module is missing, which is the opposite of degrading.
 */
export function resolveRepereAudio(): RepereAudioPort | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-audio') as Partial<AudioModule>;
    if (typeof mod?.createAudioPlayer !== 'function') return null;
    return repereAudioOver(mod as AudioModule);
  } catch {
    return null;
  }
}

/**
 * A media POINTER becomes a URL exactly here, and only against the app's own
 * base. The Worker already bounds the ref to `media/…`; this is the second
 * half of the same law — nothing a server says can point the rider's phone at
 * another host.
 */
export function mediaUrl(base: string | null, ref: string | null): string | null {
  if (base === null || base === '' || ref === null) return null;
  if (!/^media\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(ref) || ref.includes('..')) return null;
  return `${base.replace(/\/+$/, '')}/${ref}`;
}
