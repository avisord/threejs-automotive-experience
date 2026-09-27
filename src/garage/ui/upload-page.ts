import type * as THREE from 'three'
import {
  ACCEPT,
  LENGTH_RANGE,
  MODEL_EXTENSIONS,
  droppedFiles,
  formatBytes,
  uploadBytes,
  type UploadRecord,
  type UploadSetup,
  type VehicleKind,
} from '../uploads'
import type { Nav, Page } from './panel'
import { actionButton, el, section, segmented, slider } from './widgets'

export interface UploadState {
  /** the upload in the bay, if the bay holds one */
  current(): UploadRecord | null
  /** its size as shown: length, width, height */
  size(): THREE.Vector3 | null
  /** what an import is doing right now, or its last error */
  status(): { text: string; error: boolean } | null
  list(): UploadRecord[]
  importFiles(files: { file: File; path: string }[]): void
  setSetup(patch: Partial<UploadSetup>): void
  rename(name: string): void
  show(id: string): void
  remove(id: string): void
}

function mini(text: string, onClick: () => void, className = 'cfg-mini'): HTMLButtonElement {
  const b = el('button', className, text)
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

const quarter = (n: number) => ((n % 4) + 4) % 4

/**
 * Menu › Collection › Upload — bring your own car or bike (glb, gltf, fbx, obj,
 * dae, 3ds, usdz, or a zip of any of them), then turn it the right way round and
 * size it. Kept in the browser (IndexedDB) until deleted.
 */
export function uploadPage(state: UploadState): Page {
  let confirmDelete: string | null = null

  function dropZone(nav: Nav): HTMLElement {
    const zone = el('div', 'cfg-drop')
    const input = el('input')
    input.type = 'file'
    input.multiple = true
    input.accept = ACCEPT
    input.hidden = true
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])].map((file) => ({ file, path: file.name }))
      input.value = ''
      if (files.length) state.importFiles(files)
      nav.refresh()
    })
    const folder = el('input')
    folder.type = 'file'
    folder.hidden = true
    folder.webkitdirectory = true
    folder.addEventListener('change', () => {
      const files = [...(folder.files ?? [])].map((file) => ({ file, path: file.webkitRelativePath || file.name }))
      folder.value = ''
      if (files.length) state.importFiles(files)
      nav.refresh()
    })
    zone.append(
      el('strong', '', 'Drop a model here'),
      el('span', 'cfg-note', `${MODEL_EXTENSIONS.map((e) => '.' + e).join(' ')} · or a .zip · a .gltf/.obj with its folder`),
    )
    const buttons = el('div', 'cfg-actions')
    buttons.append(
      mini('Choose files', () => input.click(), 'cfg-mini is-primary'),
      mini('Choose folder', () => folder.click()),
    )
    zone.append(buttons, input, folder)
    zone.addEventListener('dragover', (e) => {
      e.preventDefault()
      zone.classList.add('is-over')
    })
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'))
    zone.addEventListener('drop', (e) => {
      e.preventDefault()
      e.stopPropagation() // the window-wide drop would import it again
      zone.classList.remove('is-over')
      if (!e.dataTransfer) return
      void droppedFiles(e.dataTransfer).then((files) => void (files.length && state.importFiles(files)))
    })
    return zone
  }

  function setupSection(record: UploadRecord, nav: Nav): HTMLElement {
    const { setup } = record
    const s = section('Setup')

    const name = el('input', 'cfg-text')
    name.value = record.name
    name.maxLength = 48
    name.setAttribute('aria-label', 'model name')
    name.addEventListener('change', () => state.rename(name.value))
    name.addEventListener('keydown', (e) => e.key === 'Enter' && name.blur())
    s.append(name)

    s.append(
      el('div', 'cfg-label cfg-sub', 'Vehicle'),
      segmented<VehicleKind>(['car', 'bike'], { car: 'Car', bike: 'Bike' }, setup.kind, (kind) => {
        state.setSetup({ kind, length: null })
        nav.refresh()
      }),
    )

    const size = state.size()
    s.append(el('div', 'cfg-label cfg-sub', 'Facing'))
    s.append(el('p', 'cfg-note', 'The nose should point toward the camera’s start view (+z), wheels on the floor.'))
    const turn = el('div', 'cfg-actions')
    turn.append(
      mini('⟲ 90°', () => state.setSetup({ yaw: quarter(setup.yaw + 1) })),
      mini('⟳ 90°', () => state.setSetup({ yaw: quarter(setup.yaw - 1) })),
      mini('Flip nose', () => state.setSetup({ yaw: quarter(setup.yaw + 2) })),
    )
    const stand = el('div', 'cfg-actions')
    stand.append(
      mini('Tip forward', () => state.setSetup({ pitch: quarter(setup.pitch + 1) })),
      mini('Tip sideways', () => state.setSetup({ roll: quarter(setup.roll + 1) })),
      mini('Upside down', () => state.setSetup({ roll: quarter(setup.roll + 2) })),
    )
    s.append(turn, stand)

    const range = LENGTH_RANGE[setup.kind]
    const length = setup.length ?? size?.z ?? (range.min + range.max) / 2
    // re-loading the model on every step of a drag would be far too slow: apply on release
    const lengthSlider = slider(
      setup.length ? 'Length' : 'Length · auto',
      Math.min(range.max, Math.max(range.min, length)),
      { ...range, step: 0.01 },
      (v) => `${v.toFixed(2)} m`,
      () => {},
    )
    const input = lengthSlider.querySelector('input')!
    input.addEventListener('change', () => state.setSetup({ length: Number(input.value) }))
    s.append(lengthSlider)
    if (size) {
      s.append(el('p', 'cfg-note', `${size.z.toFixed(2)} long × ${size.x.toFixed(2)} wide × ${size.y.toFixed(2)} m high`))
    }
    const after = el('div', 'cfg-actions')
    if (setup.length) after.append(mini('Auto size', () => state.setSetup({ length: null })))
    after.append(mini('Next: position it ›', () => nav.open('car'), 'cfg-mini is-primary'))
    s.append(after)
    return s
  }

  function listSection(nav: Nav): HTMLElement {
    const list = state.list()
    const s = section(`Your models · ${list.length}`)
    if (list.length === 0) {
      s.append(el('p', 'cfg-note', 'Nothing uploaded yet. Models stay in this browser until you delete them.'))
      return s
    }
    const current = state.current()?.id
    for (const record of [...list].reverse()) {
      const row = el('div', `cfg-upload${record.id === current ? ' is-active' : ''}`)
      const text = el('div', 'cfg-upload-text')
      text.append(
        el('span', 'cfg-upload-name', record.name),
        el('span', 'cfg-note', `${record.setup.kind} · ${record.main.split('.').pop()!.toUpperCase()} · ${formatBytes(uploadBytes(record))}`),
      )
      row.append(text)
      if (record.id !== current) row.append(mini('Show', () => state.show(record.id)))
      const sure = confirmDelete === record.id
      row.append(
        mini(
          sure ? 'Delete?' : '×',
          () => {
            if (!sure) {
              confirmDelete = record.id
              return nav.refresh()
            }
            confirmDelete = null
            state.remove(record.id)
            nav.refresh()
          },
          `cfg-mini is-danger${sure ? ' is-armed' : ''}`,
        ),
      )
      s.append(row)
    }
    return s
  }

  return {
    title: 'Upload',
    hint: 'Your own car or bike: glb, gltf, fbx, obj…',
    render(body, nav) {
      body.append(dropZone(nav))
      const status = state.status()
      if (status) body.append(el('p', `cfg-note cfg-status${status.error ? ' is-error' : ''}`, status.text))
      const current = state.current()
      if (current) body.append(setupSection(current, nav))
      body.append(listSection(nav))
      if (current) {
        body.append(
          actionButton('Reset setup to the first guess', () => {
            state.setSetup({ ...current.guess })
            nav.refresh()
          }),
        )
      }
    },
    leave() {
      confirmDelete = null
    },
  }
}
