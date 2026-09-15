import type { PostProcessing } from '../post'
import type { Page } from './panel'
import { el, section, segmented, slider, toggle } from './widgets'

const FPS_CAPS = ['0', '120', '60', '30'] as const
const FPS_LABEL: Record<(typeof FPS_CAPS)[number], string> = { '0': 'Display', '120': '120', '60': '60', '30': '30' }

/** Menu › Settings › Display — frame loop, camera and HUD */
export function displayPage(post: PostProcessing): Page {
  const d = post.settings.display

  return {
    title: 'Display',
    hint: 'Frame rate, rendering, field of view',
    render(body, nav) {
      const rendering = section('Rendering')
      rendering.append(
        el('div', 'cfg-label cfg-sub', 'Frame rate limit'),
        segmented(FPS_CAPS, FPS_LABEL, String(d.fpsCap) as (typeof FPS_CAPS)[number], (cap) => {
          post.set('display', { fpsCap: Number(cap) })
          nav.refresh()
        }),
        el('div', 'cfg-label cfg-sub', 'Draw'),
        segmented(['demand', 'always'] as const, { demand: 'On demand', always: 'Every frame' }, d.onDemand ? 'demand' : 'always', (mode) => {
          post.set('display', { onDemand: mode === 'demand' })
          nav.refresh()
        }),
        el(
          'p',
          'cfg-note',
          d.onDemand
            ? 'Only draws when the camera, car or a setting changes — the GPU rests while you look.'
            : 'Draws continuously, even when nothing moves.',
        ),
      )
      body.append(rendering)

      const background = section(
        'Pause when unfocused',
        toggle(d.pauseUnfocused, 'pause when unfocused', (on) => {
          post.set('display', { pauseUnfocused: on })
          nav.refresh()
        }),
      )
      background.append(
        el('p', 'cfg-note', 'Hidden tabs always stop drawing. This also stops when the window is behind other apps.'),
      )
      body.append(background)

      const view = section('Camera')
      view.append(
        slider('Field of view', d.fov, { min: 30, max: 70, step: 1 }, (v) => `${v}°`, (v) => post.set('display', { fov: v })),
      )
      body.append(view)

      body.append(
        section(
          'FPS counter',
          toggle(d.showFps, 'fps counter', (on) => {
            post.set('display', { showFps: on })
            nav.refresh()
          }),
        ),
      )
    },
  }
}
