import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests (Vitest). .claude/worktrees/ holds other sessions' full copies of the repo, and vendor/skills/ holds
// reviewed third-party files: without these exclusions every test ran twice (measured 2026-10-25: 110 instead of 55 [M]).
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.claude/worktrees/**', 'vendor/skills/**', 'out/**', '.next/**'],
    environment: 'node',
    testTimeout: 20_000,
  },
});
