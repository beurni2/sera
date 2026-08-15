import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dureeVoix, mediaUrl, repereAudioOver, type RepereAudioEtat } from '../src/net/repere-audio';

/**
 * COURSE-BRIEF — the repère player and the pointer→URL rule.
 *
 * The native module cannot run here, which is exactly why the port exists:
 * this drives the WHOLE behaviour through a fake module and asserts the calls
 * the real one would receive.
 *
 * ⚠ THE FAKE IS CONTRACT-CERTIFIED TO `expo-audio`. `createAudioPlayer` returns
 * an `AudioPlayer`, whose `addListener('playbackStatusUpdate', …)` receives an
 * `AudioStatus` — and the five fields this port reads (`currentTime`,
 * `playing`, `didJustFinish`, `playbackState`, `isLoaded`) are read off THAT
 * type (Audio.types.d.ts l.137+), not invented here. `emit` below is the real
 * module's event, replayed. ⚠ AND THE VALUES ARE BOUNDED TOO: `playbackState`
 * may only carry what `AudioPlayer.kt` l.242-248 can mint — 'ready' |
 * 'buffering' | 'idle' | 'ended' | 'unknown'. The 'failed' emissions further
 * down this file are hand-injected values NO REAL BUILD CAN EMIT, kept only to
 * pin a harmless legacy branch; the shapes a device actually produces are
 * driven in VOIX-MUETTE-2 at the bottom.
 */

/** The five fields of `expo-audio`'s `AudioStatus` the port reads — the fake
 *  is typed to THEM, so a handler signature looser than the real contract is a
 *  compile error here rather than a surprise on a phone. */
type FakeStatus = { currentTime?: number; playing?: boolean; didJustFinish?: boolean; playbackState?: string; isLoaded?: boolean };

interface FakePlayerRec {
  url: string;
  calls: string[];
  emit(status: FakeStatus): void;
  removed: boolean;
  /** DETACHED — `release()` only. Every native call after this point throws,
   *  exactly as expo-modules-core does. */
  mort: boolean;
  /** The MODULE's strong reference dropped — `remove()` only. The shared
   *  object stays attached, so this alone frees nothing deterministically. */
  sorti: boolean;
}

/**
 * ═══ ⚠ ÉCRAN BLANC — WHY THIS FAKE CHANGED (founder, 2026-08-10) ═══
 *
 * The old fake had NO `remove()` on the player and a `release()` that only
 * pushed a string. The real `AudioPlayer` has BOTH — `remove()` is a raw
 * native binding (`AudioModule.types.d.ts` l.176 over
 * `requireNativeModule('ExpoAudio')`), and `release()` is
 * `SharedObject.release()`, documented as: « Any subsequent calls to native
 * functions of the object will throw an error as it is no longer associated
 * with its native counterpart. »
 *
 * So `pause() → release() → remove()` threw on every real detach, while these
 * tests stayed green over it — §9.8, a mock that made the integration look
 * healthier than it was. `stop()` runs inside a React effect at the exact
 * moment a rider accepts a course, so that throw unmounted the app: the blank
 * white screen the founder hit.
 *
 * ⚠ AND THE TWO DEALLOCATORS ARE NOT THE SAME ACT — the fake must not flatten
 * them, or « leaving never throws » would be provable by simply deleting the
 * one that frees:
 *
 *   · `remove()`  drops the MODULE's strong reference and NOTHING else
 *     (iOS `AudioComponentRegistry` removes a dictionary entry; Android
 *     `players.remove(player.id)`). The shared object stays attached, so a
 *     native call after it still works.
 *   · `release()` DETACHES. That is what frees the native player now rather
 *     than at the whim of the JS finaliser — and it is why anything native
 *     after it throws. It is itself safe on an already-detached object.
 *
 * The fake models exactly that, so the ORDER is what the suite proves.
 */
