/**
 * @modular-rdf/pane-turtle
 *
 * GraphHandler implementation for the editable Turtle pane.
 *
 * Owns:
 *  - CodeMirror TurtleEditor (editable)
 *  - Revert button (reverts to last loader-supplied text)
 *
 * focusTerm: scrolls the editor to the first occurrence of the IRI.
 */
import type { GraphHandler, HandlerState, HandlerCallbacks } from '@modular-rdf/api-graph-handler'
import type { GraphSource, ApplyGraphCallback } from '@modular-rdf/api-graph-source'
import { TurtleEditor } from './turtle-editor'

class TurtlePaneHandler implements GraphHandler {
  name  = 'turtle'
  label = 'Turtle'

  private editor:       TurtleEditor | null = null
  private callbacks:    HandlerCallbacks | null = null
  private savedTurtle   = ''
  private editTimer:    ReturnType<typeof setTimeout> | null = null
  private revertBtn:    HTMLButtonElement | null = null
  /** True while setContent() is executing — suppresses the onChange loop. */
  private programmatic  = false

  mount(pane: HTMLElement, callbacks: HandlerCallbacks): void {
    this.callbacks = callbacks

    pane.innerHTML = `
      <div class="pane-toolbar flex-row">
        <span class="mono text-xs text-muted grow">Turtle &middot; editable &middot; changes update SPARQL &amp; ShEx</span>
        <button class="btn sm turtle-revert-btn" style="display:none">&#x21BA; Revert</button>
      </div>
      <div class="turtle-editor-container pane-scroll-host"></div>
    `

    this.revertBtn = pane.querySelector<HTMLButtonElement>('.turtle-revert-btn')!
    const container = pane.querySelector<HTMLElement>('.turtle-editor-container')!

    this.editor = new TurtleEditor(container, { editable: true })
    this.editor.onChange((text) => this.onEdited(text))

    this.revertBtn.addEventListener('click', () => {
      if (!this.savedTurtle) return
      this.setContentProgrammatically(this.savedTurtle)
      callbacks.applyGraph({ text: this.savedTurtle })
      callbacks.toast('Turtle reverted', 'info')
    })
  }

  update(_state: HandlerState): void {
    // No state fields needed beyond what updateText provides.
  }

  updateText(text: string): void {
    this.savedTurtle = text
    this.setContentProgrammatically(text)
  }

  onActivate(_sidebarEl: HTMLElement): void {
    this.editor?.requestMeasure()
  }

  focusTerm(iri: string): void {
    this.editor?.scrollToTerm(iri)
  }

  private setContentProgrammatically(text: string): void {
    this.programmatic = true
    this.editor?.setContent(text)
    this.programmatic = false
    if (this.revertBtn) this.revertBtn.style.display = 'none'
  }

  private onEdited(text: string): void {
    // Ignore changes triggered by setContent() calls — only react to user edits.
    if (this.programmatic) return
    if (this.revertBtn) {
      this.revertBtn.style.display = text !== this.savedTurtle ? '' : 'none'
    }
    if (this.editTimer) clearTimeout(this.editTimer)
    this.editTimer = setTimeout(() => {
      this.callbacks?.applyGraph({ text })
    }, 600)
  }
}

export const handler: GraphHandler = new TurtlePaneHandler()

// ── Turtle / TriG GraphSource ─────────────────────────────────────────────────

const TURTLE_EXTS = ['.ttl', '.n3', '.turtle', '.trig', '.nt']

class TurtlePaneSource implements GraphSource {
  name    = 'Turtle / TriG'
  accepts = TURTLE_EXTS

  buildPanel(container: HTMLElement, applyGraph: ApplyGraphCallback): void {
    const zone = document.createElement('div')
    zone.style.cssText = [
      'border:1px dashed var(--border,#334155)',
      'border-radius:4px',
      'padding:8px',
      'text-align:center',
      'cursor:pointer',
      'font-size:10px',
      'color:var(--text-muted,#94a3b8)',
      'transition:background 0.15s',
    ].join(';')
    zone.textContent = 'Drop .ttl / .trig / .nt — or click to choose'

    const fi = document.createElement('input')
    fi.type = 'file'; fi.accept = TURTLE_EXTS.join(','); fi.multiple = true
    fi.style.display = 'none'
    container.append(zone, fi)

    const loadFile = async (file: File): Promise<void> => {
      const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase()
      if (TURTLE_EXTS.includes(ext)) applyGraph({ text: await file.text(), filename: file.name })
    }

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.background = 'var(--bg-hover,#1e293b)' })
    zone.addEventListener('dragleave', () => { zone.style.background = '' })
    zone.addEventListener('drop', async e => {
      e.preventDefault(); zone.style.background = ''
      for (const file of e.dataTransfer?.files ?? []) await loadFile(file)
    })
    zone.addEventListener('click', () => fi.click())
    fi.addEventListener('change', async () => {
      for (const file of fi.files ?? []) await loadFile(file)
      fi.value = ''
    })
  }
}

export const source: GraphSource = new TurtlePaneSource()
