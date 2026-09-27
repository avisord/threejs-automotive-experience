import type * as THREE from 'three'
import { meshLabel, type GroupEditor } from '../groups'
import { ROLES, type HiddenPart, type RoleId } from '../roles'
import type { Nav, Page } from './panel'
import { actionButton, el, section, toggle } from './widgets'

export interface RolesState {
  editor(): GroupEditor | undefined
  /** role of a mesh as edited (not yet applied) */
  roleOf(mesh: THREE.Mesh): RoleId
  /** parts hidden by role when the car was loaded — they're out of the scene */
  hiddenAtLoad(): HiddenPart[]
  /** built-in car still on its curated setup (nothing saved) */
  curated(): boolean
  upload(): boolean
  dirty(): boolean
  assign(meshes: THREE.Mesh[], role: RoleId): void
  /** bring back a part hidden at load (it becomes "other") */
  unhide(key: string): void
  /** save the edits and reload the car with them */
  apply(): void
  discard(): void
  /** forget saved roles: the built-in setup, or a fresh guess for an upload */
  reset(): void
  picking(): boolean
  setPicking(on: boolean): void
  tint(): boolean
  setTint(on: boolean): void
  /** the page opened or closed: role colours on / off */
  showing(on: boolean): void
  placeholder(): string
}

