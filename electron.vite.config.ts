import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // music-metadata is ESM-only, so bundle it into the CJS main process instead of externalizing
    plugins: [externalizeDepsPlugin({ exclude: ['music-metadata'] })]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
