import { describe, expect, it } from 'vitest';
import { mediaUrl, repereAudioOver } from '../src/net/repere-audio';

/**
 * COURSE-BRIEF — the repère player and the pointer→URL rule.
 *
 * The native module cannot run here, which is exactly why the port exists:
 * this drives the WHOLE behaviour through a fake module and asserts the calls
 * the real one would receive.
 */

function fakeModule() {
  const made: { url: string; calls: string[] }[] = [];
  return {
    made,
    createAudioPlayer(url: string) {
      const rec = { url, calls: [] as string[] };
      made.push(rec);
      return {
        play: () => rec.calls.push('play'),
        pause: () => rec.calls.push('pause'),
        seekTo: (s: number) => { rec.calls.push(`seek:${s}`); },
        release: () => rec.calls.push('release'),
      };
    },
  };
}

describe('COURSE-BRIEF — the buyer’s repère plays on the rider’s screen', () => {
  it('creates ONE player and plays it', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    await port.play('https://media.example/media/abc');
    expect(mod.made).toHaveLength(1);
    expect(mod.made[0]?.url).toBe('https://media.example/media/abc');
    expect(mod.made[0]?.calls).toEqual(['play']);
  });

  it('⚠ a second tap on the SAME note re-seeks it — never a second voice over the first', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    await port.play('https://media.example/media/abc');
    await port.play('https://media.example/media/abc');
    expect(mod.made, 'a second player would play two voices at once').toHaveLength(1);
    expect(mod.made[0]?.calls).toEqual(['play', 'seek:0', 'play']);
  });

  it('⚠ a DIFFERENT note releases the old player — a rider’s phone is 1 GB', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    await port.play('https://media.example/media/one');
    await port.play('https://media.example/media/two');
    expect(mod.made).toHaveLength(2);
    expect(mod.made[0]?.calls).toContain('release');
    expect(mod.made[1]?.calls).toEqual(['play']);
  });

  it('stop() releases, so leaving the screen never leaks a voice', async () => {
    const mod = fakeModule();
    const port = repereAudioOver(mod);
    await port.play('https://media.example/media/abc');
    port.stop();
    expect(mod.made[0]?.calls).toEqual(['play', 'pause', 'release']);
  });
});

describe('COURSE-BRIEF — a pointer becomes a URL only against the app’s OWN base', () => {
  it('builds the url from base + ref, tolerating a trailing slash', () => {
    expect(mediaUrl('https://media.example', 'media/abc')).toBe('https://media.example/media/abc');
    expect(mediaUrl('https://media.example/', 'media/readiness/ord-1')).toBe(
      'https://media.example/media/readiness/ord-1',
    );
  });

  it('⚠ refuses anything that could point the phone somewhere else', () => {
    // The Worker bounds the ref too; this is the second half of the same law.
    for (const bad of ['https://elsewhere.example/x.jpg', 'media/../secrets', '../x', 'notmedia/x', '']) {
      expect(mediaUrl('https://media.example', bad), bad).toBeNull();
    }
  });

  it('no base configured means NO url — never a half-built one', () => {
    expect(mediaUrl(null, 'media/abc')).toBeNull();
    expect(mediaUrl('', 'media/abc')).toBeNull();
    expect(mediaUrl('https://media.example', null)).toBeNull();
  });
});
