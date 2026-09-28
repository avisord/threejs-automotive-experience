import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Google Analytics 4 on every page, production builds only (dev visits stay out of the stats).
// The measurement ID comes from `GA_MEASUREMENT_ID` (Vercel env var, or `.env.local`);
// without it nothing is injected.
function analytics(id: string | undefined): Plugin {
  return {
    name: 'ga4',
    apply: 'build',
    transformIndexHtml() {
      if (!id) return
      return [
        {
          tag: 'script',
          attrs: { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${id}` },
          injectTo: 'head',
        },
        {
          tag: 'script',
          children:
            'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}' +
            `gtag('js',new Date());gtag('config','${id}');`,
          injectTo: 'head',
        },
      ]
    },
  }
}

// multi-page: the home page, and each playground at its own path
export default defineConfig(({ mode }) => ({
  plugins: [analytics(loadEnv(mode, import.meta.dirname, '').GA_MEASUREMENT_ID)],
  server: {
    port: 3000
  },
  build: {
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
        ballpit: resolve(import.meta.dirname, 'balls/index.html'),
        credits: resolve(import.meta.dirname, 'credits.html'),
        garage: resolve(import.meta.dirname, 'garage.html'),
      },
    },
  },
}))
