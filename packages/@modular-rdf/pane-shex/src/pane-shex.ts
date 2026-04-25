/**
 * @modular-rdf/pane-shex
 *
 * GraphHandler implementation for the ShEx validation pane.
 *
 * Owns:
 *  - ShEx editor (CodeMirror, editable)
 *  - Generate ShEx button
 *  - Pick Types button + type checkboxes
 *  - Validate button + results area
 *  - ShEx worker lifecycle
 *
 * focusTerm: looks up rdf:type of iri in current store, constructs the
 *   shapeId as `<typeIri>Shape`, scrolls the ShEx editor to that shape.
 */
import type { GraphHandler, HandlerState, HandlerCallbacks } from '@modular-rdf/api-graph-handler'
import { labelIri } from '@modular-rdf/util-rdf'
import * as N3 from 'n3'
import { ShExEditor } from './shex-editor'
import { ShExWorkerClient } from './shex-worker-client'
import { generateShEx } from './shex-validator'

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

// Validation marks (inline SVG — no font dependency)
const Mark_pass = '<svg width="11" height="11" viewBox="0 0 11 11" style="display:inline-block;vertical-align:-1px" aria-hidden="true">'
  + '<polyline points="1.5,6 4,9 9.5,2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
  + '</svg>'
const Mark_fail = '<svg width="11" height="11" viewBox="0 0 11 11" style="display:inline-block;vertical-align:-1px" aria-hidden="true">'
  + '<line x1="2" y1="2" x2="9" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  + '<line x1="9" y1="2" x2="2" y2="9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
  + '</svg>'
const Mark_test = '<svg width="7" height="11" viewBox="0 0 7 11" style="display:inline-block;vertical-align:-1px" aria-hidden="true">'
  + '<circle cx="3.5" cy="5.5" r="2" fill="currentColor"/>'
  + '</svg>'

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

class ShExPaneHandler implements GraphHandler {
  name  = 'shex'
  label = 'ShEx'

  private editor:    ShExEditor | null = null
  private callbacks: HandlerCallbacks | null = null
  private state:     HandlerState | null = null
  private turtleText = ''

  private shexWorker:       ShExWorkerClient | null = null
  private validationRunning = false
  private selectedTypes     = new Set<string>()

  // DOM elements
  private pane:         HTMLElement | null = null
  private resultsEl:    HTMLElement | null = null
  private stickyEl:     HTMLElement | null = null
  private validateBtn:  HTMLButtonElement | null = null

  mount(pane: HTMLElement, callbacks: HandlerCallbacks): void {
    this.pane      = pane
    this.callbacks = callbacks

    pane.innerHTML = `
      <div class="shex-pane">
        <div class="pane-toolbar flex-row">
          <span class="mono text-xs text-muted grow">ShEx 2.0 &middot; auto-generated &middot; editable</span>
          <button class="btn sm shex-gen-btn">Generate ShEx</button>
          <button class="btn sm shex-pick-btn">Pick Types</button>
          <button class="btn sm primary shex-validate-btn">Validate</button>
        </div>
        <div class="shex-split">
          <div class="shex-editor-container shex-editor-host"></div>
          <div class="shex-results-wrap">
            <div class="shex-results-sticky" style="display:none"></div>
            <div class="shex-results pane-scroll-host">
              <div class="mono text-xs text-muted" style="padding:12px">Pick types then Validate.</div>
            </div>
          </div>
        </div>
      </div>
    `

    const editorContainer = pane.querySelector<HTMLElement>('.shex-editor-container')!
    this.resultsEl   = pane.querySelector<HTMLElement>('.shex-results')!
    this.stickyEl    = pane.querySelector<HTMLElement>('.shex-results-sticky')!
    this.validateBtn = pane.querySelector<HTMLButtonElement>('.shex-validate-btn')!

    this.editor = new ShExEditor(editorContainer)

    pane.querySelector('.shex-gen-btn')!.addEventListener('click', () => this.onGenerate())
    pane.querySelector('.shex-pick-btn')!.addEventListener('click', () => this.onPickTypes())
    this.validateBtn.addEventListener('click', () => this.onValidate())
  }

  update(state: HandlerState): void {
    this.state = state
  }

  updateText(text: string): void {
    this.turtleText = text
  }

  onActivate(_sidebarEl: HTMLElement): void {
    this.editor?.requestMeasure()
  }

  focusTerm(iri: string): void {
    if (!this.editor || !this.state?.store) return
    const store = this.state.store as N3.Store
    // Find the rdf:type of this IRI
    const typeQuads = store.getQuads(N3.DataFactory.namedNode(iri), N3.DataFactory.namedNode(RDF_TYPE), null, null)
    if (!typeQuads.length) return
    const typeIri = typeQuads[0].object.value
    // ShEx shape name: <typeIri>Shape (as produced by generateShEx)
    // Try short label first, then full IRI
    const shapeLabel = this.labelNode(typeIri) + 'Shape'
    const fullShapeId = typeIri + 'Shape'
    const text = this.editor.getValue()
    if (text.includes(shapeLabel)) {
      this.editor.scrollToText(shapeLabel)
    } else if (text.includes(fullShapeId)) {
      this.editor.scrollToText(fullShapeId)
    }
  }

