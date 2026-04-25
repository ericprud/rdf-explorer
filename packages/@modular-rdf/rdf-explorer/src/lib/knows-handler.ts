/**
 * knows-handler — example third-party GraphHandler
 *
 * Reads foaf:knows triples from the active graph and renders them as
 * "Alice knows Bob." lines — the same format accepted by the knows-parser
 * GraphSource.  This makes a convenient round-trip sanity check:
 *   1. Drop a .knows file → knows-parser produces Turtle
 *   2. The Knows pane reconstructs the original DSL text
 *
 * Shipped alongside knows-parser as a worked example of writing a standalone
 * GraphHandler that can be dragged onto the handler drop zone or referenced
 * via a config "url" field.
 *
 * External dependencies (provided by the host import map at runtime):
 *   n3, @modular-rdf/util-rdf
 */

import type { GraphHandler, HandlerState, HandlerCallbacks } from '@modular-rdf/api-graph-handler'
import * as N3 from 'n3'

const FOAF_KNOWS = 'http://xmlns.com/foaf/0.1/knows'
const FOAF_NAME  = 'http://xmlns.com/foaf/0.1/name'

function localName(iri: string): string {
  const hash = iri.lastIndexOf('#')
  if (hash  >= 0) return iri.slice(hash + 1)
  const slash = iri.lastIndexOf('/')
  if (slash >= 0) return iri.slice(slash + 1)
  return iri
}

class KnowsHandler implements GraphHandler {
  name  = 'knows'
  label = 'Knows'

  private container: HTMLElement | null = null
  private store: N3.Store | null = null

  mount(container: HTMLElement, _callbacks: HandlerCallbacks): void {
    this.container = container
    container.innerHTML = `
      <div class="pane-toolbar flex-row">
        <span class="mono text-xs text-muted grow">foaf:knows → "Alice knows Bob." round-trip</span>
      </div>
      <pre class="knows-output pane-scroll-host" style="padding:12px;margin:0;font-size:0.8rem;flex:1;overflow:auto;white-space:pre-wrap"></pre>
    `
    this.render()
  }

  update(state: HandlerState): void {
    this.store = state.store as N3.Store | null
    this.render()
  }

  private render(): void {
    const pre = this.container?.querySelector<HTMLElement>('.knows-output')
    if (!pre) return
    if (!this.store) { pre.textContent = '# No graph loaded'; return }

    const store  = this.store
    const pKnows = N3.DataFactory.namedNode(FOAF_KNOWS)
    const pName  = N3.DataFactory.namedNode(FOAF_NAME)

    // Prefer foaf:name literals for display so the output matches the original DSL exactly
    const nameOf = new Map<string, string>()
    for (const q of store.getQuads(null, pName, null, null))
      if (q.subject.termType === 'NamedNode' && q.object.termType === 'Literal')
        nameOf.set(q.subject.value, q.object.value)

    const lines: string[] = []
    for (const q of store.getQuads(null, pKnows, null, null)) {
      if (q.subject.termType !== 'NamedNode' || q.object.termType !== 'NamedNode') continue
      const subj = nameOf.get(q.subject.value) ?? localName(q.subject.value)
      const obj  = nameOf.get(q.object.value)  ?? localName(q.object.value)
      lines.push(`${subj} knows ${obj}.`)
    }

    pre.textContent = lines.length
      ? lines.join('\n')
      : '# No foaf:knows triples found'
  }
}

export const handler: GraphHandler = new KnowsHandler()
export default handler
