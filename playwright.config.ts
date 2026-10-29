import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 4321);

// End-to-end tests against the built site (factory.config.json → build.outputDir), served by scripts/serve-out.mjs
// with the _headers rules applied, so CSP problems show up here before they reach a host.
export default defineConfig({
  // testDir keeps the scan inside tests/e2e, so other sessions' worktrees (.claude/worktrees/) and vendor/skills/ are
  // never read. A testIgnore glob for them would match this checkout's own path when it is itself a worktree.
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/serve-out.mjs',
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
});