function fakeModule() {
  const made: FakePlayerRec[] = [];
  return {
    made,
    createAudioPlayer(url: string) {
      let listener: ((s: FakeStatus) => void) | null = null;
      const rec: FakePlayerRec = {
        url,
        calls: [],
        removed: false,
        mort: false,
        sorti: false,
        emit(status) { listener?.(status); },
      };
      made.push(rec);
      /** Every native call goes through here — a DETACHED shared object throws
       *  (expo-modules-core resolves the owner through the shared-object
       *  registry and raises NativeSharedObjectNotFound when it is gone). */
      const natif = (nom: string, fn?: () => void): void => {
        if (rec.mort) {
          throw new Error(`Unable to find the native object associated with the given JavaScript object (${nom})`);
        }
        rec.calls.push(nom);
        fn?.();
      };
      return {
        play: () => natif('play'),
        pause: () => natif('pause'),
        seekTo: (s: number) => { natif(`seek:${s}`); },
        // ⚠ NOT a native call, and the ONLY thing that detaches. Safe to call
        // on an object already released — the C++ side guards on native state.
        release: () => { rec.calls.push('release'); rec.mort = true; },
        // A native call that drops the module's reference. It does NOT detach,
        // so `release()` after it still works — and it THROWS if `release()`
        // came first, which is exactly the crash this file exists to pin.
        remove: () => natif('remove', () => { rec.sorti = true; }),
        addListener: (event: 'playbackStatusUpdate', fn: (s: FakeStatus) => void) => {
          expect(event, 'expo-audio names this event `playbackStatusUpdate`').toBe('playbackStatusUpdate');
          listener = fn;
          return { remove: () => { rec.removed = true; listener = null; } };
        },
      };
    },
  };
}

describe('COURSE-BRIEF — the buyer’s repère plays on the rider’s screen', () => {
  it('creates ONE player and plays it', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    await port.play('https://media.example/media/11111111-2222-4333-8444-555555555555');
    expect(mod.made).toHaveLength(1);
    expect(mod.made[0]?.url).toBe('https://media.example/media/11111111-2222-4333-8444-555555555555');
    expect(mod.made[0]?.calls).toEqual(['play']);
  });

  it('⚠ a second tap on the SAME note reuses ONE player — never a second voice over the first', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    await port.play('https://media.example/media/11111111-2222-4333-8444-555555555555');
    await port.play('https://media.example/media/11111111-2222-4333-8444-555555555555');
    expect(mod.made, 'a second player would play two voices at once').toHaveLength(1);
    // VOIX-ÉTAT-2: RESUME, not restart. A rider who paused at « portail bleu »
    // and taps again continues there; only a note that RAN OUT rewinds (below).
    expect(mod.made[0]?.calls).toEqual(['play', 'play']);
  });

  it('⚠ but a note that RAN OUT rewinds before playing again', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    await port.play('https://media.example/media/11111111-2222-4333-8444-555555555555');
    mod.made[0]?.emit({ didJustFinish: true, playing: false, currentTime: 0 });
    await port.play('https://media.example/media/11111111-2222-4333-8444-555555555555');
    expect(mod.made[0]?.calls, 'without the rewind the second tap plays silence').toEqual(['play', 'seek:0', 'play']);
  });

  it('⚠ a DIFFERENT note releases the old player — a rider’s phone is 1 GB', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    await port.play('https://media.example/media/11111111-2222-4333-8444-555555555551');
    await port.play('https://media.example/media/11111111-2222-4333-8444-555555555552');
    expect(mod.made).toHaveLength(2);
    expect(mod.made[0]?.calls).toContain('remove');
    expect(mod.made[1]?.calls).toEqual(['play']);
  });

  it('stop() releases, so leaving the screen never leaks a voice', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    await port.play('https://media.example/media/11111111-2222-4333-8444-555555555555');
    port.stop();
    // THE ORDER IS THE FIX. `release()` LAST: it detaches, so anything native
    // after it throws — and it is what frees the native player deterministically
    // instead of leaving it to the JS finaliser on a 1 GB phone.
    expect(mod.made[0]?.calls).toEqual(['play', 'pause', 'remove', 'release']);
    expect(mod.made[0]?.removed, 'a live status listener on a released player leaks too').toBe(true);
  });
});

/**
 * ═══ ⚠ ÉCRAN BLANC — « the screen goes all white and blank » ═══
 *
 * FOUNDER REPORT (2026-08-10): « On sera app when I tap accept button to accept
 * the order the screen goes all white and blank ».
 *
 * The tap flipped `repereVisible` false, which fires
 * `if (!repereVisible) repereAudio?.stop()` — a PASSIVE REACT EFFECT. A throw
 * there has no boundary above it: React unmounts the whole tree and the rider
 * is left with a blank screen and no course.
 *
 * ⚠ THE TRIGGER MOVED, THE HAZARD DID NOT (2026-08-15). Accepting no longer
 * flips that predicate — the voice row now follows the rider onto the road, so
 * `repereVisible` falls only when the row itself leaves the screen: the course
 * ending, or the rider dropping off the SE1 ladder (off shift). Those are the
 * taps that reach this effect today, and `rendu-course`'s « the voice stops
 * when the row leaves » walk drives one of them on the real screen.
 *
 * So these tests do not ask « did it release ». They ask the only question the
 * screen cares about: CAN LEAVING EVER THROW? The answer must be no, on a live
 * player, on a dead one, and on the second stop in a row.
 */