  private labelNode(iri: string): string {
    if (!this.state) return iri
    return labelIri(iri, this.state.labelMode as 'full' | 'prefixed' | 'label' | 'segment',
      this.state.prefixes, this.state.rdfsLabels)
  }

  private async onGenerate(): Promise<void> {
    if (!this.turtleText) { this.callbacks?.toast('Load a file first', 'info'); return }
    this.callbacks?.toast('Generating ShEx…', 'info')
    try {
      const shex = await generateShEx(this.turtleText, this.state?.baseIri)
      this.editor!.setValue(shex)
      this.callbacks?.toast('ShEx generated', 'success')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.callbacks?.toast(`ShEx generation failed: ${msg}`, 'error')
    }
  }

  private onPickTypes(): void {
    const store = this.state?.store as N3.Store | null | undefined
    if (!store) { this.callbacks?.toast('Load a file first', 'info'); return }

    const typeMap = new Map<string, number>()
    for (const tq of store.getQuads(null, N3.DataFactory.namedNode(RDF_TYPE), null, null)) {
      const t = tq.object.value
      typeMap.set(t, (typeMap.get(t) ?? 0) + 1)
    }
    if (!typeMap.size) { this.callbacks?.toast('No typed nodes found', 'info'); return }
    this.selectedTypes = new Set(typeMap.keys())

    const sticky = this.stickyEl!
    sticky.style.display = ''
    sticky.innerHTML = ''

    const counterRow = document.createElement('div')
    counterRow.className = 'val-counter-row'; counterRow.id = 'val-counter-row'; counterRow.style.display = 'none'
    sticky.appendChild(counterRow)

    const toggleRow = document.createElement('div'); toggleRow.className = 'val-type-toggles'
    const makeBtn = (label: string, cls: string, fn: () => void) => {
      const b = document.createElement('button'); b.className = `btn sm ${cls}`.trim()
      b.textContent = label; b.addEventListener('click', fn); return b
    }
    toggleRow.append(
      makeBtn('All',  'primary', () => { this.selectedTypes = new Set(typeMap.keys()); updateCbs() }),
      makeBtn('None', '',        () => { this.selectedTypes.clear(); updateCbs() }),
    )
    sticky.appendChild(toggleRow)

    const checkRow = document.createElement('div'); checkRow.className = 'val-type-checks'
    const cbs: HTMLInputElement[] = []
    for (const [typeIri, count] of [...typeMap.entries()].sort()) {
      const shortName = this.labelNode(typeIri)
      const lbl = document.createElement('label'); lbl.className = 'val-type-label'; lbl.title = typeIri
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.dataset.typeIri = typeIri
      cbs.push(cb)
      cb.addEventListener('change', () => { if (cb.checked) this.selectedTypes.add(typeIri); else this.selectedTypes.delete(typeIri) })
      lbl.append(cb, ` ${esc(shortName)} `)
      const badge = document.createElement('span'); badge.className = 'val-type-badge'; badge.textContent = String(count)
      lbl.appendChild(badge); checkRow.appendChild(lbl)
    }
    sticky.appendChild(checkRow)

    function updateCbs() {
      // selectedTypes updated by caller; sync checkboxes
      for (const cb of cbs) cb.checked = true  // re-set based on current set
    }

    this.callbacks?.toast(`${typeMap.size} type(s) found — click Validate`, 'info')
  }

  private async onValidate(): Promise<void> {
    if (this.validationRunning) { this.abortValidation(); return }
    if (!this.turtleText) { this.callbacks?.toast('Load a file first', 'info'); return }
    if (!this.selectedTypes.size) { this.callbacks?.toast('Pick types first', 'info'); return }
    const shex = this.editor!.getValue()
    if (!shex.trim() || shex.startsWith('#')) { this.callbacks?.toast('Generate ShEx first', 'info'); return }

    this.validationRunning = true
    this.validateBtn!.textContent = 'Abort'
    this.validateBtn!.classList.add('danger'); this.validateBtn!.classList.remove('primary')

    this.shexWorker?.terminate()
    this.shexWorker = new ShExWorkerClient()
    const out = this.resultsEl!; out.innerHTML = ''

    this.callbacks?.toast('Initialising ShEx worker…', 'info')
    try { await this.shexWorker.init(shex, this.turtleText) }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.callbacks?.toast(`Worker init failed: ${msg}`, 'error')
      out.innerHTML = `<div class="mono text-xs" style="color:var(--accent-rose);padding:12px">Worker init failed: ${esc(String(e))}</div>`
      this.finishValidation(); return
    }

