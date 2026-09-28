// GA4 custom events. The gtag snippet is injected only into production builds
// (vite.config.ts), so in dev — or with an ad blocker — this does nothing.

type Params = Record<string, string | number | boolean>

declare global {
  interface Window {
    gtag?: (command: 'event', name: string, params?: Params) => void
  }
}

export function track(name: string, params?: Params): void {
  try {
    window.gtag?.('event', name, params)
  } catch {
    // analytics must never break the app
  }
}