describe('ÉCRAN BLANC — leaving the screen can never take the app down with it', () => {
  const NOTE = 'https://media.example/media/11111111-2222-4333-8444-555555555555';

  it('stop() on a LIVE player does not throw — this is the accept-tap crash', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    await port.play(NOTE);
    // Before the fix this threw on `remove()` after `release()` had detached
    // the object, and the effect that called it blanked the screen.
    expect(() => port.stop()).not.toThrow();
    // …and it is STILL freed both ways: the module lets go of it, and the
    // shared object is detached so the native player deallocates now.
    expect(mod.made[0]?.sorti, 'the module must let go of the player').toBe(true);
    expect(mod.made[0]?.mort, 'and it must be DETACHED, or freeing waits on the GC').toBe(true);
  });

  it('a SECOND stop is quiet — the effect re-runs, and a dead player is not an error', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    await port.play(NOTE);
    port.stop();
    expect(() => port.stop()).not.toThrow();
    // …and it never reaches back into the freed object to do it again.
    expect(mod.made[0]?.calls.filter((c) => c === 'remove')).toHaveLength(1);
    expect(mod.made[0]?.calls.filter((c) => c === 'release')).toHaveLength(1);
  });

  it('stop() with NO player never touched anything to begin with', () => {
    const mod = fakeModule();
    expect(() => repereAudioOver(mod).stop()).not.toThrow();
    expect(mod.made).toHaveLength(0);
  });

  it('pause() on a player the OS already reclaimed does not throw — it runs off a tap', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    await port.play(NOTE);
    // The phone got hot and the platform freed the player under us.
    (mod.made[0] as { mort: boolean }).mort = true;
    expect(() => port.pause()).not.toThrow();
  });

  it('a SECOND note replaces the first without throwing — the same detach, mid-play', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    await port.play('https://media.example/media/11111111-2222-4333-8444-555555555551');
    // This detach used to throw INSIDE play()'s try, which turned a new course's
    // repère into an « echec » line and no sound at all.
    await port.play('https://media.example/media/11111111-2222-4333-8444-555555555552');
    expect(mod.made).toHaveLength(2);
    expect(mod.made[1]?.calls, 'the new note must actually play').toEqual(['play']);
  });

  it('and the row is told the truth after a stop — rest, never a lingering « Pause »', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    const vus: RepereAudioEtat[] = [];
    port.subscribe((e) => vus.push(e));
    await port.play(NOTE);
    port.stop();
    expect(vus.at(-1)).toEqual({ playing: false, seconds: 0, echec: false });
  });
});

/**
 * ═══ VOIX-ÉTAT-2 — WHAT THE ROW IS ALLOWED TO SHOW ═══
 *
 * FOUNDER REPORT (2026-08-09): « the button is not displaying the pause sign
 * and the seconds are not counting ». Both were true of a port that reported
 * nothing: the screen set « playing » on tap and had no clock to drive. These
 * assert the STATE THE ROW RENDERS FROM, which is the whole of the bug.
 */