    const store = this.state?.store as N3.Store | null | undefined ?? new N3.Store()
    const allTyped = store
      .getQuads(null, N3.DataFactory.namedNode(RDF_TYPE), null, null)
      .filter(tq => this.selectedTypes.has(tq.object.value))
    const byType = new Map<string, typeof allTyped>()
    for (const tq of allTyped) {
      const t = tq.object.value; if (!byType.has(t)) byType.set(t, []); byType.get(t)!.push(tq)
    }
    const totalNodes = allTyped.length

    const counterRow = this.pane!.querySelector<HTMLElement>('.val-counter-row')!
    counterRow.style.display = ''
    const passedEl = document.createElement('span'); passedEl.style.color = 'var(--accent-green)'
    passedEl.innerHTML = `${Mark_pass} <span data-role="pass-count">0</span> conformant`
    const failedEl = document.createElement('span'); failedEl.style.color = 'var(--accent-rose)'
    failedEl.innerHTML = `${Mark_fail} <span data-role="fail-count">0</span> non-conformant`
    const remainEl = document.createElement('span'); remainEl.style.color = 'var(--accent-amber)'
    remainEl.innerHTML = `${Mark_test} <span data-role="remain-count">${totalNodes}</span> remaining`
    counterRow.innerHTML = ''; counterRow.append(passedEl, '\u00A0\u00B7\u00A0', failedEl, '\u00A0\u00B7\u00A0', remainEl)

    let pass = 0, fail = 0, done = 0
    this.callbacks?.toast('Validating…', 'info')

    try {
      outer:
      for (const [typeIri, quads] of byType) {
        const shortName  = this.labelNode(typeIri)
        const typeHeader = document.createElement('div')
        typeHeader.className = 'val-type-header'
        typeHeader.dataset.typeIri = typeIri
        typeHeader.textContent = shortName
        out.appendChild(typeHeader)
        for (const tq of quads) {
          if (!this.validationRunning) break outer
          const nodeId = tq.subject.value, shapeId = `${typeIri}Shape`, label = this.labelNode(nodeId)
          const row = document.createElement('div'); row.className = 'validation-row'
          row.innerHTML = `<span data-role="icon" style="color:var(--accent-amber)">${Mark_test}</span><div data-role="body"><div class="val-node" title="${esc(nodeId)}">${esc(label)}</div></div>`
          out.appendChild(row); row.scrollIntoView({ block: 'nearest', behavior: 'auto' })
          const r = await this.shexWorker!.validate(nodeId, shapeId)
          if (!this.validationRunning || r.errors[0] === 'aborted') {
            row.querySelector<HTMLElement>('[data-role="body"]')!.innerHTML = `<div class="val-node">${esc(label)} — cancelled</div>`
            break outer
          }
          done++
          if (r.passed) { pass++; passedEl.querySelector('[data-role="pass-count"]')!.textContent = String(pass) }
          else          { fail++; failedEl.querySelector('[data-role="fail-count"]')!.textContent = String(fail) }
          remainEl.querySelector('[data-role="remain-count"]')!.textContent = String(totalNodes - done)
          const icon = row.querySelector<HTMLElement>('[data-role="icon"]')!
          const body = row.querySelector<HTMLElement>('[data-role="body"]')!
          icon.style.color = r.passed ? 'var(--accent-green)' : 'var(--accent-rose)'
          icon.innerHTML = r.passed ? Mark_pass : Mark_fail
          body.innerHTML = `<div class="val-node" title="${esc(nodeId)}">${esc(label)} — ${r.elapsed}ms</div>${r.errors.slice(0,3).map(e => `<div class="val-error">${esc(e.slice(0,200))}</div>`).join('')}`
        }
      }
      this.callbacks?.toast(`Validation: ${pass} pass, ${fail} fail`, fail ? 'error' : 'success')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(msg)
      this.callbacks?.toast(`Validation error: ${msg}`, 'error')
      out.innerHTML += `<div class="mono text-xs" style="color:var(--accent-rose);padding:12px">Validation error: ${esc(msg)}</div>`
    }
    this.finishValidation()
  }

  private abortValidation(): void {
    this.shexWorker?.abort(); this.shexWorker?.terminate(); this.shexWorker = null
    this.validationRunning = false
    this.finishValidation()
    this.callbacks?.toast('Validation aborted', 'info')
  }

  private finishValidation(): void {
    this.validationRunning = false
    if (this.shexWorker) { this.shexWorker.terminate(); this.shexWorker = null }
    if (this.validateBtn) {
      this.validateBtn.textContent = 'Validate'
      this.validateBtn.classList.remove('danger')
      this.validateBtn.classList.add('primary')
    }
  }
}

export const handler: GraphHandler = new ShExPaneHandler()
