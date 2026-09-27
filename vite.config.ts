import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// multi-page: the home page, and each playground at its own path
export default defineConfig({
  server: {
    port: 3000
  },
  build: {
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
        ballpit: resolve(import.meta.dirname, 'balls/index.html'),
        garage: resolve(import.meta.dirname, 'garage.html'),
      },
    },
  },
})