describe('VOIX-ÉTAT-2 — the player reports what it is actually doing', () => {
  const URL_NOTE = 'https://media.example/media/11111111-2222-4333-8444-555555555555';
  const watch = (port: { subscribe(f: (e: RepereAudioEtat) => void): () => void }): RepereAudioEtat[] => {
    const seen: RepereAudioEtat[] = [];
    port.subscribe((e) => seen.push(e));
    return seen;
  };

  it('⚠ THE SECONDS COUNT — every status update moves the clock the row shows', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    const seen = watch(port);
    await port.play(URL_NOTE);
    mod.made[0]?.emit({ playing: true, currentTime: 0.4 });
    mod.made[0]?.emit({ playing: true, currentTime: 1.8 });
    mod.made[0]?.emit({ playing: true, currentTime: 7.2 });
    expect(seen.map((e) => e.seconds), 'a frozen clock is the reported bug').toEqual([0, 1, 7]);
    expect(seen.every((e) => e.playing)).toBe(true);
  });

  it('⚠ THE NOTE ENDING PUTS THE ROW BACK — no « Pause » sitting over silence', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    const seen = watch(port);
    await port.play(URL_NOTE);
    mod.made[0]?.emit({ playing: true, currentTime: 3 });
    mod.made[0]?.emit({ didJustFinish: true, playing: false, currentTime: 0 });
    expect(seen.at(-1)).toEqual({ playing: false, seconds: 0, echec: false });
  });

  it('⚠ PAUSE REPORTS ITSELF — it never waits for an event that may not come', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    const seen = watch(port);
    await port.play(URL_NOTE);
    mod.made[0]?.emit({ playing: true, currentTime: 5 });
    port.pause();
    expect(mod.made[0]?.calls, 'the sound must actually stop').toContain('pause');
    // The position is KEPT: the row shows where the buyer's sentence was cut.
    expect(seen.at(-1)).toEqual({ playing: false, seconds: 5, echec: false });
  });

  it('stop() reports rest, so a screen that leaves cannot leave a lying glyph', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    const seen = watch(port);
    await port.play(URL_NOTE);
    mod.made[0]?.emit({ playing: true, currentTime: 9 });
    port.stop();
    expect(seen.at(-1)).toEqual({ playing: false, seconds: 0, echec: false });
  });

  it('unsubscribing actually stops the updates', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    const seen: RepereAudioEtat[] = [];
    const off = port.subscribe((e) => seen.push(e));
    await port.play(URL_NOTE);
    mod.made[0]?.emit({ playing: true, currentTime: 1 });
    const before = seen.length;
    off();
    mod.made[0]?.emit({ playing: true, currentTime: 2 });
    expect(seen).toHaveLength(before);
  });

  it('RESUME AFTER A NATURAL END IS STILL A RESUME — `finished` is not sticky', async () => {
    // What this replaces: `finished` was set on didJustFinish and cleared only
    // by stop() or a different url, so EVERY tap after one natural end rewound
    // — pause-then-resume restarted the note, contradicting the port's own
    // contract (verifier, 2026-08-09).
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    await port.play(URL_NOTE);
    mod.made[0]?.emit({ didJustFinish: true, playing: false, currentTime: 0 });
    await port.play(URL_NOTE); // the rewind that IS correct
    mod.made[0]?.emit({ playing: true, currentTime: 4 });
    port.pause();
    await port.play(URL_NOTE); // …and this one must NOT rewind
    expect(mod.made[0]?.calls).toEqual(['play', 'seek:0', 'play', 'pause', 'play']);
  });

  it('RESUME REPORTS ITSELF — no « Écouter » over live sound while a status is awaited', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    const seen = watch(port);
    await port.play(URL_NOTE);
    mod.made[0]?.emit({ playing: true, currentTime: 6 });
    port.pause();
    await port.play(URL_NOTE);
    // Immediately, before any further status: playing again, position kept.
    expect(seen.at(-1)).toEqual({ playing: true, seconds: 6, echec: false });
  });

  it('A TRAILING STATUS AFTER THE END IS IGNORED — no frozen clock beside « Écouter »', async () => {
    // Native players may emit one more status carrying currentTime === duration
    // after finishing. Taking it would put « 0:07 » next to a resting control.
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    const seen = watch(port);
    await port.play(URL_NOTE);
    mod.made[0]?.emit({ playing: true, currentTime: 6 });
    mod.made[0]?.emit({ didJustFinish: true, playing: false, currentTime: 7 });
    mod.made[0]?.emit({ playing: false, currentTime: 7 });
    expect(seen.at(-1)).toEqual({ playing: false, seconds: 0, echec: false });
  });

  it('« m:ss » matches the shape the buyer and the console already show', () => {
    expect(dureeVoix(0)).toBe('0:00');
    expect(dureeVoix(7)).toBe('0:07');
    expect(dureeVoix(65)).toBe('1:05');
    expect(dureeVoix(-3), 'a negative position is never printed').toBe('0:00');
  });
});

describe('COURSE-BRIEF — a pointer becomes a URL only against the app’s OWN base', () => {
  it('builds the url from base + ref, tolerating a trailing slash', () => {
    expect(mediaUrl('https://media.example', 'media/11111111-2222-4333-8444-555555555555')).toBe('https://media.example/media/11111111-2222-4333-8444-555555555555');
    expect(mediaUrl('https://media.example/', 'media/9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f')).toBe(
      'https://media.example/media/9f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f',
    );
  });

  it('⚠ refuses anything that could point the phone somewhere else', () => {
    // The Worker bounds the ref too; this is the second half of the same law.
    for (const bad of ['https://elsewhere.example/x.jpg', 'media/../secrets', '../x', 'notmedia/x', '']) {
      expect(mediaUrl('https://media.example', bad), bad).toBeNull();
    }
  });

  it('no base configured means NO url — never a half-built one', () => {
    expect(mediaUrl(null, 'media/11111111-2222-4333-8444-555555555555')).toBeNull();
    expect(mediaUrl('', 'media/11111111-2222-4333-8444-555555555555')).toBeNull();
    expect(mediaUrl('https://media.example', null)).toBeNull();
  });
});

