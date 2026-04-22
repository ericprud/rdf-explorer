/**
 * Unit tests for loader-panels.ts and base-panel.ts
 *
 * Run with: npx vitest run
 * Requires jsdom environment (see vitest.workspace.ts).
 */
import { describe, it, expect } from 'vitest'
import { buildLoaderPanels } from '../../loader-panels'
import { buildBasePanel }    from '../../base-panel'
import type { GraphSource, ApplyGraphCallback, ApplyGraphInput } from '@modular-rdf/api-graph-source'

// ── Stub loader factory ───────────────────────────────────────────────────────
function stub(name: string, exts: string[] = ['.txt'], desc?: string): GraphSource {
  return {
    name,
    description: desc,
    accepts: exts,
    buildPanel(container: HTMLElement, applyGraph: ApplyGraphCallback) {
      buildBasePanel(container, this, async (file) => {
        const text = await file.text()
        applyGraph({ text })
      })
    },
    async parse() {
      return { turtle: '', warnings: [], sheetsSeen: [], tripleCount: 0, timestamp: '', fileHash: '' }
    },
  }
}

function container(): HTMLDivElement { return document.createElement('div') }

const noop: ApplyGraphCallback = () => {}

// ── buildLoaderPanels — structure ─────────────────────────────────────────────
describe('buildLoaderPanels — structure', () => {
  it('renders one panel per loader', () => {
    const c = container()
    buildLoaderPanels([stub('A'), stub('B'), stub('C')], c, noop, "https://example.org/")
    expect(c.querySelectorAll('.loader-dropzone')).toHaveLength(3)
  })

  it('shows hint text when loader list is empty', () => {
    const c = container()
    buildLoaderPanels([], c, noop, "https://example.org/")
    expect(c.querySelectorAll('.loader-dropzone')).toHaveLength(0)
    expect(c.textContent).toMatch(/drop a .js loader/i)
  })

  it('each panel carries a data-loader-name attribute', () => {
    const c = container()
    buildLoaderPanels([stub('My Loader')], c, noop, "https://example.org/")
    const panel = c.querySelector('.loader-dropzone')!
    expect(panel.getAttribute('data-loader-name')).toBe('My Loader')
  })
})

// ── buildLoaderPanels — file input ────────────────────────────────────────────
describe('buildLoaderPanels — file input', () => {
  it('each panel contains exactly one file input', () => {
    const c = container()
    buildLoaderPanels([stub('X'), stub('Y')], c, noop, "https://example.org/")
    const panels = c.querySelectorAll('.loader-dropzone')
    for (const panel of panels)
      expect(panel.querySelectorAll('input[type="file"]')).toHaveLength(1)
  })

  it('file input has multiple attribute', () => {
    const c = container()
    buildLoaderPanels([stub('M')], c, noop, "https://example.org/")
    const fi = c.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(fi.multiple).toBe(true)
  })

  it('file input is hidden', () => {
    const c = container()
    buildLoaderPanels([stub('H')], c, noop, "https://example.org/")
    const fi = c.querySelector<HTMLInputElement>('input[type="file"]')!
    expect(fi.style.display).toBe('none')
  })
})

// ── buildLoaderPanels — hint text ─────────────────────────────────────────────
describe('buildLoaderPanels — hint text', () => {
  it('shows description when provided', () => {
    const c = container()
    buildLoaderPanels([stub('X', ['.txt'], 'My custom description')], c, noop, "https://example.org/")
    expect(c.querySelector('.dropzone-hint')!.textContent).toBe('My custom description')
  })
})

// ── buildLoaderPanels — callbacks ─────────────────────────────────────────────
describe('buildLoaderPanels — callbacks', () => {
  it('forwards applyGraph to each loader panel', () => {
    const c = container()
    const received: ApplyGraphInput[] = []
    const cb: ApplyGraphCallback = (input) => received.push(input)

    // Loader with a buildPanel that immediately calls applyGraph
    const loader: GraphSource = {
      name: 'Immediate', accepts: ['.txt'],
      buildPanel(_container, applyGraph) { applyGraph({ text: 'turtle-data' }) },
      async parse() { return { turtle: '', warnings: [], sheetsSeen: [], tripleCount: 0, timestamp: '', fileHash: '' } },
    }

    buildLoaderPanels([loader], c, cb, "https://example.org/")
    expect(received).toHaveLength(1)
    expect((received[0] as { text: string }).text).toBe('turtle-data')
  })

  it('adds dragging class on dragover and removes on dragleave', () => {
    const c = container()
    buildLoaderPanels([stub('Drag test')], c, noop, "https://example.org/")
    const panel = c.querySelector('.loader-dropzone')!

    panel.dispatchEvent(Object.assign(new Event('dragover'), { preventDefault: () => {} }))
    expect(panel.classList.contains('dragging')).toBe(true)

    panel.dispatchEvent(new Event('dragleave'))
    expect(panel.classList.contains('dragging')).toBe(false)
  })

  it('rebuilding panels replaces old content (exactly one panel after two builds)', () => {
    const c = container()
    const loader = stub('Rebuild')

    buildLoaderPanels([loader], c, noop, "https://example.org/")
    buildLoaderPanels([loader], c, noop, "https://example.org/")  // rebuild — should replace, not append

    expect(c.querySelectorAll('.loader-dropzone')).toHaveLength(1)
  })
})
