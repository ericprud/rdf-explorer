/**
 * @modular-rdf/pane-inference
 *
 * Self-contained Type Inference pane for the RDF Explorer.
 *
 * The handler creates its own DOM inside the container passed to mount().
 * It receives the Turtle text via updateText() and runs inference on demand.
 */

import type { GraphHandler, HandlerState, HandlerCallbacks } from '@modular-rdf/api-graph-handler'
import { inferTypes } from './type-inference'

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function shortenIri(iri: string, prefixes: Record<string, string>, baseIri: string): string {
  const all: Record<string, string> = {
    [baseIri.replace(/\/$/, '#')]: 'ex',
    'http://www.w3.org/2000/01/rdf-schema#':        'rdfs',
    'http://www.w3.org/1999/02/22-rdf-syntax-ns#':  'rdf',
    'http://www.w3.org/2001/XMLSchema#':             'xsd',
    'http://xmlns.com/foaf/0.1/':                   'foaf',
    ...prefixes,
  }
  for (const [uri, pfx] of Object.entries(all))
    if (iri.startsWith(uri)) return `${pfx}:${iri.slice(uri.length)}`
  const m = iri.match(/[/#]([^/#]+)$/)
  return m ? decodeURIComponent(m[1]) : iri
}

// ── Handler ───────────────────────────────────────────────────────────────────

class InferencePaneHandler implements GraphHandler {
  readonly name  = 'inference'
  readonly label = 'Type Inference'

  private callbacks: HandlerCallbacks | null = null
  private turtle:    string                  = ''
  private prefixes:  Record<string, string>  = {}
  private baseIri:   string                  = 'https://example.org/upload/'
  private listEl:    HTMLElement | null      = null

  mount(container: HTMLElement, callbacks: HandlerCallbacks): void {
    this.callbacks = callbacks

    container.innerHTML = `
      <div class="pane-toolbar flex-row">
        <span class="mono text-xs text-muted grow">Plain-string literals that look like typed values</span>
        <button class="btn sm primary">Analyse</button>
      </div>
      <ul class="inference-list pane-scroll-host">
        <li style="color:var(--text-muted);font-family:var(--font-mono);font-size:11px;padding:12px;">
          Load a file then click Analyse.
        </li>
      </ul>`

    this.listEl = container.querySelector<HTMLElement>('.inference-list')!
    const btn   = container.querySelector<HTMLButtonElement>('.btn.primary')!
    btn.addEventListener('click', () => { void this.analyse() })
  }

  update(state: HandlerState): void {
    this.prefixes = state.prefixes
    this.baseIri  = state.baseIri
  }

  updateText(text: string): void {
    this.turtle = text
  }

  private async analyse(): Promise<void> {
    if (!this.turtle) { this.callbacks?.toast('Load a file first', 'info'); return }
    this.callbacks?.toast('Analysing\u2026', 'info')

    const shorten = (iri: string) => shortenIri(iri, this.prefixes, this.baseIri)
    const suggestions = await inferTypes(this.turtle)
    const list = this.listEl!

    if (!suggestions.length) {
      list.innerHTML = `<li style="color:var(--text-muted);font-family:var(--font-mono);font-size:11px;padding:12px;">No suggestions.</li>`
      this.callbacks?.toast('No type issues found', 'success')
      return
    }

    list.innerHTML = suggestions.map(s => `
      <li class="inference-item">
        <div class="inference-subject">${esc(shorten(s.subject))}</div>
        <div class="inference-value"><span class="text-muted">${esc(shorten(s.predicate))}</span>&nbsp;<strong>"${esc(s.value)}"</strong></div>
        <div class="inference-type">detected as: <strong>${esc(s.pattern)}</strong></div>
        <div class="inference-fix">&rarr; ${esc(s.fix)}</div>
      </li>`).join('')

    this.callbacks?.toast(`${suggestions.length} suggestion(s)`, 'info')
  }

  focusTerm(iri: string): void {
    if (!this.listEl) return
    // Find first inference-item whose subject text contains the IRI's local name
    const items = this.listEl.querySelectorAll<HTMLElement>('.inference-item')
    for (const item of items) {
      const subj = item.querySelector<HTMLElement>('.inference-subject')
      if (subj?.title === iri || subj?.textContent?.includes(iri.split(/[/#]/).pop() ?? iri)) {
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
        item.style.outline = '2px solid var(--accent-teal)'
        setTimeout(() => { item.style.outline = '' }, 2000)
        break
      }
    }
  }
}

export const handler: GraphHandler = new InferencePaneHandler()
export default handler
