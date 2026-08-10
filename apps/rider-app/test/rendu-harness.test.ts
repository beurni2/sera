import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as double from './doubles/react-native';
import * as svgDouble from './doubles/react-native-svg';
import * as fsDouble from './doubles/expo-file-system';
import * as netDouble from './doubles/expo-network';
import * as cryptoDouble from './doubles/expo-crypto';

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

/**
 * ⚠ BOTH QUOTE STYLES, AND THE NON-NAMED FORMS. `test/startup-graph.test.ts`
 * already paid for this lesson in this repo: a single-quote-only regex went
 * green over `import { Modal } from "react-native";` — `Modal` undefined at
 * runtime, the modal rendering as nothing, the sweep's own docblock claiming
 * that could not happen. Default and namespace imports are refused outright,
 * because a namespace import would let ANY member through unswept.
 */
const NAMED = /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
const WHOLE = /import\s+(?!type\s)(\w+|\*\s+as\s+\w+)\s*(?:,\s*\{[^}]*\})?\s*from\s*['"]([^'"]+)['"]/g;

/** Each doubled module, with the module object the app will actually get. */
const DOUBLED: readonly { readonly spec: string; readonly mod: Record<string, unknown> }[] = [
  { spec: 'react-native', mod: double as unknown as Record<string, unknown> },
  { spec: 'react-native-svg', mod: svgDouble as unknown as Record<string, unknown> },
  { spec: 'expo-file-system', mod: fsDouble as unknown as Record<string, unknown> },
  { spec: 'expo-network', mod: netDouble as unknown as Record<string, unknown> },
  { spec: 'expo-crypto', mod: cryptoDouble as unknown as Record<string, unknown> },
];

describe('every double is CERTIFIED to what the app imports', () => {
  it('each named import the app takes from a doubled module exists on that double', () => {
    const missing: string[] = [];
    let seen = 0;
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const rel = f.replace(appDir, '.');
      for (const m of src.matchAll(NAMED)) {
        const target = DOUBLED.find((d) => d.spec === m[2]);
        if (target === undefined) continue;
        const typeOnly = /import\s*type\s*\{/.test(m[0]);
        for (const raw of (m[1] ?? '').split(',')) {
          const trimmed = raw.trim();
          if (trimmed === '') continue;
          seen += 1;
          const name = trimmed.replace(/^type\s+/, '').split(/\s+as\s+/)[0]!.trim();
          // Types vanish at runtime; only values must exist on the double.
          if (typeOnly || trimmed.startsWith('type ')) continue;
          if (!(name in target.mod)) missing.push(`${name} from '${m[2]}' (${rel})`);
        }
      }
      for (const m of src.matchAll(WHOLE)) {
        const target = DOUBLED.find((d) => d.spec === m[2]);
        if (target === undefined) continue;
        const form = (m[1] ?? '').trim();
        const ns = /^\*\s+as\s+(\w+)$/.exec(form);
        if (ns !== null) {
          /**
           * ⚠ A NAMESPACE IMPORT LETS EVERY MEMBER THROUGH UNSWEPT — and the
           * app has two (`import * as Crypto from 'expo-crypto'`). Exempting
           * them would be the sweep excusing its own blind spot, so instead
           * every `Alias.member` this file actually uses is checked against
           * the double. A new `Crypto.digestString(...)` that the double
           * lacks fails HERE rather than arriving as `undefined` on a screen.
           */
          const used = new RegExp(`\\b${ns[1]}\\.(\\w+)`, 'g');
          let any = false;
          for (const u of src.matchAll(used)) {
            any = true;
            seen += 1;
            const name = u[1]!;
            if (!(name in target.mod)) missing.push(`${ns[1]}.${name} from '${m[2]}' (${rel})`);
          }
          if (!any) missing.push(`namespace import « ${form} » from '${m[2]}' with no readable use (${rel})`);
          continue;
        }
        // A DEFAULT import. `react-native-svg` legitimately has one (the icons
        // import `Svg` that way); anything else is unsweepable and refused.
        if (m[2] !== 'react-native-svg') {
          missing.push(`unsweepable import form « ${form} » from '${m[2]}' (${rel})`);
        }
      }
    }
    expect(seen, 'the sweep found no imports — it has stopped looking').toBeGreaterThan(15);
    expect(missing, 'the app imports these and the doubles do not provide them').toEqual([]);
  });

  it('the svg double keeps its default export — the icons import Svg that way', () => {
    expect((svgDouble as unknown as { default?: unknown }).default).toBeDefined();
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
