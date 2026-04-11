/**
 * @modular-rdf/pane-sparql
 *
 * Self-contained SPARQL SELECT pane for the RDF Explorer.
 *
 * The handler creates its own DOM inside the container passed to mount().
 * It receives state updates via update() (for the N3 store) and can
 * run SELECT queries against the current graph.
 */

import type { GraphHandler, HandlerState, HandlerCallbacks } from '@modular-rdf/graph-handler-api'
import { runSparqlSelect } from './sparql-runner'
import type * as N3 from 'n3'

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

class SparqlPaneHandler implements GraphHandler {
  readonly name  = 'sparql'
  readonly label = 'SPARQL'

  private store:     N3.Store | null         = null
  private prefixes:  Record<string, string>  = {}
  private baseIri:   string                  = 'https://example.org/upload/'
  private callbacks: HandlerCallbacks | null = null
  private resultsEl: HTMLElement | null      = null
  private queryEl:   HTMLTextAreaElement | null = null

  mount(container: HTMLElement, callbacks: HandlerCallbacks): void {
    this.callbacks = callbacks

    container.innerHTML = `
      <div class="sparql-pane">
        <div class="sparql-editor-wrap">
          <div class="pane-toolbar flex-row">
            <span class="mono text-xs text-muted grow">SPARQL SELECT \u00B7 Ctrl+Enter to run</span>
            <button class="btn sm primary">&#x25B6; Run</button>
          </div>
          <textarea class="sparql-textarea" spellcheck="false">SELECT ?s ?p ?o
WHERE {
  ?s ?p ?o .
}
LIMIT 50</textarea>
        </div>
        <div class="sparql-results pane-scroll-host">
          <div class="mono text-xs text-muted" style="padding:12px">Run a query to see results.</div>
        </div>
      </div>`

    const runBtn   = container.querySelector<HTMLButtonElement>('.btn.primary')!
    this.queryEl   = container.querySelector<HTMLTextAreaElement>('.sparql-textarea')!
    this.resultsEl = container.querySelector<HTMLElement>('.sparql-results')!

    runBtn.addEventListener('click', () => this.run())
    this.queryEl.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); this.run() }
    })
  }

  update(state: HandlerState): void {
    // N3.Store satisfies RdfDataset — the cast is safe for our callers.
    this.store    = state.store as N3.Store | null
    this.prefixes = state.prefixes
    this.baseIri  = state.baseIri
  }

  private run(): void {
    if (!this.store) { this.callbacks?.toast('Load a file first', 'info'); return }
    if (!this.queryEl || !this.resultsEl) return

    const query = this.queryEl.value
    const t0    = performance.now()
    const res   = runSparqlSelect(this.store, query, { ex: this.baseIri.replace(/\/$/, '#') })
    const ms    = (performance.now() - t0).toFixed(1)
    const out   = this.resultsEl

    if (res.error) {
      out.innerHTML = `<div class="mono text-xs" style="color:var(--accent-rose);padding:12px">${esc(res.error)}</div>`
      return
    }
    if (!res.bindings.length) {
      out.innerHTML = `<div class="mono text-xs text-muted" style="padding:12px">No results (${ms}ms).</div>`
      return
    }

    const shorten = (iri: string): string =>
      iri.length > 80 ? shortenIri(iri, this.prefixes, this.baseIri) : iri

    let html = `<div class="mono text-xs text-muted" style="padding:4px 12px 6px">`
      + `${res.bindings.length} result(s) \u00B7 ${ms}ms</div>`
      + `<table class="result-table"><thead><tr>`
    for (const v of res.variables) html += `<th>${esc(v)}</th>`
    html += '</tr></thead><tbody>'
    for (const row of res.bindings) {
      html += '<tr>'
      for (const v of res.variables) {
        const val = row[v] ?? ''
        html += `<td title="${esc(val)}">${esc(shorten(val))}</td>`
      }
      html += '</tr>'
    }
    out.innerHTML = html + '</tbody></table>'

    // Make IRI cells clickable — navigate the graph view to that node.
    out.querySelectorAll<HTMLElement>('td').forEach(td => {
      const full = td.title
      if (full && (full.startsWith('http://') || full.startsWith('https://'))) {
        td.style.cursor = 'pointer'
        td.style.color  = 'var(--accent-teal)'
        td.addEventListener('click', () => this.callbacks?.showNode?.(full))
      }
    })

    this.callbacks?.toast(`${res.bindings.length} results`, 'success')
  }
}

export const handler: GraphHandler = new SparqlPaneHandler()
export default handler