function mini(text: string, onClick: () => void, className = 'cfg-mini'): HTMLButtonElement {
  const b = el('button', className, text)
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

/**
 * Menu › Car › Part roles — say what every mesh is: body, wheel parts, glass,
 * lamps, interior, other, or hidden. Roles pick what the Car page paints,
 * what's see-through, what glows and carries a real light, and what's left out.
 * Edits are staged (tinted in the view) and applied by reloading the car —
 * on "Apply", or on leaving the page.
 */
export function rolesPage(state: RolesState): Page {
  const open = new Set<RoleId>()

  function chips(editor: GroupEditor, meshes: THREE.Mesh[], nav: Nav): HTMLElement {
    const wrap = el('div', 'cfg-parts')
    for (const mesh of meshes) {
      const chip = el('button', 'cfg-part-chip cfg-role-chip', meshLabel(mesh))
      chip.type = 'button'
      chip.title = `${mesh.name} — click to select`
      chip.addEventListener('pointerenter', () => editor.highlight('hover', [mesh]))
      chip.addEventListener('pointerleave', () => editor.highlight('hover', []))
      chip.addEventListener('click', (e) => {
        editor.select([mesh], e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'replace')
        nav.refresh()
      })
      wrap.append(chip)
    }
    return wrap
  }

  return {
    title: 'Part roles',
    hint: 'What each part is: body, wheels, glass, lights, interior…',
    render(body, nav) {
      const editor = state.editor()
      if (!editor) {
        body.append(el('p', 'cfg-empty', state.placeholder()))
        return
      }
      editor.setOverlaysVisible(true)
      state.showing(true)

      body.append(
        el(
          'p',
          'cfg-note',
          state.curated()
            ? 'This car’s built-in setup. Changing a role saves your own setup for it.'
            : state.upload()
              ? 'Guessed from names, materials and shapes — fix what’s wrong. Painting (Car page), see-through glass and working lamps follow these roles.'
              : 'Your setup for this car.',
        ),
      )

      const pick = section(
        'Pick in 3D',
        toggle(state.picking(), 'pick parts in 3D', (on) => {
          state.setPicking(on)
          nav.refresh()
        }),
      )
      pick.append(
        el(
          'p',
          'cfg-note',
          state.picking()
            ? 'Click a part · again to go a layer in · Alt+click lists the layers · Shift adds · H hides for now.'
            : 'Turn on, then click parts of the vehicle — or pick from the lists below.',
        ),
      )
      const colours = el('div', 'cfg-actions')
      colours.append(el('span', 'cfg-note', 'Role colours'), toggle(state.tint(), 'show role colours', (on) => {
        state.setTint(on)
        nav.refresh()
      }))
      pick.append(colours)
      body.append(pick)

      // the selection and where it can go
      const selected = [...editor.selection]
      const sel = section(`Selection · ${selected.length}`)
      if (selected.length === 0) {
        sel.append(el('p', 'cfg-note', 'Select parts to give them a role.'))
      } else {
        sel.append(el('div', 'cfg-label cfg-sub', 'Make it'))
        const grid = el('div', 'cfg-role-grid')
        for (const r of ROLES) {
          const b = mini(r.label, () => {
            state.assign(selected, r.id)
            editor.select([])
            nav.refresh()
          }, 'cfg-mini cfg-role-btn')
          b.style.setProperty('--role', hex(r.color))
          grid.append(b)
        }
        sel.append(grid)
      }
      body.append(sel)

      // every role with its meshes
      const byRole = new Map<RoleId, THREE.Mesh[]>()
      for (const mesh of editor.pickable) {
        const role = state.roleOf(mesh)
        byRole.set(role, [...(byRole.get(role) ?? []), mesh])
      }
      for (const r of ROLES) {
        const meshes = byRole.get(r.id) ?? []
        const hiddenAtLoad = r.id === 'hidden' ? state.hiddenAtLoad() : []
        const count = meshes.length + hiddenAtLoad.length
        const s = el('section', 'cfg-part cfg-role')
        const head = el('button', 'cfg-role-head')
        head.type = 'button'
        const dot = el('span', 'cfg-role-dot')
        dot.style.background = r.id === 'hidden' ? 'transparent' : hex(r.color)
        head.append(dot, el('span', 'cfg-role-name', r.label), el('span', 'cfg-readout', String(count)), el('span', 'cfg-menu-chevron', open.has(r.id) ? '▾' : '▸'))
        head.addEventListener('click', () => {
          if (open.has(r.id)) open.delete(r.id)
          else open.add(r.id)
          nav.refresh()
        })
        // inspecting a role tints (and x-rays down to) its parts
        head.addEventListener('pointerenter', () => editor.highlight('focus', meshes))
        head.addEventListener('pointerleave', () => editor.highlight('focus', []))
        s.append(head)
        if (open.has(r.id) && count > 0) {
          if (meshes.length > 0) {
            const actions = el('div', 'cfg-actions')
            actions.append(
              mini('Select all', () => {
                editor.select(meshes)
                nav.refresh()
              }),
            )
            s.append(actions, chips(editor, meshes, nav))
          }
          if (hiddenAtLoad.length > 0) {
            const wrap = el('div', 'cfg-parts')
            for (const h of hiddenAtLoad) {
              const chip = el('span', 'cfg-part-chip')
              chip.append(el('span', '', h.label))
              const x = mini('↺', () => {
                state.unhide(h.key)
                nav.refresh()
              }, 'cfg-chip-x')
              x.title = 'show it again (as “other”)'
              chip.append(x)
              wrap.append(chip)
            }
            s.append(wrap)
          }
        }
        body.append(s)
      }

      if (state.dirty()) {
        const bar = el('div', 'cfg-actions cfg-gap')
        bar.append(
          mini('Apply roles', () => state.apply(), 'cfg-mini is-primary'),
          mini('Discard', () => {
            state.discard()
            nav.refresh()
          }),
        )
        body.append(bar, el('p', 'cfg-note', 'Applying reloads the vehicle with its new roles (also done when you leave this page).'))
      }
      if (!state.curated()) {
        body.append(
          actionButton(state.upload() ? 'Guess the roles again' : 'Back to the built-in setup', () => {
            state.reset()
            nav.refresh()
          }),
        )
      }
    },
    leave() {
      state.setPicking(false)
      const editor = state.editor()
      editor?.highlight('hover', [])
      editor?.highlight('focus', [])
      editor?.setOverlaysVisible(false)
      state.showing(false)
      if (state.dirty()) state.apply()
    },
  }
}
