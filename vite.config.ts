import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// multi-page: each html at the root is its own playground
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        ballpit: resolve(import.meta.dirname, 'index.html'),
        garage: resolve(import.meta.dirname, 'garage.html'),
      },
    },
  },
})