/**
 * ═══ THE ROW IS ACTUALLY WIRED TO THAT STATE ═══
 *
 * A port that reports is not a port that is READ. The previous cut of this
 * screen passed `time=""` and a boolean nothing ever cleared, so the port could
 * have been perfect and the rider would still have seen a frozen face. These
 * pin the CALL SITES — the two places the founder was looking at.
 */
describe('VOIX-ÉTAT-2 — the rider’s row renders from the player, not from a guess', () => {
  const app = readFileSync(join(import.meta.dirname, '..', 'App.tsx'), 'utf8');
  const kit = readFileSync(join(import.meta.dirname, '..', 'src', 'ui', 'faso-kit.tsx'), 'utf8');

  it('⚠ the glyph SWAPS — the row no longer draws IconEcouter unconditionally', () => {
    expect(kit).toMatch(/playing\s*\n?\s*\?\s*<IconPause/);
    expect(kit).toContain('<IconEcouter');
  });

  it('the screen subscribes to the player and never sets « playing » itself', () => {
    expect(app).toContain('repereAudio.subscribe(setRepereEtat)');
    expect(app, 'the boolean the screen used to assert is gone').not.toContain('setRepereJoue');
  });

  it('⚠ the clock is fed by the reported position, not by an empty string', () => {
    expect(app).toContain('time={repereEtat.playing || repereEtat.seconds > 0 ? dureeVoix(repereEtat.seconds) : \'\'}');
    expect(app).toContain('playing={repereEtat.playing}');
  });

  it('tapping while it plays PAUSES — the pause glyph means something', () => {
    expect(app).toContain('if (repereEtat.playing) {');
    expect(app).toContain('repereAudio.pause();');
  });

  it('the row is CALLED, not mounted as a component type — no remount per tick', () => {
    // `<RepereVoix />` gave React a NEW component type on every status update
    // (twice a second while a note plays), so it unmounted and remounted the
    // Pressable + SVG subtree — on a 1 GB Android (verifier, 2026-08-09).
    expect(app).toContain('{RepereVoix()}');
    // Scanned over CODE, not prose: the comment at the definition quotes the
    // banned form on purpose, and a pin that cannot tell the two apart would
    // force the explanation out of the file it explains.
    const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, 'the element form is what remounts').not.toContain('<RepereVoix />');
  });

  it('THE DEMO ROW NO LONGER CLAIMS PLAYBACK IT CANNOT DELIVER', () => {
    // This tree has no audio element at all. While the row always drew a
    // triangle that was merely inert; once the glyph learned to swap, a local
    // toggle manufactured the founder's exact symptom — a pause sign and a
    // frozen clock over silence — on the build a bare `expo start` opens.
    const bloc = app.slice(app.indexOf('const voiceFor = () => ({'), app.indexOf('const relaisFor'));
    expect(bloc, 'the demo voiceFor anchor').toContain('label:');
    expect(bloc).toContain('playing: false,');
    expect(bloc, 'a hardcoded clock over no audio').not.toContain("'0:11'");
  });

  it('the label toggles with the truth, from the catalog — never inline French', () => {
    expect(app).toContain("t(repereEtat.playing ? 'repere.voix_pause' : 'repere.voix_ecouter')");
  });
});

/**
 * ═══ « I STILL DO NOT SEE THE AUDIO » (founder, 2026-08-09) ═══
 *
 * Three different situations rendered byte-identical NOTHING: this course has
 * no voice note; the media base is unset; `expo-audio` cannot load. The third
 * is not an absence, it is a FAULT — `requireNativeModule('ExpoAudio')` runs at
 * expo-audio's module scope and throws on any binary built before the dependency
 * was added, which an OTA update cannot fix because it ships JavaScript, not
 * native code. Folding a broken build into the same silence as « nothing to
 * play » is what left the founder with an empty space and no cause.
 *
 * These pin the SHAPE of the branch, in order — the repo's source-discipline
 * idiom (no RN renderer here), each one mutation-checked.
 */
