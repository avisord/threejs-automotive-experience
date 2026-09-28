import { execSync } from 'node:child_process'
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

// Commit and build time, shown in the garage's menu. Vercel builds have no .git, but
// name the commit in VERCEL_GIT_COMMIT_SHA.
function buildInfo(): { commit: string | null; time: string } {
  let commit = process.env.VERCEL_GIT_COMMIT_SHA || null
  if (!commit) {
    try {
      commit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    } catch {}
  }
  return { commit, time: new Date().toISOString() }
}

// multi-page: the home page, and each playground at its own path
export default defineConfig(({ mode }) => ({
  define: { __BUILD__: JSON.stringify(buildInfo()) },
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
        gallery: resolve(import.meta.dirname, 'gallery.html'),
        garage: resolve(import.meta.dirname, 'garage.html'),
      },
    },
  },
}))
