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

export interface RepereAudioPort {
  /** Start (or restart) the note. Resolves when playback has been asked for. */
  play(url: string): Promise<void>;
  /** Stop and release — called when the screen leaves, always. */
  stop(): void;
}

type PlayerLike = {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => Promise<void> | void;
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
  return {
    async play(url: string): Promise<void> {
      if (player !== null && current === url) {
        await player.seekTo(0);
        player.play();
        return;
      }
      // A different note replaces the old one — and the old one is RELEASED,
      // because a rider's phone is a 1 GB Android and a leaked player is a
      // crash three courses later.
      player?.pause();
      player?.release?.();
      player?.remove?.();
      player = mod.createAudioPlayer(url);
      current = url;
      player.play();
    },
    stop(): void {
      player?.pause();
      player?.release?.();
      player?.remove?.();
      player = null;
      current = null;
    },
  };
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
