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
  /**
   * VOIX-MUETTE (founder, 2026-08-09: « When I tap the audio on sera to
   * listen I am not hearing anything ») — the load FAILED. Named by the
   * player when it ever names one, and otherwise DETECTED within the bounds
   * of VOIX-MUETTE-2 below: ten full seconds of silence, or the idle error
   * terminal. A slow 2G load is not a failure — a short note loads in well
   * under the watchdog's ten seconds. A fresh play() clears it.
   */
  readonly echec: boolean;
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
type StatusLike = { currentTime?: number; playing?: boolean; didJustFinish?: boolean; playbackState?: string; isLoaded?: boolean };
type SubscriptionLike = { remove?: () => void };
type PlayerLike = {
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => Promise<void> | void;
  /** The player's own word that the source loaded (`AudioModule.types` l.44) —
   *  a property read, never a native call. */
  isLoaded?: boolean;
  addListener?: (event: 'playbackStatusUpdate', fn: (status: StatusLike) => void) => SubscriptionLike | undefined;
  release?: () => void;
  remove?: () => void;
};

/**
 * ═══ VOIX-MUETTE-2 — THE FAILURE THE LIBRARY NEVER NAMES (founder's iPhone, 2026-08-14) ═══
 *
 * The listener branch that reads `/fail|error/i` off `playbackState` is
 * UNREACHABLE in expo-audio 1.1.1. Android's `playbackState` only ever reads
 * 'ready' | 'buffering' | 'idle' | 'ended' | 'unknown' (`AudioPlayer.kt`
 * l.242-248), and the library registers NO error listener — zero
 * `onPlayerError` hits in its android source. iOS emits
 * `playbackStatusUpdate` ONLY on `.readyToPlay` — a failed item is eternal
 * silence. So a dead network or a bad ref left the row saying « Écouter »
 * forever, with no message and nothing to tap differently. The founder hit
 * exactly that.
 *
 * The ecosystem's PROVEN answer is the Shop+ reseller app's voice-capture
 * (2026-08-13), ported here whole:
 *   · the LOAD WATCHDOG — a load that has said nothing for ten seconds takes
 *     the failure road; a short note over 3G loads in well under this;
 *   · the IDLE-AFTER-NON-IDLE detector — a healthy load moves straight to
 *     buffering, so a LATER 'idle' is ExoPlayer's error terminal; arming
 *     only after a non-idle status keeps a pre-buffering idle echo from
 *     false-firing;
 *   · the PLAY-ONCE belt — play() is issued by whichever road answers first
 *     (the immediate call, or the player's own `isLoaded`), exactly once.
 * Both detectors stand down ONLY on the player's own word that the source
 * loaded (`isLoaded`) — a play() call queued on playWhenReady proves nothing
 * about the load it is waiting on. A declared failure TEARS THE PLAYER DOWN,
 * so the retry the echec line asks for rebuilds from scratch.
 */