describe('the repère note — an absence and a fault are not the same silence', () => {
  const app = readFileSync(join(import.meta.dirname, '..', 'App.tsx'), 'utf8');
  const catalog = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'i18n', 'catalog.json'), 'utf8'),
  ) as { key: string; fr: string; register: string }[];

  /** The body of RepereVoix, sliced so the assertions cannot match elsewhere. */
  const body = app.slice(app.indexOf('const RepereVoix = useCallback('), app.indexOf('/** The supplier’s readiness photos'));

  it('NO NOTE stays silent — a course without a note grows no row', () => {
    expect(body).toMatch(/if \(repereUrl === null\) return null;/);
  });

  it('⚠ A NOTE THAT CANNOT BE PLAYED SAYS SO — it no longer returns null', () => {
    expect(body, 'the player-missing branch must render an honest line').toMatch(
      /if \(repereAudio === null\) return <FasoBody>\{t\('repere\.voix_indisponible'\)\}<\/FasoBody>;/,
    );
    // the two causes are no longer collapsed into one guard
    expect(body, 'the old combined guard is back — the fault is hidden again').not.toMatch(
      /repereUrl === null \|\| repereAudio === null/,
    );
  });

  it('⚠ ORDER: absence is judged BEFORE the fault, or a noteless course would claim a note exists', () => {
    const noNote = body.indexOf('repereUrl === null');
    const noPlayer = body.indexOf('repereAudio === null');
    expect(noNote).toBeGreaterThan(-1);
    expect(noPlayer).toBeGreaterThan(-1);
    expect(noNote, 'the fault branch runs first — « une note vocale existe » over a course with none').toBeLessThan(noPlayer);
  });

  it('the honest line is a real catalog string, registered and in French Voice', () => {
    const entry = catalog.find((e) => e.key === 'repere.voix_indisponible');
    expect(entry, 'the string is inline instead of in the catalog (Law 6)').toBeDefined();
    expect(entry?.register).toBe('neutral');
    // it names what exists, what cannot happen, and what to do instead
    expect(entry?.fr).toMatch(/note vocale/i);
    expect(entry?.fr).toMatch(/repère écrit/i);
  });
});

/**
 * ═══ VOIX-MUETTE (founder, 2026-08-09: « When I tap the audio on sera to
 * listen I am not hearing anything ») ═══
 *
 * Two silences, two answers. The iPhone's hardware mute switch: expo-audio's
 * default iOS session respects it, so the row counted seconds over nothing —
 * the session now plays in silent mode, set ONCE before the first playback
 * (a spoken repère is the product, not a notification sound). And a load that
 * FAILS (bad ref, dead network): the player names it in `playbackState`, and
 * the port now forwards that fact instead of leaving an eternal « Écouter ».
 */
