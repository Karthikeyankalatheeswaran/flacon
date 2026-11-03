import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Browser-only preview of the renderer (no Electron binary needed). The preload bridge
// is absent there, so lib/bridge.ts falls back to an in-memory mock.
export default defineConfig({
  root: resolve('src/renderer'),
  plugins: [react()],
  resolve: { alias: { '@shared': resolve('src/shared'), '@': resolve('src/renderer/src') } },
  server: { port: 5199, strictPort: true }
})
