import * as expoAudio from './doubles/expo-audio';

/**
 * ═══ RENDU-RÉEL — the `require` Metro gives the app, and vitest does not ═══
 *
 * `resolveRepereAudio()` loads its native module with `require('expo-audio')`
 * inside a try/catch — deliberately, so a build without the module degrades to
 * an honest « cette version ne peut pas la lire » instead of failing to boot.
 *
 * On a phone Metro provides `require`. Under vitest the app is ESM, `require`
 * is undefined, the catch fires, and the resolver answers `null` — so the
 * repère row renders its absent-capability state and NO PLAYER IS EVER MADE.
 * That would make the « écran blanc » crash unreproducible: the very bug this
 * harness was built for would sit outside it.
 *
 * So this shim stands in for Metro's `require`, for the native modules only,
 * and it throws for anything else — the same answer the real resolver's catch
 * is written to handle.
 */
const NATIVE: Record<string, unknown> = {
  'expo-audio': expoAudio,
};

/**
 * ⚠ IT MUST BE HOOKED AT MODULE RESOLUTION, not on `globalThis`. Vite hands
 * the app a real Node `require`, so a global shim is never consulted: the call
 * reaches node_modules and dies on `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`
 * — caught by the resolver's own catch, answered `null`, and the screen shows
 * « cette version ne peut pas la lire ». Green, and proving nothing.
 *
 * Hooking `Module._load` puts the double exactly where Metro puts the native
 * module. Everything NOT in the table falls through to the real loader, so no
 * other require in the process is affected.
 */
const Module = require('node:module') as {
  _load: (id: string, parent: unknown, isMain: boolean) => unknown;
};
const realLoad = Module._load.bind(Module);
Module._load = (id: string, parent: unknown, isMain: boolean): unknown =>
  Object.prototype.hasOwnProperty.call(NATIVE, id) ? NATIVE[id] : realLoad(id, parent, isMain);