describe('VOIX-MUETTE — the silent switch and the named failure', () => {
  it('CONTRACT-CERTIFIED: the real expo-audio exports setAudioModeAsync, playsInSilentMode and playbackState', () => {
    const expoAudio = readFileSync(
      join(import.meta.dirname, '..', 'node_modules', 'expo-audio', 'build', 'ExpoAudio.js'),
      'utf8',
    );
    expect(expoAudio).toContain('export async function setAudioModeAsync');
    const types = readFileSync(
      join(import.meta.dirname, '..', 'node_modules', 'expo-audio', 'build', 'Audio.types.d.ts'),
      'utf8',
    );
    expect(types).toContain('playsInSilentMode');
    expect(types).toContain('playbackState');
    // VOIX-MUETTE-2 — the load-confirmation fact both detectors stand down on.
    expect(types).toContain('isLoaded');
  });

  it('the session is set to play in silent mode ONCE, BEFORE the first playback — and a second play never re-asks', async () => {
    const calls: unknown[] = [];
    const ordre: string[] = [];
    const fake = {
      createAudioPlayer: () => ({
        play: () => ordre.push('play'),
        pause: () => {},
        seekTo: () => {},
        addListener: () => ({ remove: () => {} }),
      }),
      setAudioModeAsync: async (mode: unknown) => {
        calls.push(mode);
        ordre.push('mode');
      },
    };
    const port = repereAudioOver(fake as never);
    await port.play('https://media/a');
    await port.play('https://media/a');
    expect(calls).toEqual([{ playsInSilentMode: true }]);
    expect(ordre[0], 'the mode must be set BEFORE the first play, or the first note stays muted').toBe('mode');
  });

  it('a web build without setAudioModeAsync still plays — the call is optional, never a crash', async () => {
    let played = 0;
    const fake = {
      createAudioPlayer: () => ({
        play: () => { played += 1; },
        pause: () => {},
        seekTo: () => {},
        addListener: () => ({ remove: () => {} }),
      }),
    };
    const port = repereAudioOver(fake as never);
    await port.play('https://media/a');
    expect(played).toBe(1);
  });

  it('a status NAMING a failure reaches the screen as echec — and a fresh play clears it', async () => {
    let onStatus: ((s: Record<string, unknown>) => void) | undefined;
    const fake = {
      createAudioPlayer: () => ({
        play: () => {},
        pause: () => {},
        seekTo: () => {},
        addListener: (_: string, fn: (s: Record<string, unknown>) => void) => {
          onStatus = fn;
          return { remove: () => {} };
        },
      }),
      setAudioModeAsync: async () => {},
    };
    const port = repereAudioOver(fake as never);
    const vus: unknown[] = [];
    port.subscribe((e) => vus.push(e));
    await port.play('https://media/mauvaise');
    onStatus?.({ playbackState: 'failed' });
    expect(vus.at(-1)).toEqual({ playing: false, seconds: 0, echec: true });
    // the rider taps again: the failure fact clears with the fresh attempt
    await port.play('https://media/mauvaise');
    onStatus?.({ currentTime: 1, playing: true });
    expect(vus.at(-1)).toEqual({ playing: true, seconds: 1, echec: false });
  });

  it('a failed player is REBUILT on the retry, never resumed — « réessayez » must be a true sentence', async () => {
    let onStatus: ((s: Record<string, unknown>) => void) | undefined;
    let crees = 0;
    const fake = {
      createAudioPlayer: () => {
        crees += 1;
        return {
          play: () => {},
          pause: () => {},
          seekTo: () => {},
          addListener: (_: string, fn: (s: Record<string, unknown>) => void) => {
            onStatus = fn;
            return { remove: () => {} };
          },
        };
      },
      setAudioModeAsync: async () => {},
    };
    const port = repereAudioOver(fake as never);
    await port.play('https://media/a');
    onStatus?.({ playbackState: 'failed' });
    // The retry the echec line asks for: resuming the dead player would replay
    // the failure — the port must build a FRESH one.
    await port.play('https://media/a');
    expect(crees, 'the failed player must be released and recreated').toBe(2);
    let last: RepereAudioEtat | undefined;
    port.subscribe((e) => { last = e; });
    onStatus?.({ currentTime: 3, playing: true });
    expect(last).toEqual({ playing: true, seconds: 3, echec: false });
  });

  it('a play that THROWS lands on the echec state, never on a silent rejection', async () => {
    const fake = {
      createAudioPlayer: () => {
        throw new Error('native load refused');
      },
      setAudioModeAsync: async () => {},
    };
    const port = repereAudioOver(fake as never);
    const vus: unknown[] = [];
    port.subscribe((e) => vus.push(e));
    // Before the fix this REJECTED, App.tsx caught it with stop(), and the row
    // went back to « Écouter » with echec:false — a silence wearing a calm face.
    await expect(port.play('https://media/morte')).resolves.toBeUndefined();
    expect(vus.at(-1)).toEqual({ playing: false, seconds: 0, echec: true });
  });

  it('the SCREEN says it: the echec line renders under the row, from the catalog (call site)', () => {
    const app = readFileSync(join(import.meta.dirname, '..', 'App.tsx'), 'utf8');
    expect(app).toMatch(/\{repereEtat\.echec \? <FasoBody>\{t\('repere\.voix_echec'\)\}<\/FasoBody> : null\}/);
    const catalog = JSON.parse(
      readFileSync(join(import.meta.dirname, '..', 'i18n', 'catalog.json'), 'utf8'),
    ) as { key: string }[];
    expect(catalog.some((e) => e.key === 'repere.voix_echec')).toBe(true);
  });
});

/**
 * ═══ VOIX-MUETTE-2 — THE FAILURES expo-audio 1.1.1 CAN ACTUALLY EMIT ═══
 *
 * FOUNDER, on his iPhone (2026-08-14): the note would not play and the row
 * said « Écouter » forever, with no message. The 'failed' statuses above
 * exercise a branch NO REAL BUILD CAN REACH: Android's `playbackState` only
 * ever reads 'ready'|'buffering'|'idle'|'ended'|'unknown' (`AudioPlayer.kt`
 * l.242-248, zero `onPlayerError` hits in the android source), and iOS emits
 * `playbackStatusUpdate` ONLY on `.readyToPlay`. A failed load is therefore
 * ETERNAL SILENCE (iOS — what the founder hit) or a drop to the 'idle'
 * terminal (Android). These drive the port with exactly those two shapes,
 * against the detectors ported from the Shop+ reseller app's voice-capture.
 */
