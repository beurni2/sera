import { defineConfig, devices } from '@playwright/test';

/**
 * Dispatch-console Playwright harness (WO-SE0.1). Chromium is preinstalled in this
 * environment (PLAYWRIGHT_BROWSERS_PATH); PW_EXECUTABLE overrides the
 * browser binary when the pinned @playwright/test build differs from the
 * preinstalled one.
 *
 * TWO PROJECTS, TWO BUILDS (REPROGRAMMATION-1). `chromium` serves the build
 * made with NO logistics base — the not-configured path every earlier spec
 * pins. `chromium-wired` serves `dist-wired`, a build whose logistics base is
 * the SAME-ORIGIN path `/sera-logistique` (see `build:wired`), so the
 * console's own ports fetch it and a spec can answer as the Worker would with
 * `page.route` — the live desks DRIVEN in a real browser, nothing of the
 * console stubbed, only the wire. A Vite env is inlined at build time, which
 * is why it takes a second build rather than a runtime switch.
 */
const launch = process.env.PW_EXECUTABLE ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE } } : {};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: { ...launch },
  projects: [
    {
      name: 'chromium',
      testIgnore: /\.wired\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4173' },
    },
    {
      name: 'chromium-wired',
      testMatch: /\.wired\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4174' },
    },
  ],
  webServer: [
    {
      // --host 127.0.0.1: vite preview binds `localhost` by default, which on
      // GitHub runners resolves to ::1 only — the 127.0.0.1 probe then times
      // out. Bind exactly what we probe.
      command: 'pnpm preview --host 127.0.0.1',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm preview:wired --host 127.0.0.1',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
