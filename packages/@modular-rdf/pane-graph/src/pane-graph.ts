/**
 * @modular-rdf/pane-graph
 *
 * GraphHandler implementation for the D3 force-directed graph pane.
 *
 * Owns:
 *  - Graph toolbar (arc flags, arc filter, fit button)
 *  - D3 GraphView canvas
 *  - Node detail panel
 *  - Legend
 *  - Sidebar: filter, spotlight, group-by, stats, node list (via onActivate)
 */
import type { GraphHandler, HandlerState, HandlerCallbacks } from '@modular-rdf/graph-handler-api'
import { labelIri } from '@modular-rdf/rdf-utils'
import * as N3 from 'n3'
import { GraphView, TYPE_COLORS, TYPE_RADII, HULL_FILLS } from './graph-view'
import { buildGraphData, shortIri, type GraphNode, type GraphData } from './graph-data'
import { assignTypeColors } from './color-scheme'
import { buildRenderConfigJsonLd, parseRenderConfigJsonLd, normalisePrefixes } from './render-config-jsonld'

export { TYPE_COLORS, TYPE_RADII, HULL_FILLS }
export { assignTypeColors }
export { buildRenderConfigJsonLd, parseRenderConfigJsonLd, normalisePrefixes }
export type { GraphNode, GraphData }

function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

class GraphPaneHandler implements GraphHandler {
  name  = 'graph'
  label = 'Graph'

  private graphView:   GraphView | null = null
  private graphData:   GraphData | null = null
  private callbacks:   HandlerCallbacks | null = null
  private state:       HandlerState | null = null
  private detailNode:  GraphNode | null = null
  private sidebarEl:   HTMLElement | null = null

  // Sidebar elements (created in onActivate)
  private regexInput:   HTMLInputElement | null = null
  private spotInput:    HTMLInputElement | null = null
  private groupSel:     HTMLSelectElement | null = null
  private nodeListEl:   HTMLElement | null = null
  private nodeFilterEl: HTMLInputElement | null = null
  private nodeCountEl:  HTMLElement | null = null
  private statsEl:      HTMLElement | null = null
  private statsContent: HTMLElement | null = null

  // Toolbar / container elements (created in mount)
  private toolbar:      HTMLElement | null = null
  private container:    HTMLElement | null = null
  private legendEl:     HTMLElement | null = null
  private legendItems:  HTMLElement | null = null
  private legendDlBtn:  HTMLButtonElement | null = null
  private nodeDetail:   HTMLElement | null = null
  private arcFilterMenu: HTMLElement | null = null

