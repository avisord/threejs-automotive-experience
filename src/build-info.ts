/** Set by `define` in vite.config.ts at build (or dev server start) time. */
declare const __BUILD__: { commit: string | null; time: string }

export const BUILD = __BUILD__

const REPO = 'https://github.com/avisord/threejs-automotive-experience'

/** "build 1a2b3c4 · 28 Sep 2026, 14:05" — the commit links to GitHub */
export function buildInfoElement(className: string): HTMLElement {
  const line = document.createElement('p')
  line.className = className
  const time = new Date(BUILD.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  if (BUILD.commit) {
    const link = document.createElement('a')
    link.href = `${REPO}/commit/${BUILD.commit}`
    link.target = '_blank'
    link.rel = 'noopener'
    link.textContent = BUILD.commit.slice(0, 7)
    line.append('build ', link, ` · ${time}`)
  } else line.append(`build · ${time}`)
  line.title = `${BUILD.commit ?? 'unknown commit'}\nbuilt ${BUILD.time}`
  return line
}
