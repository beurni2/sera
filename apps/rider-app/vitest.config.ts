import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * ═══ RENDU-RÉEL — why this app finally has a vitest config ═══
 *
 * It had none: tests ran on defaults, which is why every one of them was a
 * source scan or a pure-model unit. `App.tsx` imports `react-native`, and
 * `react-native` cannot load under vitest — so the screens were never mounted,
 * and « does this screen work » was proven by nobody.
 *
 * Three bugs shipped on 2026-08-10 through that hole, all the same shape: a
 * screen that renders and cannot be used. The aliases below are what close it.
 *
 * ⚠ THE ALIASES ARE NATIVE BOUNDARIES ONLY. Every one of them stands in for a
 * module that needs a phone (`react-native`, `react-native-svg`, four
 * `expo-*`). NOTHING of this app's own code is aliased — the screens, the
 * ports, the models and the catalog under test are the real files, and the
 * doubles' bounds are stated in `test/doubles/react-native.tsx` and enforced
 * by `test/rendu-harness.test.ts`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    setupFiles: [at('./test/setup.ts')],
  },
  resolve: {
    alias: {
      'react-native-svg': at('./test/doubles/react-native-svg.tsx'),
      'react-native': at('./test/doubles/react-native.tsx'),
      'expo-status-bar': at('./test/doubles/expo-status-bar.tsx'),
      'expo-file-system': at('./test/doubles/expo-file-system.ts'),
      'expo-network': at('./test/doubles/expo-network.ts'),
      'expo-crypto': at('./test/doubles/expo-crypto.ts'),
      // ⚠ Carries the REAL native failure mode — see the file header. Without
      // it the « écran blanc » cannot be reproduced, and this harness's
      // headline test would be proving nothing.
      'expo-audio': at('./test/doubles/expo-audio.ts'),
    },
  },
});
