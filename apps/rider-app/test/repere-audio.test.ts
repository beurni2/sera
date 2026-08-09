import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
 * `AudioStatus` — and the three fields this port reads (`currentTime`,
 * `playing`, `didJustFinish`) are read off THAT type (Audio.types.d.ts l.137+),
 * not invented here. `emit` below is the real module's event, replayed.
 */

/** The three fields of `expo-audio`'s `AudioStatus` the port reads — the fake
 *  is typed to THEM, so a handler signature looser than the real contract is a
 *  compile error here rather than a surprise on a phone. */
type FakeStatus = { currentTime?: number; playing?: boolean; didJustFinish?: boolean };

interface FakePlayerRec {
  url: string;
  calls: string[];
  emit(status: FakeStatus): void;
  removed: boolean;
}

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
        emit(status) { listener?.(status); },
      };
      made.push(rec);
      return {
        play: () => rec.calls.push('play'),
        pause: () => rec.calls.push('pause'),
        seekTo: (s: number) => { rec.calls.push(`seek:${s}`); },
        release: () => rec.calls.push('release'),
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
    expect(mod.made[0]?.calls).toContain('release');
    expect(mod.made[1]?.calls).toEqual(['play']);
  });

  it('stop() releases, so leaving the screen never leaks a voice', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    await port.play('https://media.example/media/11111111-2222-4333-8444-555555555555');
    port.stop();
    expect(mod.made[0]?.calls).toEqual(['play', 'pause', 'release']);
    expect(mod.made[0]?.removed, 'a live status listener on a released player leaks too').toBe(true);
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
    expect(seen.at(-1)).toEqual({ playing: false, seconds: 0 });
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
    expect(seen.at(-1)).toEqual({ playing: false, seconds: 5 });
  });

  it('stop() reports rest, so a screen that leaves cannot leave a lying glyph', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    const seen = watch(port);
    await port.play(URL_NOTE);
    mod.made[0]?.emit({ playing: true, currentTime: 9 });
    port.stop();
    expect(seen.at(-1)).toEqual({ playing: false, seconds: 0 });
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

  it('the label toggles with the truth, from the catalog — never inline French', () => {
    expect(app).toContain("t(repereEtat.playing ? 'repere.voix_pause' : 'repere.voix_ecouter')");
  });
});
