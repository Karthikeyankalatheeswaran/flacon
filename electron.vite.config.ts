import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      rollupOptions: {
        // The decoder runs in its own utilityProcess, so it is a separate entry.
        input: {
          index: resolve('src/main/index.ts'),
          decoder: resolve('src/main/decoder/decoder.ts'),
          library: resolve('src/main/library/worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared'), '@': resolve('src/renderer/src') } },
    build: {
      rollupOptions: {
        // Thin views over shared state: library window, island, and the hidden audio engine.
        input: {
          index: resolve('src/renderer/index.html'),
          island: resolve('src/renderer/island.html'),
          mini: resolve('src/renderer/mini.html'),
          engine: resolve('src/renderer/engine.html')
        }
      }
    }
  }
})
