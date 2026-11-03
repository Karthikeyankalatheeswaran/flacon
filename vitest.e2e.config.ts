import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// End-to-end tests drive the real app via Playwright's Electron support. Kept out of `npm test` (they open windows).
export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { include: ['e2e/**/*.e2e.ts'], testTimeout: 60_000, hookTimeout: 90_000, fileParallelism: false, pool: 'forks', poolOptions: { forks: { singleFork: true } } }
})
