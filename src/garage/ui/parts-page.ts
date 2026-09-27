import type * as THREE from 'three'
import { meshLabel, type GroupEditor, type MaterialGroup } from '../groups'
import type { Nav, Page } from './panel'
import { materialControls } from './material-controls'
import { actionButton, el, section, toggle } from './widgets'

export interface PartsState {
  editor(): GroupEditor | undefined
  picking(): boolean
  setPicking(on: boolean): void
  /** ghost the parts in front of the selected / inspected one */
  xray(): boolean
  setXray(on: boolean): void
  /** hide the selection (or the hovered part) to reach what's under it */
  hide(): void
  unhideAll(): void
  /** shown while there's no car to edit: loading, or an empty bay */
  placeholder(): string
}

function button(text: string, onClick: () => void, className = 'cfg-mini'): HTMLButtonElement {
  const b = el('button', className, text)
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

/** a removable chip per mesh; hovering one tints that mesh in the scene */
function meshChips(editor: GroupEditor, meshes: Iterable<THREE.Mesh>, onRemove: (m: THREE.Mesh) => void): HTMLElement {
  const wrap = el('div', 'cfg-parts')
  for (const mesh of meshes) {
    const chip = el('span', 'cfg-part-chip')
    chip.title = mesh.name
    chip.append(el('span', '', meshLabel(mesh)))
    const x = button('×', () => onRemove(mesh), 'cfg-chip-x')
    x.title = 'remove'
    chip.append(x)
    chip.addEventListener('pointerenter', () => editor.highlight('hover', [mesh]))
    chip.addEventListener('pointerleave', () => editor.highlight('hover', []))
    wrap.append(chip)
  }
  return wrap
}

/**
 * Menu › Parts — pick meshes in the 3D view, group them, and give each group
 * one material. Leaving the page stops picking and hides the overlays.
 */
export function partsPage(state: PartsState): Page {
  function groupSection(editor: GroupEditor, group: MaterialGroup, nav: Nav): HTMLElement {
    const s = el('section', 'cfg-part cfg-group')
    // inspecting a group tints its members
    s.addEventListener('pointerenter', () => editor.highlight('focus', group.members))
    s.addEventListener('pointerleave', () => editor.highlight('focus', []))

    const head = el('div', 'cfg-part-head')
    const name = el('input', 'cfg-group-name')
    name.value = group.name
    name.maxLength = 32
    name.setAttribute('aria-label', 'group name')
    name.addEventListener('change', () => editor.rename(group.id, name.value))
    name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur())
    head.append(name, el('span', 'cfg-readout', `${group.members.size} part${group.members.size === 1 ? '' : 's'}`))
    s.append(head)

    const actions = el('div', 'cfg-actions')
    actions.append(
      button('Select parts', () => {
        editor.select([...group.members])
        nav.refresh()
      }),
    )
    if (editor.selection.size > 0) {
      actions.append(
        button(`Add ${editor.selection.size} selected`, () => {
          editor.addSelectionTo(group.id)
          nav.refresh()
        }),
      )
    }
    actions.append(
      button(
        'Delete group',
        () => {
          editor.highlight('focus', [])
          editor.deleteGroup(group.id)
          nav.refresh()
        },
        'cfg-mini is-danger',
      ),
    )
    s.append(actions)

    s.append(
      meshChips(editor, group.members, (mesh) => {
        editor.highlight('hover', [])
        editor.removeMember(group.id, mesh)
        nav.refresh()
      }),
    )

    s.append(
      el('div', 'cfg-label cfg-sub', 'Material'),
      ...materialControls({
        settings: group.material,
        set(patch, structural) {
          editor.setMaterial(group.id, patch)
          if (structural) nav.refresh()
        },
      }),
    )
    return s
  }

  return {
    title: 'Parts',
    hint: 'Select parts, group them, one material per group',
    render(body, nav) {
      const editor = state.editor()
      if (!editor) {
        body.append(el('p', 'cfg-empty', state.placeholder()))
        return
      }
      editor.setOverlaysVisible(true)

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
            ? 'Click a part to select it · click the same spot again to go one layer in · Alt+click lists every layer under the pointer · Shift/Ctrl+click adds or removes · Esc clears.'
            : 'Turn on, then click parts of the car to select them. Dragging still orbits.',
        ),
      )
      body.append(pick)

      const see = section(
        'X-ray',
        toggle(state.xray(), 'ghost the parts in front', (on) => {
          state.setXray(on)
          nav.refresh()
        }),
      )
      see.append(
        el(
          'p',
          'cfg-note',
          state.xray()
            ? 'Parts in front of the selected one turn see-through.'
            : 'Off — parts in front stay solid.',
        ),
      )
      const hidden = editor.xray.hidden.size
      const peel = el('div', 'cfg-actions')
      if (editor.selection.size > 0) {
        peel.append(
          button(`Hide ${editor.selection.size} selected (H)`, () => {
            state.hide()
            nav.refresh()
          }),
        )
      } else {
        see.append(el('p', 'cfg-note', 'H hides the part under the pointer, to peel the car layer by layer.'))
      }
      if (hidden > 0) {
        peel.append(
          button(`Show ${hidden} hidden (⇧H)`, () => {
            state.unhideAll()
            nav.refresh()
          }),
        )
      }
      see.append(peel)
      body.append(see)

      const sel = section(`Selection · ${editor.selection.size}`)
      if (editor.selection.size === 0) {
        sel.append(el('p', 'cfg-note', 'Nothing selected.'))
      } else {
        sel.append(
          meshChips(editor, editor.selection, (mesh) => {
            editor.highlight('hover', [])
            editor.select([mesh], 'toggle')
            nav.refresh()
          }),
        )
        const actions = el('div', 'cfg-actions')
        actions.append(
          button(
            'Group selection',
            () => {
              editor.groupSelection()
              nav.refresh()
            },
            'cfg-mini is-primary',
          ),
          button('Clear', () => {
            editor.select([])
            nav.refresh()
          }),
        )
        sel.append(actions)
      }
      body.append(sel)

      if (editor.groups.length === 0) {
        body.append(el('p', 'cfg-note cfg-gap', 'No groups yet — select one or more parts and press “Group selection”.'))
      }
      for (const group of editor.groups) body.append(groupSection(editor, group, nav))

      if (editor.groups.length > 0) {
        body.append(
          actionButton('Delete all groups', () => {
            for (const g of [...editor.groups]) editor.deleteGroup(g.id)
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
    },
  }
}