const GARDE_CHARGEMENT_MS = 10_000;
type AudioModule = {
  createAudioPlayer: (source: string) => PlayerLike;
  /** The real `expo-audio` export (build/ExpoAudio.js); absent on the web stub. */
  setAudioModeAsync?: (mode: { playsInSilentMode: boolean }) => Promise<void>;
};

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
  /** The load failed (named, silent, or idle-terminal); cleared only by a fresh play(). */
  let echec = false;
  /** VOIX-MUETTE-2 — the load watchdog. Armed at play, dead on the player's
   *  own `isLoaded`, on didJustFinish, on failure, and whenever the screen
   *  leaves. One at a time, like the player it watches. */
  let garde: ReturnType<typeof setTimeout> | null = null;
  /** The player's OWN word that the source loaded — stands down both detectors. */
  let charge = false;
  /** A non-idle status was seen — arms the idle-after-non-idle detector. */
  let vuActif = false;
  const annulerGarde = (): void => {
    if (garde !== null) {
      clearTimeout(garde);
      garde = null;
    }
  };
  /**
   * VOIX-MUETTE — the iPhone's silent switch. `expo-audio`'s default iOS
   * session respects the hardware mute, so a rider (or the founder) with the
   * switch down heard NOTHING while the row honestly counted seconds. A
   * spoken repère is the product, not a notification sound: the session is
   * set to play in silent mode ONCE, before the first playback. Best-effort
   * and awaited: setting it after play() starts would leave the first note
   * muted anyway.
   */
  let modeRegle = false;
  const watchers = new Set<(e: RepereAudioEtat) => void>();
  /** The last state we told the screen — so `stop()` and the end of a note
   *  both land on the same honest rest, and nothing lingers as « playing ». */
  const emit = (e: RepereAudioEtat): void => {
    for (const w of watchers) w(e);
  };
  /**
   * ═══ ⚠ ÉCRAN BLANC (founder report 2026-08-10) — « when I tap accept button
   * to accept the order the screen goes all white and blank » ═══
   *
   * THIS FUNCTION WAS THE CRASH. It called three native functions in a row on
   * the same player: `pause()`, then `release()`, then `remove()`. But
   * `release()` is `SharedObject.release()`, and expo-modules-core documents
   * exactly what it does: « Any subsequent calls to native functions of the
   * object will throw an error as it is no longer associated with its native
   * counterpart. » `remove()` IS a native function (`AudioModule.types` l.176,
   * a raw binding over `requireNativeModule('ExpoAudio')`). So every detach
   * with a live player threw.
   *
   * AND `stop()` RUNS INSIDE A REACT EFFECT. `repereVisible` flips false the
   * instant the assignment turns `acknowledged` — the moment the rider taps
   * « Accepter » — so the effect fired, the throw escaped a passive effect,
   * React unmounted the whole tree with no boundary above it, and the rider
   * was left holding a blank white screen with their course gone.
   *
   * The old test could not see it: its fake player had NO `remove()` at all
   * and a `release()` that only pushed a string — a mock that made the
   * integration look healthier than it was. It is certified to the real bounds
   * now, and it goes red against the code above.
   *
   * SO: THE SAME THREE CALLS, IN THE ORDER THAT WORKS, EACH GUARDED, and the
   * reference dropped BEFORE any of them so nothing can reach a dead object
   * twice. `release()` goes LAST because it is the one that detaches — and
   * only that ordering keeps BOTH properties:
   *
   *   · `pause()`  — stop the sound (native).
   *   · `remove()` — expo-audio's own « Remove the player from memory to free
   *     up resources ». It drops the MODULE's strong reference only
   *     (`AudioComponentRegistry` on iOS, `players.remove(id)` on Android);
   *     it does not detach the shared object.
   *   · `release()` — detaches JS from native, which is what actually lets the
   *     native player deallocate NOW instead of whenever Hermes gets round to
   *     finalising. It cannot throw (`SharedObject.cpp` guards on
   *     `hasNativeState`), and nothing native follows it.
   *
   * Dropping `release()` altogether would have made freeing GC-dependent — ten
   * repères across a shift waiting on a finaliser, on a 1 GB Android. That is
   * the leak this file's own comment warns about; the fix is the order, not
   * the amputation. A player that is already gone is not an error; leaving the
   * screen is never allowed to take the app down with it.
   */
  const detach = (): void => {
    // The watchdog dies with the player it watches (the reference's
    // stopPlayback does the same): a failure line landing after the screen
    // already left — or after a fresh attempt began — would be noise about
    // nothing, or worse, a lie about the wrong note.
    annulerGarde();
    try {
      sub?.remove?.();
    } catch {
      // A subscription on an already-dead player is nothing to report.
    }
    sub = undefined;
    const mort = player;
    player = null;
    current = null;
    if (mort === null) return;
    try {
      mort.pause();
    } catch {
      // Already released by the OS or by a previous detach — nothing to stop.
    }
    try {
      mort.remove?.();
    } catch {
      // The memory is the platform's problem from here; a rider's screen is not.
    }
    try {
      mort.release?.();
    } catch {
      // Documented as safe on an already-detached object; guarded anyway,
      // because this runs in a React effect and nothing here may ever throw.
    }
  };
  /**
   * VOIX-MUETTE-2 — the failure fires ONCE per attempt (the reference's
   * once-flag idiom), and firing it TEARS DOWN: the dead player is released
   * so the retry the echec line asks for rebuilds from scratch, and no
   * zombie load can start sound after the row already said échec. `detach`
   * also kills the watchdog, so idle-then-timeout cannot report twice.
   */
  const signalerEchec = (): void => {
    if (echec) return;
    echec = true;
    detach();
    emit({ playing: false, seconds: lastSeconds, echec: true });
  };
  const chargeConfirmee = (): void => {
    charge = true;
    annulerGarde();
  };
  const armerGarde = (): void => {
    if (garde !== null) return;
    garde = setTimeout(() => {
      garde = null;
      signalerEchec();
    }, GARDE_CHARGEMENT_MS);
  };
  return {
    async play(url: string): Promise<void> {
      if (!modeRegle) {
        modeRegle = true;
        await mod.setAudioModeAsync?.({ playsInSilentMode: true }).catch(() => {
          // The session call failing must not eat the tap — playback is still
          // asked for; on a platform without the call it simply never fails.
        });
      }
      // ⚠ A FAILED PLAYER IS NEVER RESUMED (verifier, 2026-08-09). The echec
      // line says « réessayez » — so the retry must be able to succeed. A
      // player that named a failure is dead; resuming it replays the failure.
      // The next tap falls through to the fresh branch and REBUILDS it.
      const avaitEchoue = echec;
      echec = false;
      try {
        if (player !== null && current === url && !avaitEchoue) {
          // ⚠ RESUME, NEVER RESTART. Tapping « Pause » then tapping again must
          // continue where the buyer's sentence was cut, not replay it from the
          // top — a rider re-listening to « portail bleu » should not have to
          // sit through « face à la pharmacie » again. Only a note that has
          // RUN OUT goes back to the start.
          if (finished) {
            await player.seekTo(0);
            lastSeconds = 0;
          }
          // ⚠ CLEARED HERE, NOT ONLY IN stop() (verifier, 2026-08-09). `finished`
          // was sticky: after one natural end, EVERY later tap rewound — so
          // pause-then-resume restarted the note instead of continuing it,
          // contradicting this block's own contract two lines up.
          finished = false;
          player.play();
          // Resume reports itself for the same reason pause does: the next status
          // is up to 500 ms away (expo-audio's default updateInterval), and a row
          // showing « Écouter » over live sound is the defect, briefly.
          emit({ playing: true, seconds: lastSeconds, echec: false });
          // A tap during a load that is still SILENT keeps the clock honest:
          // the original watchdog keeps running (ten seconds from the FIRST
          // ask), and if a pause killed it, it is re-armed — a hung load must
          // never outlive its clock.
          if (!charge) armerGarde();
          return;
        }
        // A different note replaces the old one — and the old one is RELEASED,
        // because a rider's phone is a 1 GB Android and a leaked player is a
        // crash three courses later.
        detach();
        const cree = mod.createAudioPlayer(url);
        player = cree;
        current = url;
        finished = false;
        charge = false;
        vuActif = false;
        /**
         * VOIX-MUETTE-2 — the play-once belt (the reference's `lancer`).
         * Play is asked for by whichever road answers first — the immediate
         * call below, or the player's own `isLoaded` in the listener — and
         * the once-flag keeps the two roads from doubling up. The immediate
         * call must NOT stand the detectors down: a play queued on
         * playWhenReady proves nothing about the load it is waiting on.
         */
        let lance = false;
        const lancer = (): void => {
          if (lance) return;
          lance = true;
          cree.play();
        };
        sub = cree.addListener?.('playbackStatusUpdate', (status: StatusLike) => {
          // The player's OWN word that the source loaded — the one fact that
          // stands down the watchdog and the idle detector.
          if (status.isLoaded === true) {
            chargeConfirmee();
            lancer();
          }
          // The player NAMING a failure — kept for form's sake, but no status
          // of expo-audio 1.1.1 can carry such a value (VOIX-MUETTE-2 above);
          // the idle detector and the watchdog are what actually catch one.
          if (typeof status.playbackState === 'string' && /fail|error/i.test(status.playbackState)) {
            signalerEchec();
            return;
          }
          // IDLE AFTER NON-IDLE (the reference's detector, same bounds): a
          // healthy load moves straight to buffering, so a LATER 'idle' is
          // ExoPlayer's error terminal. `vuActif` keeps a pre-buffering idle
          // echo from false-firing; `charge` keeps a loaded note's own
          // teardown from ever reading as a failure.
          if (status.playbackState === 'idle') {
            if (vuActif && !charge) {
              signalerEchec();
              return;
            }
          } else if (typeof status.playbackState === 'string') {
            vuActif = true;
          }
          // The note ENDING is the state the screen could never see before, and
          // it is the one that left « Pause » sitting over silence.
          if (status.didJustFinish === true) {
            // A note that ENDED proves its load — the watchdog has nothing
            // left to watch (the reference clears it on didJustFinish too).
            annulerGarde();
            finished = true;
            lastSeconds = 0;
            emit({ playing: false, seconds: 0, echec: false });
            return;
          }
          // A note that has ENDED may still emit a trailing status carrying
          // `currentTime === duration`; taking it would put a frozen « 0:07 »
          // beside « Écouter », which is the same class of lie the end-handler
          // above exists to prevent. Only a genuine resume reopens the clock.
          if (finished && status.playing !== true) return;
          lastSeconds = Math.max(0, Math.floor(status.currentTime ?? 0));
          emit({ playing: status.playing === true, seconds: lastSeconds, echec: false });
        });
        lancer();
        // Already loaded — a cached source can confirm before any status
        // arrives: take the player's word right here (the reference's
        // `p.isLoaded` belt). Skipped after a failure: a synchronous idle
        // terminal has already torn this attempt down, and a released
        // player's getters are not to be touched.
        if (!echec && cree.isLoaded === true) chargeConfirmee();
        // VOIX-MUETTE-2 — the watchdog. iOS says NOTHING about a failed
        // item, ever; without this bound the row reads « Écouter » forever
        // and the failure has no sentence. Ten seconds of silence → the
        // failure road, torn down, retryable.
        if (!echec && !charge) armerGarde();
      } catch {
        // ⚠ A play that THROWS is the same fact as a status naming a failure
        // (verifier, 2026-08-09): before this, the rejection fell to the
        // screen's catch-and-stop and the row went silently back to
        // « Écouter » with no echec line. The port handles its own failure:
        // the broken player is released, the honest state is emitted, and the
        // promise RESOLVES — the screen never needs a rescue path.
        detach();
        echec = true;
        emit({ playing: false, seconds: lastSeconds, echec: true });
      }
    },
    pause(): void {
      // The rider's way out of a HUNG load too (the reference's stopPlayback
      // clears its watchdog for the same reason): the wait dies with the tap,
      // and the next play() re-arms it.
      annulerGarde();
      // Guarded for the same reason `detach` is: this runs straight off a
      // rider's tap, and a native call that throws out of an event handler
      // takes the tree down exactly like the one in an effect did. A player the
      // OS reclaimed under a hot phone is a pause that already happened.
      try {
        player?.pause();
      } catch {
        // Nothing is playing; the rest state below is the truth either way.
      }
      // Reported immediately: `playbackStatusUpdate` may not fire again once
      // the sound stops, and a button that waits for an event that never comes
      // is the same dead face this whole change is about.
      emit({ playing: false, seconds: lastSeconds, echec });
    },
    stop(): void {
      detach();
      finished = false;
      lastSeconds = 0;
      echec = false;
      emit({ playing: false, seconds: 0, echec: false });
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
