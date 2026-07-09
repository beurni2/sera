import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist' },
  // vitest reads this config: unit tests only — e2e/ belongs to Playwright
  test: {
    include: ['test/**/*.test.ts'],
  },
} as never);
