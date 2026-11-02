import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { cspPlugin } from './src/shared/csp'

export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve('electron/main.ts'),
        formats: ['cjs'],
        fileName: () => 'main.js'
      }
    }
  },
  preload: {
    build: {
      lib: {
        entry: resolve('electron/preload.ts'),
        formats: ['cjs'],
        fileName: () => 'preload.js'
      }
    }
  },
  renderer: {
    root: resolve('src'),
    plugins: [react(), cspPlugin()],
    build: {
      rolldownOptions: {
        input: resolve('src/index.html')
      }
    }
  }
})