describe('VOIX-MUETTE-2 — the load that fails without ever saying so', () => {
  const NOTE = 'https://media.example/media/11111111-2222-4333-8444-555555555555';
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const watch = (port: { subscribe(f: (e: RepereAudioEtat) => void): () => void }): RepereAudioEtat[] => {
    const seen: RepereAudioEtat[] = [];
    port.subscribe((e) => seen.push(e));
    return seen;
  };

  it('⚠ a load that never says ANYTHING → échec at 10 s exactly, torn down — the iPhone shape', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    const vus = watch(port);
    await port.play(NOTE);
    // 9.999 s of silence is a slow 2G load, not a failure.
    vi.advanceTimersByTime(9_999);
    expect(vus.some((e) => e.echec), 'a slow load must not be called a failure').toBe(false);
    vi.advanceTimersByTime(1);
    expect(vus.at(-1), 'the watchdog must declare the failure the library never names').toEqual({
      playing: false, seconds: 0, echec: true,
    });
    // …and the attempt is TORN DOWN, not left a zombie that could start
    // sound two minutes later over a row that already said échec.
    expect(mod.made[0]?.calls).toEqual(['play', 'pause', 'remove', 'release']);
    expect(mod.made[0]?.removed, 'the dead attempt must not keep a live listener').toBe(true);
  });

  it('⚠ the failure is RECOVERABLE — a new tap rebuilds from scratch and plays', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    const vus = watch(port);
    await port.play(NOTE);
    vi.advanceTimersByTime(10_000);
    expect(vus.at(-1)?.echec).toBe(true);
    // The retry the echec line asks for: « réessayez » must be a true sentence.
    await port.play(NOTE);
    expect(mod.made, 'the retry must build a FRESH player').toHaveLength(2);
    mod.made[1]?.emit({ isLoaded: true, playbackState: 'ready', playing: true, currentTime: 1 });
    expect(vus.at(-1)).toEqual({ playing: true, seconds: 1, echec: false });
    // The belt plays ONCE — `isLoaded` arriving must not stack a second play.
    expect(mod.made[1]?.calls).toEqual(['play']);
    // …and the confirmed load stood the retry's own watchdog down.
    vi.advanceTimersByTime(60_000);
    expect(vus.at(-1)?.echec, 'a loaded note must never be failed by a stale clock').toBe(false);
  });

  it('a load the player CONFIRMS is never failed — ten seconds of playback is not ten of silence', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    const vus = watch(port);
    await port.play(NOTE);
    mod.made[0]?.emit({ isLoaded: true, playbackState: 'ready', playing: true, currentTime: 0.5 });
    vi.advanceTimersByTime(60_000);
    expect(vus.some((e) => e.echec)).toBe(false);
    expect(mod.made[0]?.calls, 'play() exactly once — the immediate call won the race').toEqual(['play']);
  });

  it('⚠ buffering→idle is ExoPlayer’s error terminal — échec NOW, and only once', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    const vus = watch(port);
    await port.play(NOTE);
    mod.made[0]?.emit({ playbackState: 'buffering', isLoaded: false, playing: false, currentTime: 0 });
    expect(vus.at(-1)?.echec, 'buffering is a healthy road, not a failure').toBe(false);
    mod.made[0]?.emit({ playbackState: 'idle', isLoaded: false, playing: false, currentTime: 0 });
    expect(vus.at(-1)).toEqual({ playing: false, seconds: 0, echec: true });
    // ONE failure, never two: declaring it killed the watchdog, so the same
    // dead load cannot report again at the 10 s mark.
    vi.advanceTimersByTime(60_000);
    expect(vus.filter((e) => e.echec)).toHaveLength(1);
  });

  it('an idle ECHO before anything non-idle does not false-fire — the detector arms on non-idle only', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    const vus = watch(port);
    await port.play(NOTE);
    // A pre-buffering idle echo, before the pipeline has said anything real.
    mod.made[0]?.emit({ playbackState: 'idle', isLoaded: false, playing: false, currentTime: 0 });
    expect(vus.some((e) => e.echec), 'a pre-buffering idle is not the error terminal').toBe(false);
    mod.made[0]?.emit({ isLoaded: true, playbackState: 'ready', playing: true, currentTime: 1 });
    vi.advanceTimersByTime(60_000);
    expect(vus.some((e) => e.echec), 'the note loaded — no failure may ever fire').toBe(false);
  });

  it('stop() during a hung load kills the watchdog — leaving is never followed by a failure line', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    const vus = watch(port);
    await port.play(NOTE);
    // The rider accepts the course; the row disappears; stop() runs in the effect.
    port.stop();
    vi.advanceTimersByTime(60_000);
    expect(vus.some((e) => e.echec), 'a failure line after the screen left is noise about nothing').toBe(false);
    expect(vus.at(-1)).toEqual({ playing: false, seconds: 0, echec: false });
  });
});
