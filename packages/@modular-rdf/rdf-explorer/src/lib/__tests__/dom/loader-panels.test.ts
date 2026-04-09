/**
 * Unit tests for loader-panels.ts and base-panel.ts
 *
 * Run with: npx vitest run
 * Requires jsdom environment (see vitest.workspace.ts).
 */
import { describe, it, expect, vi } from 'vitest'
import { buildLoaderPanels } from '../../loader-panels'
import { buildBasePanel }    from '../../base-panel'
import type { GraphSource, TurtleChangedCallback } from '@modular-rdf/graph-source-api'

// ── Stub loader factory ───────────────────────────────────────────────────────
function stub(name: string, exts: string[] = ['.txt'], desc?: string): GraphSource {
  return {
    name,
    description: desc,
    accepts: exts,
    buildPanel(container: HTMLElement, onTurtleChanged: TurtleChangedCallback) {
      buildBasePanel(container, this, async (file) => {
        const text = await file.text()
        onTurtleChanged(text)
      })
    },
    async parse() {
      return { turtle: '', warnings: [], sheetsSeen: [], tripleCount: 0, timestamp: '', fileHash: '' }
    },
  }
}

function container(): HTMLDivElement { return document.createElement('div') }

const noop: TurtleChangedCallback = () => {}

// ── buildLoaderPanels — structure ─────────────────────────────────────────────
describe('buildLoaderPanels — structure', () => {
  it('renders one panel per loader', () => {
    const c = container()
    buildLoaderPanels([stub('A'), stub('B'), stub('C')], c, noop)
    expect(c.querySelectorAll('.loader-dropzone')).toHaveLength(3)
  })

  it('shows hint text when loader list is empty', () => {
    const c = container()
    buildLoaderPanels([], c, noop)
    expect(c.querySelectorAll('.loader-dropzone')).toHaveLength(0)
    expect(c.textContent).toMatch(/drop a .js loader/i)
  })

  it('each panel carries a data-loader-name attribute', () => {
    const c = container()
    buildLoaderPanels([stub('My Loader')], c, noop)
    const panel = c.querySelector('.loader-dropzone')!
    expect(panel.getAttribute('data-loader-name')).toBe('My Loader')
  })
})

// ── buildLoaderPanels — file input ────────────────────────────────────────────
describe('buildLoaderPanels — file input', () => {
  it('each panel contains exactly one file input', () => {
    const c = container()
    buildLoaderPanels([stub('X'), stub('Y')], c, noop)
    const panels = c.querySelectorAll('.loader-dropzone')
    for (const panel of panels)
      expect(panel.querySelectorAll('input[type="file"]')).toHaveLength(1)
  })

  it('file input has multiple attribute', () => {
    const c = container()
    buildLoaderPanels([stub('M')], c, noop)
    const fi = c.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(fi.multiple).toBe(true)
  })

  it('file input is hidden', () => {
    const c = container()
    buildLoaderPanels([stub('H')], c, noop)
    const fi = c.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(fi.style.display).toBe('none')
  })
})

// ── buildLoaderPanels — hint text ─────────────────────────────────────────────
describe('buildLoaderPanels — hint text', () => {
  it('shows description when provided', () => {
    const c = container()
    buildLoaderPanels([stub('X', ['.txt'], 'My custom description')], c, noop)
    expect(c.querySelector('.dropzone-hint')!.textContent).toBe('My custom description')
  })
})

// ── buildLoaderPanels — callbacks ─────────────────────────────────────────────
describe('buildLoaderPanels — callbacks', () => {
  it('forwards onTurtleChanged to each loader panel', () => {
    const c = container()
    const received: string[] = []
    const onTurtle: TurtleChangedCallback = (t) => received.push(t)

    // Loader with a buildPanel that immediately calls onTurtleChanged
    const loader: GraphSource = {
      name: 'Immediate', accepts: ['.txt'],
      buildPanel(_container, cb) { cb('turtle-data') },
      async parse() { return { turtle: '', warnings: [], sheetsSeen: [], tripleCount: 0, timestamp: '', fileHash: '' } },
    }

    buildLoaderPanels([loader], c, onTurtle)
    expect(received).toContain('turtle-data')
  })

  it('adds dragging class on dragover and removes on dragleave', () => {
    const c = container()
    buildLoaderPanels([stub('Drag test')], c, noop)
    const panel = c.querySelector('.loader-dropzone')!

    panel.dispatchEvent(Object.assign(new Event('dragover'), { preventDefault: () => {} }))
    expect(panel.classList.contains('dragging')).toBe(true)

    panel.dispatchEvent(new Event('dragleave'))
    expect(panel.classList.contains('dragging')).toBe(false)
  })

  it('rebuilding panels replaces old content (exactly one panel after two builds)', () => {
    const c = container()
    const loader = stub('Rebuild')

    buildLoaderPanels([loader], c, noop)
    buildLoaderPanels([loader], c, noop)  // rebuild — should replace, not append

    expect(c.querySelectorAll('.loader-dropzone')).toHaveLength(1)
  })
})
