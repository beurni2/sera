import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // REPONSES-ENREGISTREES-1 — inert unless REPONSES_RELEVE is set (see the file).
    setupFiles: ['./test/reponses-releve.ts'],
  },
});