  mount(pane: HTMLElement, callbacks: HandlerCallbacks): void {
    this.callbacks = callbacks

    pane.innerHTML = `
      <div class="graph-toolbar">
        <span class="text-xs mono text-muted">Scroll&#x2191; expand &middot; Scroll&#x2193; contract &middot; Click pin &middot; Drag move &middot; Right-click menu</span>
        <div class="header-spacer"></div>
        <span class="text-xs mono text-muted graph-stats-inline"></span>
        <button class="icon-btn sm active" data-btn="hide-type-arcs"    title="Show rdf:type edges and type-only nodes (currently hidden)">&#x1D461; arcs</button>
        <button class="icon-btn sm"        data-btn="type-connectivity"  title="Exclude rdf:type edges from connectivity (currently excluded)">&#x1D461; conn</button>
        <button class="icon-btn sm active" data-btn="hide-scalar-arcs"   title="Show scalar property edges (currently hidden; values shown in tooltip)">scalar arcs</button>
        <button class="icon-btn sm"        data-btn="scalar-connectivity" title="Include scalar arcs in connectivity (currently excluded)">scalar conn</button>
        <button class="icon-btn sm"        data-btn="arc-filter"          title="Filter which arc types are shown">arcs &#x25BE;</button>
        <button class="icon-btn sm"        data-btn="fit"                 title="Fit graph to screen (Alt+G)">&#x229F;</button>
      </div>
      <div class="graph-container-inner" id="graph-container"></div>
      <div class="node-detail">
        <div class="node-detail-header">
          <div>
            <div class="node-detail-label nd-label"></div>
            <div class="node-detail-types nd-types"></div>
          </div>
          <button class="icon-btn sm nd-close">&#x2715;</button>
        </div>
        <div class="node-detail-body nd-body"></div>
        <div class="node-detail-footer">
          <button class="btn sm nd-turtle-link">&#x2192; Turtle</button>
          <button class="btn sm nd-expand-btn">Expand node</button>
        </div>
      </div>
      <div class="legend">
        <div class="legend-items"></div>
        <button class="icon-btn sm legend-dl-btn" style="display:none;margin-top:4px;width:100%;font-size:10px">&#x2B07; JSON-LD</button>
      </div>
    `

    const graphContainer = pane.querySelector<HTMLElement>('#graph-container')!
    this.toolbar    = pane.querySelector<HTMLElement>('.graph-toolbar')!
    this.container  = graphContainer
    this.nodeDetail = pane.querySelector<HTMLElement>('.node-detail')!
    this.legendEl   = pane.querySelector<HTMLElement>('.legend')!
    this.legendItems = pane.querySelector<HTMLElement>('.legend-items')!
    this.legendDlBtn = pane.querySelector<HTMLButtonElement>('.legend-dl-btn')!

    this.graphView = new GraphView({
      container:   graphContainer,
      onNodeClick: (node) => this.showNodeDetail(node),
      onToast:     (msg, type) => callbacks.toast(msg, type),
      labelFn:     (iri) => this.labelNode(iri),
    })

    this.wireToolbar(pane)
    this.wireNodeDetail(pane)

    this.legendDlBtn.addEventListener('click', () => this.downloadRenderConfig())
  }

  private labelNode(iri: string): string {
    if (!this.state) return iri
    return labelIri(iri, this.state.labelMode as 'full' | 'prefixed' | 'label' | 'segment',
      this.state.prefixes, this.state.rdfsLabels)
  }

