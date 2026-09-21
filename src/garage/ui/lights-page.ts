import type { LampId, LampSystem } from '../lights'
import type { Page } from './panel'
import { colorField, el, section, slider, toggle } from './widgets'

const LABEL: Record<LampId, string> = { head: 'Headlights', tail: 'Tail lights' }

/** Menu › Lights — switch the car's own lights on, colour them, aim the beams */
export function lightsPage(current: () => LampSystem | undefined, placeholder: () => string = () => 'Loading car…'): Page {
  return {
    title: 'Lights',
    hint: 'Headlights and tail lights',
    render(body, nav) {
      const lamps = current()
      if (!lamps) {
        body.append(el('p', 'cfg-empty', placeholder()))
        return
      }
      if (lamps.present.length === 0) {
        body.append(el('p', 'cfg-note cfg-gap', 'No lamps found on this car.'))
        return
      }

      for (const id of lamps.present) {
        const c = lamps.settings[id]
        const s = section(
          LABEL[id],
          toggle(c.on, LABEL[id], (on) => {
            lamps.set(id, { on })
            nav.refresh()
          }),
        )
        if (c.on) {
          s.append(
            colorField('Colour', c.color, (color, commit) => {
              lamps.set(id, { color })
              if (commit) nav.refresh()
            }),
            slider('Brightness', c.intensity, { min: 0.1, max: 2, step: 0.05 }, (v) => `${Math.round(v * 100)}%`, (v) =>
              lamps.set(id, { intensity: v }),
            ),
          )
          if (id === 'head') {
            const beam = section(
              'Light beam',
              toggle(c.beam, 'light beam', (on) => {
                lamps.set(id, { beam: on })
                nav.refresh()
              }),
            )
            beam.classList.add('cfg-subsection')
            beam.append(el('p', 'cfg-note', 'Draws the cone of light in the air — best in a dark garage.'))
            s.append(beam)
          }
        }
        body.append(s)
      }
    },
  }
}
