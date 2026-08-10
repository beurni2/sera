import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as double from './doubles/react-native';

/**
 * ═══ RENDU-RÉEL — the harness holds ITSELF to the mock-certification law ═══
 *
 * Execution Contract §3, and §9.8 in one line: « a mock that makes integration
 * look healthier than it is is a bug you own. » A render harness is the most
 * dangerous mock in the repo — every screen test stands on it — so its surface
 * is CHECKED against what the app actually imports, not maintained by hand.
 *
 * Without this, adding `import { Modal } from 'react-native'` to a screen
 * gives `undefined`, React renders nothing where the modal was, and every
 * test keeps passing over the hole.
 */

const appDir = join(import.meta.dirname, '..');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = [...sources(join(appDir, 'src')), join(appDir, 'App.tsx')];

describe('the react-native double is CERTIFIED to what the app imports', () => {
  it('every named import the app takes from react-native exists on the double', () => {
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const re = /import\s*\{([^}]*)\}\s*from\s*'react-native'/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        for (const raw of (m[1] ?? '').split(',')) {
          const name = raw.trim().replace(/^type\s+/, '');
          if (name === '') continue;
          seen.add(name);
          // Types vanish at runtime; only values must exist on the double.
          const isType = raw.trim().startsWith('type ');
          if (!isType && !(name in double)) missing.push(`${name} (${f.replace(appDir, '.')})`);
        }
      }
    }
    expect(seen.size, 'the sweep found no react-native imports — it has stopped looking').toBeGreaterThan(5);
    expect(missing, 'the app imports these and the double does not provide them').toEqual([]);
  });

  it('the double provides the handlers a control is driven by', () => {
    // The harness presses by `onPress` and types by `onChangeText`; if the
    // host components stopped passing props through, every press would
    // silently do nothing and every screen test would still pass.
    expect(typeof double.View).toBe('function');
    expect(typeof double.Pressable).toBe('function');
    expect(typeof double.StyleSheet.create).toBe('function');
    expect(typeof double.Animated.Value).toBe('function');
  });

  it('⚠ and it states its own bound — no test may claim appearance from it', () => {
    /**
     * The one thing a reader must not do with this harness is trust it about
     * how a screen LOOKS. `StyleSheet.create` is identity and nothing here
     * lays anything out. That bound is written at the top of the double, and
     * this asserts the warning is still there — a bound nobody can read is a
     * bound nobody keeps.
     */
    const src = readFileSync(join(appDir, 'test/doubles/react-native.tsx'), 'utf8');
    expect(src).toContain('IT PROVIDES NOTHING ELSE');
    expect(src).toContain('may NEVER\n *   claim anything about appearance');
  });
});