  private wireToolbar(pane: HTMLElement): void {
    const btn = (key: string) => pane.querySelector<HTMLButtonElement>(`[data-btn="${key}"]`)!

    const wireToggle = (
      key: string,
      getState:  () => boolean,
      doToggle:  () => boolean,
      msgOn: string, msgOff: string,
    ) => {
      const el = btn(key)
      el.classList.toggle('active', getState())   // sync initial state from model
      el.addEventListener('click', () => {
        if (!this.graphView) return
        const now = doToggle()
        el.classList.toggle('active', now)
        this.callbacks?.toast(now ? msgOn : msgOff, 'info')
      })
    }

    wireToggle('hide-type-arcs',
      () => this.graphView?.getHideTypeArcs() ?? true,
      () => this.graphView!.toggleHideTypeArcs(),
      'rdf:type arcs hidden', 'rdf:type arcs shown')

    wireToggle('type-connectivity',
      () => !(this.graphView?.getTypeArcsInConnectivity() ?? false),
      () => !this.graphView!.toggleTypeArcsInConnectivity(),
      'rdf:type arcs excluded from connectivity', 'rdf:type arcs included in connectivity')

    wireToggle('hide-scalar-arcs',
      () => this.graphView?.getHideScalarArcs() ?? true,
      () => this.graphView!.toggleHideScalarArcs(),
      'Scalar arcs hidden', 'Scalar arcs shown')

    wireToggle('scalar-connectivity',
      () => !(this.graphView?.getScalarArcsInConnectivity() ?? false),
      () => !this.graphView!.toggleScalarArcsInConnectivity(),
      'Scalar arcs excluded from connectivity', 'Scalar arcs included in connectivity')

    btn('fit').addEventListener('click', () => this.graphView?.fitAll())

    const arcFilterBtn = btn('arc-filter')
    arcFilterBtn.addEventListener('click', e => {
      e.stopPropagation()
      if (this.arcFilterMenu) { this.dismissArcFilter(); return }
      if (!this.graphData) { this.callbacks?.toast('Load a file first', 'info'); return }

      const preds = new Map<string, string>()
      for (const edge of this.graphData.edges) {
        if (!preds.has(edge.predicateFull)) preds.set(edge.predicateFull, edge.predicate)
      }
      if (!preds.size) { this.callbacks?.toast('No edges in graph', 'info'); return }

      const menu = document.createElement('div')
      menu.style.cssText = [
        'position:absolute', 'right:8px', 'top:36px',
        'background:var(--bg-card,#1e293b)', 'border:1px solid var(--border,#334155)',
        'border-radius:6px', 'padding:8px', 'min-width:240px', 'max-height:320px',
        'overflow-y:auto', 'z-index:200', 'box-shadow:0 8px 24px rgba(0,0,0,0.4)',
        'font-family:var(--font-mono,monospace)', 'font-size:11px',
      ].join(';')

      for (const [full, short] of [...preds.entries()].sort(([,a],[,b]) => a.localeCompare(b))) {
        const label = document.createElement('label')
        label.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 2px;cursor:pointer;color:var(--text-primary,#e2e8f0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
        const cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.checked = !this.graphView!.isExcluded(full)
        cb.addEventListener('change', () => {
          this.graphView!.togglePredicate(full)
          this.callbacks?.toast(`${short}: ${cb.checked ? 'shown' : 'hidden'}`, 'info')
        })
        const span = document.createElement('span')
        span.title = full; span.textContent = short
        label.append(cb, span)
        menu.appendChild(label)
      }

      this.toolbar!.style.position = 'relative'
      this.toolbar!.appendChild(menu)
      this.arcFilterMenu = menu
    })

    document.addEventListener('click', () => this.dismissArcFilter())
  }

  private dismissArcFilter(): void {
    this.arcFilterMenu?.remove()
    this.arcFilterMenu = null
  }

  private wireNodeDetail(pane: HTMLElement): void {
    const detail = pane.querySelector<HTMLElement>('.node-detail')!

    pane.querySelector('.nd-close')!.addEventListener('click', () =>
      detail.classList.remove('visible'))

    pane.querySelector('.nd-turtle-link')!.addEventListener('click', () => {
      if (!this.detailNode) return
      const iri = this.detailNode.id
      this.callbacks?.switchTab('turtle')
      // focusTerm routes to the now-active turtle pane
      setTimeout(() => this.callbacks?.focusTerm(iri), 80)
    })

    pane.querySelector('.nd-expand-btn')!.addEventListener('click', () => {
      if (!this.detailNode || !this.graphView) return
      const nowExpanded = this.graphView.toggleExpand(this.detailNode.id)
      this.detailNode.expanded = nowExpanded
      pane.querySelector<HTMLElement>('.nd-expand-btn')!.textContent =
        nowExpanded ? 'Contract node' : 'Expand node'
      this.callbacks?.toast(nowExpanded ? `Expanded: ${this.detailNode.label}` : `Contracted: ${this.detailNode.label}`, 'info')
    })
  }

  private showNodeDetail(node: GraphNode): void {
    this.detailNode = node
    const detail = this.nodeDetail!
    detail.querySelector<HTMLElement>('.nd-label')!.textContent = this.labelNode(node.id)
    detail.querySelector<HTMLElement>('.nd-types')!.textContent = node.types.join(' · ') || '(no type)'

    const body = detail.querySelector<HTMLElement>('.nd-body')!
    body.innerHTML = ''

    const store = this.state?.store as N3.Store | null | undefined
    if (store) {
      const quads = store.getQuads(N3.DataFactory.namedNode(node.id), null, null, null)
      for (const q of quads.slice(0, 50)) {
        const row = document.createElement('div')
        row.className = 'triple-row'
        const predShort = this.labelNode(q.predicate.value)
        const isIri     = q.object.termType === 'NamedNode'
        const objText   = isIri
          ? this.labelNode(q.object.value)
          : esc(q.object.value.slice(0, 120) + (q.object.value.length > 120 ? '…' : ''))
        row.innerHTML = `
          <span class="triple-pred" title="${esc(q.predicate.value)}">${esc(predShort)}</span>
          <span class="triple-obj">${isIri
            ? `<a class="iri-link" data-iri="${esc(q.object.value)}">${esc(objText)}</a>`
            : objText}</span>`
        body.appendChild(row)
      }
      if (quads.length > 50) {
        const more = document.createElement('div')
        more.className = 'mono text-xs text-muted'; more.style.padding = '4px 0'
        more.textContent = `… ${quads.length - 50} more triples`
        body.appendChild(more)
      }
      body.querySelectorAll<HTMLElement>('.iri-link').forEach(a => {
        a.addEventListener('click', () => {
          const iri = a.dataset.iri!
          this.graphView?.scrollToNode(iri)
          const target = this.graphData?.nodes.find(n => n.id === iri)
          if (target) this.showNodeDetail(target)
        })
      })
    }

    detail.querySelector<HTMLElement>('.nd-expand-btn')!.textContent =
      node.expanded ? 'Contract node' : 'Expand node'
    detail.classList.add('visible')
  }

  update(state: HandlerState): void {
    this.state = state
    if (!state.store) return

    const store = state.store as N3.Store
    // Re-build the prefix map for shortIri: graph-store uses {nsUri → pfxLabel},
    // N3 output uses {pfxLabel → nsUri}.  Normalise to {pfxLabel → nsUri}.
    const pfxNorm = normalisePrefixes(state.prefixes)
    this.graphData = buildGraphData(store, pfxNorm)

    // labelFn was passed as a closure in the constructor and always reads this.state,
    // so no setLabelFn() call is needed — load() triggers one render.
    this.graphView?.load(this.graphData)

    this.buildLegend()
    this.rebuildNodeList()
    this.updateStatsInline()
  }

  onActivate(sidebarEl: HTMLElement): void {
    this.sidebarEl = sidebarEl
    sidebarEl.innerHTML = `
      <div class="sidebar-section">
        <div class="sidebar-section-title">Filter / Spotlight</div>
        <div class="input-group">
          <label class="input-label">Regex filter (nodes shown)</label>
          <input class="input graph-regex-input" placeholder="e.g. Film.*SUT|Logan" spellcheck="false"/>
          <div class="input-hint graph-regex-hint"></div>
        </div>
        <div class="input-group">
          <label class="input-label">Spotlight (dim others)</label>
          <input class="input graph-spot-input" placeholder="search labels&hellip;"/>
        </div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">Group by</div>
        <select class="input graph-group-sel">
          <option value="type">RDF type</option>
          <option value="namespace">Namespace</option>
          <option value="none">None</option>
        </select>
      </div>
      <div class="sidebar-section graph-stats-section" style="display:none">
        <div class="sidebar-section-title">Stats</div>
        <div class="graph-stats-content mono text-xs text-muted" style="line-height:1.9"></div>
      </div>
      <div class="sidebar-section" style="flex:1;overflow-y:auto;min-height:0;">
        <div class="sidebar-section-title flex-row" style="justify-content:space-between;align-items:center;">
          <span>Nodes <span class="graph-node-count text-muted"></span></span>
          <input class="input graph-node-filter" placeholder="filter list&hellip;"
                 style="width:88px;font-size:10px;padding:2px 6px;"/>
        </div>
        <div class="graph-node-list"></div>
      </div>
    `

    this.regexInput   = sidebarEl.querySelector<HTMLInputElement>('.graph-regex-input')!
    this.spotInput    = sidebarEl.querySelector<HTMLInputElement>('.graph-spot-input')!
    this.groupSel     = sidebarEl.querySelector<HTMLSelectElement>('.graph-group-sel')!
    this.nodeListEl   = sidebarEl.querySelector<HTMLElement>('.graph-node-list')!
    this.nodeFilterEl = sidebarEl.querySelector<HTMLInputElement>('.graph-node-filter')!
    this.nodeCountEl  = sidebarEl.querySelector<HTMLElement>('.graph-node-count')!
    this.statsEl      = sidebarEl.querySelector<HTMLElement>('.graph-stats-section')!
    this.statsContent = sidebarEl.querySelector<HTMLElement>('.graph-stats-content')!

    this.regexInput.addEventListener('input', () => {
      const val = this.regexInput!.value.trim()
      const valid = !val || this.isValidRegex(val)
      this.regexInput!.classList.toggle('error', !valid)
      sidebarEl.querySelector<HTMLElement>('.graph-regex-hint')!.textContent = valid ? '' : 'Invalid regex'
      if (valid) this.graphView?.setFilter(val || null)
    })

    this.spotInput.addEventListener('input', () =>
      this.graphView?.setSpotlight(this.spotInput!.value))

    this.groupSel.addEventListener('change', () =>
      this.graphView?.setGroupBy(this.groupSel!.value))

    this.nodeFilterEl.addEventListener('input', () =>
      this.rebuildNodeList())

    // Populate with current data
    this.rebuildNodeList()
    this.updateStatsInline()
  }

  onDeactivate(): void {
    if (this.sidebarEl) this.sidebarEl.innerHTML = ''
    this.regexInput = null
    this.spotInput = null
    this.groupSel = null
    this.nodeListEl = null
    this.nodeFilterEl = null
    this.nodeCountEl = null
    this.statsEl = null
    this.statsContent = null
    this.sidebarEl = null
  }

  focusTerm(iri: string): void {
    if (!this.graphView) return
    this.graphView.scrollToNode(iri)
    this.graphView.setHighlighted(new Set([iri]))
  }

  private isValidRegex(s: string): boolean {
    try { new RegExp(s); return true } catch { return false }
  }

  private rebuildNodeList(): void {
    if (!this.nodeListEl || !this.graphData) return
    const nodes = this.graphData.nodes
    this.nodeCountEl && (this.nodeCountEl.textContent = `(${nodes.length})`)
    const filter = this.nodeFilterEl?.value.toLowerCase() ?? ''
    const filtered = filter ? nodes.filter(n => {
      const lab = this.labelNode(n.id).toLowerCase()
      return lab.includes(filter) || n.id.toLowerCase().includes(filter)
    }) : nodes

    this.nodeListEl.innerHTML = ''
    for (const node of filtered.slice(0, 300)) {
      const color = Object.entries(TYPE_COLORS).find(([t]) => node.types.includes(t))?.[1] ?? '#94a3b8'
      const item = document.createElement('div'); item.className = 'node-item'
      item.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${color}"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--text-secondary);" title="${esc(node.id)}">${esc(this.labelNode(node.id))}</span>`
      item.addEventListener('click', () => {
        this.graphView?.scrollToNode(node.id)
        this.showNodeDetail(node)
      })
      this.nodeListEl.appendChild(item)
    }
    if (filtered.length > 300) {
      const more = document.createElement('div'); more.className = 'mono text-xs text-muted'; more.style.padding = '4px 8px'
      more.textContent = `… ${filtered.length - 300} more`
      this.nodeListEl.appendChild(more)
    }
  }

  private buildLegend(): void {
    if (!this.legendItems) return
    const types = Object.entries(TYPE_COLORS)
      .filter(([k]) => k !== 'default' && !k.startsWith('rdfs'))
    this.legendItems.innerHTML = types
      .map(([k, color]) => `<div class="legend-item"><div class="legend-dot" style="background:${color}"></div><span>${esc(this.labelNode(k))}</span></div>`)
      .join('')
    if (this.legendDlBtn) this.legendDlBtn.style.display = types.length ? '' : 'none'
  }

  private updateStatsInline(): void {
    if (!this.graphData) return
    const nodes = this.graphData.nodes.filter(n => n.types[0] !== '__literal__').length
    const edges = this.graphData.edges.filter(e => !e.isScalar).length
    const statsSpan = this.toolbar?.querySelector<HTMLElement>('.graph-stats-inline')
    if (statsSpan) statsSpan.textContent = `${nodes} nodes · ${edges} edges`
  }

  private downloadRenderConfig(): void {
    const jsonld = buildRenderConfigJsonLd(TYPE_COLORS, TYPE_RADII, HULL_FILLS, this.state?.prefixes ?? {})
    const blob = new Blob([JSON.stringify(jsonld, null, 2)], { type: 'application/ld+json' })
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: 'render-config.jsonld',
    })
    a.click(); URL.revokeObjectURL(a.href)
    this.callbacks?.toast('Render config downloaded', 'success')
  }
}

export const handler: GraphHandler = new GraphPaneHandler()
