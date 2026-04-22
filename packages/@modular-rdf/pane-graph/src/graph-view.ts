/**
 * GraphView – D3 force-directed graph
 *
 * State flags (each independently controlled by a toolbar button):
 *
 *  DISPLAY flags — affect what is rendered:
 *   hideTypeArcs        hide rdf:type edges and type-only nodes
 *   hideScalarArcs      hide edges to literal values
 *
 *  CONNECTIVITY flags — affect graph algorithms (disconnected / shortest-path):
 *   typeArcsInConnectivity    when false, rdf:type edges are ignored by algorithms
 *   scalarArcsInConnectivity  when false, literal-target edges are ignored by algorithms
 *
 * Note: GraphEdge only contains IRI→IRI edges (graph-store.ts never creates
 * edges for literal objects).  "Scalar arcs" in connectivity refers to the
 * absence of those edges — the flag controls whether the node set is restricted
 * to nodes that have at least one non-scalar, non-type connection, or left as-is.
 * Since literals are not nodes, scalar connectivity only matters via shared
 * literal values; those are never in allEdges so this flag currently has no
 * effect on BFS but is kept for future use when scalar edges are materialised.
 *
 * Tooltip: when hideScalarArcs is true (scalars hidden from graph), hovering a
 * node shows all scalar properties in the SVG title tooltip, so the data is
 * not lost.
 */
import * as d3 from 'd3'
import type { GraphData, GraphNode, GraphEdge } from './graph-data'
import { pushHistory, readHistory } from './view-state'

export interface GraphViewOptions {
  container:    HTMLElement
  onNodeClick?: (node: GraphNode) => void
  onToast?:     (msg: string, type?: 'info' | 'success' | 'error') => void
  /** Optional: override how node/predicate IRIs are displayed as text labels. */
  labelFn?:     (iri: string) => string
}

const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

// ── Colour palette ──────────────────────────────────────────────────────────
export const TYPE_COLORS: Record<string, string> = {
  default:                '#94a3b8',
}

export const TYPE_RADII: Record<string, number> = {
  default:                8,
}

export const HULL_FILLS: Record<string, string> = {
  default:                'rgba(148,163,184,0.05)',
}

const EDGE_COLOR = '#64748b'
const ARROW_FILL = '#94a3b8'

function nodeColor(n: GraphNode): string {
  for (const t of n.types)
    if (TYPE_COLORS[t])
      return TYPE_COLORS[t]
  return TYPE_COLORS.default
}
function nodeRadius(n: GraphNode): number {
  if (n.expanded) return 16
  for (const [matchType, radius] of Object.entries(TYPE_RADII))
    for (const nType of n.types)
      if (nType === matchType)
        return radius
  return TYPE_RADII.default
}
function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
function getNodeId(n: string | GraphNode): string {
  return typeof n === 'string' ? n : n.id
}
function getNodeX(n: string | GraphNode): number {
  return typeof n === 'string' ? 0 : ((n as GraphNode).x ?? 0)
}
function getNodeY(n: string | GraphNode): number {
  return typeof n === 'string' ? 0 : ((n as GraphNode).y ?? 0)
}
function getGroupKey(n: GraphNode, groupBy: string): string {
  if (groupBy === 'type') {
    for (const t of n.types) if (TYPE_COLORS[t]) return t
    return n.types[0] ?? 'untyped'
  }
  if (groupBy === 'namespace') return n.namespace
  return 'all'
}

// ── Convex hull ─────────────────────────────────────────────────────────────
function hullPath(points: [number, number][]): string {
  if (points.length < 3) {
    if (!points.length) return ''
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length
    const cy = points.reduce((s, p) => s + p[1], 0) / points.length
    const r = 28
    return `M ${cx-r},${cy} a${r},${r} 0 1,0 ${2*r},0 a${r},${r} 0 1,0 ${-2*r},0`
  }
  const hull = d3.polygonHull(points); if (!hull) return ''
  const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length
  const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length
  const pad = 22
  const padded = hull.map(([x, y]): [number, number] => {
    const dx = x - cx, dy = y - cy, len = Math.sqrt(dx*dx + dy*dy) || 1
    return [x + dx/len*pad, y + dy/len*pad]
  })
  return 'M' + padded.map(p => p.join(',')).join('L') + 'Z'
}

// ── Edge geometry ────────────────────────────────────────────────────────────
function edgePath(sx: number, sy: number, tx: number, ty: number, tr: number, curvature = 0): string {
  if (curvature === 0) {
    const dx = tx-sx, dy = ty-sy, len = Math.sqrt(dx*dx+dy*dy)||1
    return `M${sx},${sy} L${tx-dx/len*(tr+5)},${ty-dy/len*(tr+5)}`
  }
  const mx=(sx+tx)/2, my=(sy+ty)/2, dx=tx-sx, dy=ty-sy, len=Math.sqrt(dx*dx+dy*dy)||1
  const cpx=mx-(dy/len)*curvature, cpy=my+(dx/len)*curvature
  const etx=tx-(tx-cpx)/Math.sqrt((tx-cpx)**2+(ty-cpy)**2)*(tr+5)
  const ety=ty-(ty-cpy)/Math.sqrt((tx-cpx)**2+(ty-cpy)**2)*(tr+5)
  return `M${sx},${sy} Q${cpx},${cpy} ${etx},${ety}`
}
function bezierMid(sx: number, sy: number, tx: number, ty: number, curvature = 0): [number, number] {
  if (curvature === 0) return [(sx+tx)/2, (sy+ty)/2]
  const mx=(sx+tx)/2, my=(sy+ty)/2, dx=tx-sx, dy=ty-sy, len=Math.sqrt(dx*dx+dy*dy)||1
  const cpx=mx-(dy/len)*curvature, cpy=my+(dx/len)*curvature
  return [0.25*sx+0.5*cpx+0.25*tx, 0.25*sy+0.5*cpy+0.25*ty]
}

// ── Connectivity algorithms ──────────────────────────────────────────────────
/**
 * Build undirected adjacency list for BFS-based algorithms.
 *
 * Excluded predicates:  edges whose predicateFull is in this set are skipped.
 * excludeTypeArcs:      when true, rdf:type edges are also skipped (regardless
 *                       of whether RDF_TYPE appears in excludedPredicates).
 *
 * Note: literal-object edges are already absent from allEdges (graph-store only
 * creates GraphEdge entries for NamedNode objects), so "scalar arcs" need no
 * special handling here — they simply don't exist in the edge list.
 */
function buildAdjacency(
  edges:            GraphEdge[],
  excludedPredicates: Set<string>,
  excludeTypeArcs:  boolean,
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>()
  for (const e of edges) {
    if (excludedPredicates.has(e.predicateFull)) continue
    if (excludeTypeArcs && e.predicateFull === RDF_TYPE) continue
    const s = getNodeId(e.source), t = getNodeId(e.target)
    if (!adj.has(s)) adj.set(s, new Set())
    if (!adj.has(t)) adj.set(t, new Set())
    adj.get(s)!.add(t)
    adj.get(t)!.add(s)
  }
  return adj
}

function reachable(startId: string, adj: Map<string, Set<string>>): Set<string> {
  const visited = new Set([startId])
  const queue   = [startId]
  while (queue.length) {
    const cur = queue.shift()!
    for (const nb of adj.get(cur) ?? []) {
      if (!visited.has(nb)) { visited.add(nb); queue.push(nb) }
    }
  }
  return visited
}

function shortestPath(startId: string, endId: string, adj: Map<string, Set<string>>): string[] | null {
  if (startId === endId) return [startId]
  const prev = new Map<string, string>([[startId, '']])
  const queue = [startId]
  while (queue.length) {
    const cur = queue.shift()!
    for (const nb of adj.get(cur) ?? []) {
      if (!prev.has(nb)) {
        prev.set(nb, cur)
        if (nb === endId) {
          const path: string[] = []
          let node: string | undefined = endId
          while (node) { path.unshift(node); node = prev.get(node) || undefined }
          return path
        }
        queue.push(nb)
      }
    }
  }
  return null
}

// ── GraphView class ──────────────────────────────────────────────────────────
export class GraphView {
  private svg!:         d3.Selection<SVGSVGElement, unknown, null, undefined>
  private g!:           d3.Selection<SVGGElement,   unknown, null, undefined>
  private hullG!:       d3.Selection<SVGGElement,   unknown, null, undefined>
  private edgeG!:       d3.Selection<SVGGElement,   unknown, null, undefined>
  private edgeLabelG!:  d3.Selection<SVGGElement,   unknown, null, undefined>
  private nodeG!:       d3.Selection<SVGGElement,   unknown, null, undefined>
  private labelG!:      d3.Selection<SVGGElement,   unknown, null, undefined>
  private sim!:         d3.Simulation<GraphNode, GraphEdge>
  private zoom!:        d3.ZoomBehavior<SVGSVGElement, unknown>

  private allNodes:     GraphNode[] = []
  private allEdges:     GraphEdge[] = []
  private expandedIds   = new Set<string>()
  private pinnedIds     = new Set<string>()
  private filterRegex:  RegExp | null = null
  private spotlight     = ''
  private groupBy       = 'type'
  private opts:         GraphViewOptions
  private edgeCurvature = new Map<string, number>()
  /** Lazily resolved label function: falls back to node.label / predicate. */
  private labelFn: (iri: string) => string = (iri) => iri

  // ── Per-predicate exclusion (arc-filter dropdown) ──────────────────────────
  // Full IRIs of predicates hidden from the rendered graph.
  // Does NOT affect connectivity algorithms — that is controlled by the flags below.
  private excludedPredicates = new Set<string>()

  // ── Display flags ──────────────────────────────────────────────────────────
  /** When true: rdf:type edges hidden; nodes referenced only by rdf:type hidden. */
  private hideTypeArcs   = true
  /** When true: edges to literal values are hidden (scalars shown in tooltip instead). */
  private hideScalarArcs = true

  // ── Connectivity flags ─────────────────────────────────────────────────────
  /** When false: rdf:type edges are ignored in graph algorithms. */
  private typeArcsInConnectivity   = false
  /** When false: literal-object edges are ignored in graph algorithms.
   *  Currently a no-op because literal objects are not graph nodes, but kept
   *  for when scalar edges are materialised in future. */
  private scalarArcsInConnectivity = false

  // ── Highlight / pick / context menu ───────────────────────────────────────
  private highlightedIds = new Set<string>()
  private highlightColor = '#f59e0b'
  private pickMode:    null | { fromId: string; resolve: (id: string | null) => void } = null
  private contextMenu: HTMLElement | null = null

  constructor(opts: GraphViewOptions) {
    this.opts    = opts
    this.labelFn = opts.labelFn ?? ((iri) => iri)
    this.init()
    this.restoreHistory()
  }

  /** Update the label function and re-render. */
  setLabelFn(fn: (iri: string) => string): void {
    this.labelFn = fn
    this.render()
  }

  /** Re-render in place (without restarting the simulation) after TYPE_COLORS change. */
  refreshColors(): void { this.render() }

  private get W() { return this.opts.container.clientWidth  || 900 }
  private get H() { return this.opts.container.clientHeight || 650 }
  private toast(msg: string, type: 'info' | 'success' | 'error' = 'info') { this.opts.onToast?.(msg, type) }

  // ── Init SVG ────────────────────────────────────────────────────────────────
  private init(): void {
    this.svg = d3.select(this.opts.container).append('svg').attr('width','100%').attr('height','100%')
    const defs = this.svg.append('defs')

    defs.append('marker').attr('id','arr').attr('viewBox','0 -5 10 10')
      .attr('refX',10).attr('refY',0).attr('markerWidth',8).attr('markerHeight',8).attr('orient','auto')
      .append('path').attr('d','M0,-5L10,0L0,5Z').attr('fill',ARROW_FILL)

    const addGlow = (id: string, color: string) => {
      const f = defs.append('filter').attr('id', id)
        .attr('x','-50%').attr('y','-50%').attr('width','200%').attr('height','200%')
      f.append('feGaussianBlur').attr('in','SourceGraphic').attr('stdDeviation','4').attr('result','blur')
      f.append('feColorMatrix').attr('in','blur').attr('type','matrix').attr('values', color).attr('result','glow')
      const m = f.append('feMerge'); m.append('feMergeNode').attr('in','glow'); m.append('feMergeNode').attr('in','SourceGraphic')
    }
    addGlow('pin-glow',       '0 0 0 0 1  0 0 0 0 0.8  0 0 0 0 0  0 0 0 1.5 0')
    addGlow('highlight-glow', '0 0 0 0 1  0 0 0 0 0.6  0 0 0 0 0  0 0 0 2 0')

    this.zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.01,12])
      .on('zoom', e => this.g.attr('transform', e.transform.toString()))
    this.svg.call(this.zoom).on('dblclick.zoom', null)
    this.svg.on('click.ctx', () => this.dismissContextMenu())

    this.g          = this.svg.append('g')
    this.hullG      = this.g.append('g').attr('class','hulls')
    this.edgeG      = this.g.append('g').attr('class','edges')
    this.edgeLabelG = this.g.append('g').attr('class','edge-labels')
    this.nodeG      = this.g.append('g').attr('class','nodes')
    this.labelG     = this.g.append('g').attr('class','labels')

    this.sim = d3.forceSimulation<GraphNode, GraphEdge>()
      .force('charge',    d3.forceManyBody<GraphNode>().strength(-160).distanceMax(400))
      .force('collision', d3.forceCollide<GraphNode>().radius(d => nodeRadius(d)+10))
      .force('center',    d3.forceCenter(this.W/2, this.H/2))
      .force('x',         d3.forceX<GraphNode>(this.W/2).strength(0.025))
      .force('y',         d3.forceY<GraphNode>(this.H/2).strength(0.025))
      .alphaDecay(0.018)
  }

  private restoreHistory(): void {
    const vs = readHistory()
    if (vs.regex) { try { this.filterRegex = new RegExp(vs.regex,'i') } catch { /**/ } }
    this.pinnedIds   = new Set(vs.pinned)
    this.expandedIds = new Set(vs.expanded)
    this.groupBy     = vs.group ?? 'type'
  }

  // ── Public flag accessors ──────────────────────────────────────────────────

  // Display: type arcs
  getHideTypeArcs(): boolean  { return this.hideTypeArcs }
  setHideTypeArcs(v: boolean) { this.hideTypeArcs = v; this.render() }
  toggleHideTypeArcs(): boolean { this.hideTypeArcs = !this.hideTypeArcs; this.render(); return this.hideTypeArcs }

  // Display: scalar arcs
  getHideScalarArcs(): boolean  { return this.hideScalarArcs }
  setHideScalarArcs(v: boolean) { this.hideScalarArcs = v; this.render() }
  toggleHideScalarArcs(): boolean { this.hideScalarArcs = !this.hideScalarArcs; this.render(); return this.hideScalarArcs }

  // Connectivity: type arcs
  getTypeArcsInConnectivity(): boolean  { return this.typeArcsInConnectivity }
  setTypeArcsInConnectivity(v: boolean) { this.typeArcsInConnectivity = v }
  toggleTypeArcsInConnectivity(): boolean { this.typeArcsInConnectivity = !this.typeArcsInConnectivity; return this.typeArcsInConnectivity }

  // Connectivity: scalar arcs
  getScalarArcsInConnectivity(): boolean  { return this.scalarArcsInConnectivity }
  setScalarArcsInConnectivity(v: boolean) { this.scalarArcsInConnectivity = v }
  toggleScalarArcsInConnectivity(): boolean { this.scalarArcsInConnectivity = !this.scalarArcsInConnectivity; return this.scalarArcsInConnectivity }

  // Per-predicate exclusion (arc-filter dropdown)
  setExcludedPredicates(set: Set<string>) { this.excludedPredicates = new Set(set); this.render() }
  getExcludedPredicates(): Set<string>    { return new Set(this.excludedPredicates) }
  togglePredicate(full: string): boolean {
    if (this.excludedPredicates.has(full)) { this.excludedPredicates.delete(full); this.render(); return false }
    this.excludedPredicates.add(full); this.render(); return true
  }
  isExcluded(full: string): boolean { return this.excludedPredicates.has(full) }

  // Highlight
  setHighlighted(ids: Set<string>) { this.highlightedIds = ids; this.render() }
  clearHighlighted()               { this.highlightedIds.clear(); this.render() }

  // ── Algorithm API ──────────────────────────────────────────────────────────
  private makeAdj(): Map<string, Set<string>> {
    return buildAdjacency(
      this.allEdges,
      this.excludedPredicates,
      !this.typeArcsInConnectivity,
    )
  }

  findDisconnected(startId: string): Set<string> {
    const connected = reachable(startId, this.makeAdj())
    return new Set(this.allNodes.map(n => n.id).filter(id => !connected.has(id)))
  }

  findShortestPath(startId: string, endId: string): string[] | null {
    return shortestPath(startId, endId, this.makeAdj())
  }

  // ── Context menu ───────────────────────────────────────────────────────────
  private dismissContextMenu(): void {
    this.contextMenu?.remove(); this.contextMenu = null
    if (this.pickMode) {
      this.pickMode.resolve(null); this.pickMode = null
      this.opts.container.style.cursor = ''
      this.toast('Path search cancelled', 'info')
    }
  }

  private showContextMenu(node: GraphNode, sx: number, sy: number): void {
    this.dismissContextMenu()
    const menu = document.createElement('div')
    menu.className = 'graph-context-menu'
    menu.style.cssText = `position:absolute;left:${sx}px;top:${sy}px;background:var(--bg-card,#1e293b);border:1px solid var(--border,#334155);border-radius:6px;padding:4px 0;min-width:230px;font-family:var(--font-mono,monospace);font-size:11px;z-index:200;box-shadow:0 8px 24px rgba(0,0,0,0.4);`

    const item = (label: string, fn: () => void) => {
      const el = document.createElement('div')
      el.style.cssText = 'padding:7px 14px;cursor:pointer;color:var(--text-primary,#e2e8f0);'
      el.textContent = label
      el.addEventListener('mouseenter', () => el.style.background='var(--accent-teal,#14b8a6)22')
      el.addEventListener('mouseleave', () => el.style.background='')
      el.addEventListener('click', e => { e.stopPropagation(); this.dismissContextMenu(); fn() })
      return el
    }
    const sep = () => { const el = document.createElement('div'); el.style.cssText='height:1px;background:var(--border,#334155);margin:4px 0;'; return el }

    menu.append(
      item(`Find disconnected from "${node.label}"`, () => {
        const disc = this.findDisconnected(node.id)
        if (!disc.size) { this.toast('All nodes connected to this node','info'); return }
        this.setHighlighted(disc)
        this.toast(`${disc.size} node(s) not connected to "${node.label}"`, 'info')
      }),
      item(`Shortest path from "${node.label}"…`, () => {
        this.toast('Click the destination node','info')
        this.opts.container.style.cursor = 'crosshair'
        this.pickMode = {
          fromId: node.id,
          resolve: endId => {
            this.opts.container.style.cursor = ''; this.pickMode = null
            if (!endId || endId === node.id) return
            const path = this.findShortestPath(node.id, endId)
            if (!path) { this.toast(`No path found`,'info'); this.clearHighlighted() }
            else { this.setHighlighted(new Set(path)); this.toast(`Shortest path: ${path.length} node(s)`,'success') }
          },
        }
      }),
      sep(),
      item('Clear highlights', () => this.clearHighlighted()),
    )

    this.opts.container.appendChild(menu)
    this.contextMenu = menu
    requestAnimationFrame(() => {
      const cr = this.opts.container.getBoundingClientRect(), mr = menu.getBoundingClientRect()
      if (mr.right  > cr.right)  menu.style.left = `${sx-(mr.right-cr.right)}px`
      if (mr.bottom > cr.bottom) menu.style.top  = `${sy-(mr.bottom-cr.bottom)}px`
    })
  }

  // ── Curvature ──────────────────────────────────────────────────────────────
  private computeCurvatures(edges: GraphEdge[]): void {
    this.edgeCurvature.clear()
    const cnt = new Map<string, number>()
    for (const e of edges) {
      const a=getNodeId(e.source), b=getNodeId(e.target), k=a<b?`${a}\x00${b}`:`${b}\x00${a}`
      cnt.set(k, (cnt.get(k)??0)+1)
    }
    const idx = new Map<string, number>()
    for (const e of edges) {
      const a=getNodeId(e.source), b=getNodeId(e.target), k=a<b?`${a}\x00${b}`:`${b}\x00${a}`
      const total=cnt.get(k)??1
      if (total<=1) { this.edgeCurvature.set(e.id,0); continue }
      const i=idx.get(k)??0; idx.set(k,i+1)
      this.edgeCurvature.set(e.id, (i%2===0?1:-1)*30*(Math.floor(i/2)+1))
    }
  }

  // ── Public load/filter API ─────────────────────────────────────────────────
  load(data: GraphData): void {
    this.allNodes = data.nodes.map(n => ({
      ...n,
      pinned:   this.pinnedIds.has(n.id),
      expanded: this.expandedIds.has(n.id),
      fx: this.pinnedIds.has(n.id) ? (n.fx??null) : null,
      fy: this.pinnedIds.has(n.id) ? (n.fy??null) : null,
    }))
    this.allEdges = data.edges
    this.highlightedIds.clear()
    this.render()
  }

  setFilter(regex: string | null): void {
    try { this.filterRegex = regex ? new RegExp(regex,'i') : null } catch { this.filterRegex=null }
    this.render(); this.saveHistory()
  }
  setSpotlight(term: string): void { this.spotlight=term.toLowerCase(); this.render() }
  setGroupBy(field: string): void  { this.groupBy=field; this.render(); this.saveHistory() }

  toggleExpand(nodeId: string): boolean {
    const node=this.allNodes.find(n=>n.id===nodeId); if (!node) return false
    node.expanded=!node.expanded
    if (node.expanded) this.expandedIds.add(nodeId); else this.expandedIds.delete(nodeId)
    this.render(); this.saveHistory(); return node.expanded
  }

  // ── Visibility ─────────────────────────────────────────────────────────────
  /**
   * Compute the set of node IDs that are referenced ONLY by rdf:type edges
   * (among the full allEdges set).  When hideTypeArcs is on, these nodes are
   * visually orphaned and should be hidden too.
   */
  private typeOnlyNodeIds(): Set<string> {
    if (!this.hideTypeArcs) return new Set()
    // A node is "type-only" if it appears only as the TARGET of rdf:type edges
    // and has no IRI-to-IRI (non-type, non-scalar) edges in either direction.
    // Scalar edges are excluded from this test because a vocabulary class node
    // (e.g. ex:ProcessGroup) may have rdfs:label literals while still being
    // referenced only as a type target — we don't want those literal properties
    // to "rescue" it from being hidden.
    const hasIriEdge = new Set<string>()
    for (const e of this.allEdges) {
      if (e.predicateFull !== RDF_TYPE && !e.isScalar) {
        hasIriEdge.add(getNodeId(e.target))
        hasIriEdge.add(getNodeId(e.source))
      }
    }
    const typeOnlyTargets = new Set<string>()
    for (const e of this.allEdges) {
      const t = getNodeId(e.target)
      if (e.predicateFull === RDF_TYPE && !hasIriEdge.has(t)) {
        typeOnlyTargets.add(t)
      }
    }
    return typeOnlyTargets
  }

  private visibleNodes(): GraphNode[] {
    const typeOnly = this.typeOnlyNodeIds()
    let nodes = this.allNodes.filter(n => {
      if (typeOnly.has(n.id)) return false
      if (this.hideScalarArcs && n.types[0] === '__literal__') return false
      return true
    })

    if (!this.filterRegex) return nodes
    const matched = new Set(
      nodes.filter(n =>
        this.filterRegex!.test(n.label) || this.filterRegex!.test(n.id) ||
        n.types.some(t => this.filterRegex!.test(t))
      ).map(n => n.id)
    )
    // (expandedIds neighbour expansion removed — all nodes are always visible)
    return nodes.filter(n => matched.has(n.id))
  }

  private visibleEdges(ids: Set<string>): GraphEdge[] {
    return this.allEdges.filter(e => {
      const s=getNodeId(e.source), t=getNodeId(e.target)
      if (!ids.has(s) || !ids.has(t)) return false
      if (this.hideTypeArcs   && e.predicateFull === RDF_TYPE) return false
      if (this.hideScalarArcs && e.isScalar)                   return false
      if (this.excludedPredicates.has(e.predicateFull))        return false
      return true
    })
  }

  // ── Tooltip text ───────────────────────────────────────────────────────────
  private nodeTooltip(d: GraphNode): string {
    const lines = [
      d.label,
      `type: ${d.types.map(t => this.labelFn(t)).join(', ') || 'none'}`,
      `IRI:  ${d.id}`,
    ]
    if (this.hideScalarArcs && d.scalars.length > 0) {
      lines.push('')
      lines.push('── scalar properties ──')
      for (const { predicate, value } of d.scalars) {
        const val = value.length > 80 ? value.slice(0, 77) + '…' : value
        lines.push(`${predicate}: ${val}`)
      }
    }
    return lines.join('\n')
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  private render(): void {
    const vNodes = this.visibleNodes()
    const vIds   = new Set(vNodes.map(n => n.id))
    const vEdges = this.visibleEdges(vIds)
    this.computeCurvatures(vEdges)

    // ── Hulls ────────────────────────────────────────────────────────────────
    if (this.groupBy !== 'none') {
      const groups = new Map<string, GraphNode[]>()
      for (const n of vNodes) { const k=getGroupKey(n,this.groupBy); if(!groups.has(k)) groups.set(k,[]); groups.get(k)!.push(n) }
      const hullData = [...groups.entries()].filter(([,ns])=>ns.length>=2).map(([key,nodes])=>({key,nodes}))
      const hSel = this.hullG.selectAll<SVGPathElement,{key:string;nodes:GraphNode[]}>('path').data(hullData,d=>d.key)
      hSel.exit().remove()
      hSel.enter().append('path')
        .attr('fill',d=>HULL_FILLS[d.key]??HULL_FILLS.default)
        .attr('stroke',d=>(TYPE_COLORS[d.key]??TYPE_COLORS.default)+'44')
        .attr('stroke-width',1.5).attr('stroke-dasharray','4 3').attr('pointer-events','none')
    } else { this.hullG.selectAll('path').remove() }

    // ── Edges ────────────────────────────────────────────────────────────────
    const eSel = this.edgeG.selectAll<SVGPathElement,GraphEdge>('path.edge').data(vEdges,d=>d.id)
    eSel.exit().remove()
    eSel.enter().append('path').attr('class','edge').attr('fill','none')
      .attr('stroke',      d => d.isScalar ? '#475569' : EDGE_COLOR)
      .attr('stroke-width',d => d.isScalar ? 1 : 1.5)
      .attr('stroke-dasharray', d => d.isScalar ? '3 3' : 'none')
      .attr('marker-end',  d => d.isScalar ? 'none' : 'url(#arr)')
      .attr('opacity',     d => d.isScalar ? 0.45 : 0.75)
      .append('title').text(d=>d.predicateFull)

    // ── Edge labels ──────────────────────────────────────────────────────────
    const elSel = this.edgeLabelG.selectAll<SVGTextElement,GraphEdge>('text.edge-label').data(vEdges,d=>d.id)
    elSel.exit().remove()
    elSel.enter().append('text').attr('class','edge-label')
      .attr('font-family',"'JetBrains Mono', monospace").attr('font-size','8px')
      .attr('fill','#94a3b8').attr('text-anchor','middle').attr('pointer-events','none')
      .attr('paint-order','stroke').attr('stroke','#0f172a').attr('stroke-width','2px')
      .text(d=>truncate(d.predicate,16)).append('title').text(d=>d.predicateFull)

    // ── Nodes ────────────────────────────────────────────────────────────────
    const isLiteral = (n: GraphNode) => n.types[0] === '__literal__'
    const regNodes = vNodes.filter(n => !isLiteral(n))
    const litNodes = vNodes.filter(isLiteral)

    const nSel = this.nodeG.selectAll<SVGCircleElement,GraphNode>('circle').data(regNodes,d=>d.id)
    nSel.exit().remove()
    const nEnter = nSel.enter().append('circle').attr('cursor','pointer')
      .call(d3.drag<SVGCircleElement,GraphNode>()
        .on('start',(ev,d)=>{ if(!ev.active) this.sim.alphaTarget(0.3).restart(); d.fx=d.x??0; d.fy=d.y??0 })
        .on('drag', (ev,d)=>{ d.fx=ev.x; d.fy=ev.y })
        .on('end',  (ev,d)=>{ if(!ev.active) this.sim.alphaTarget(0); if(!d.pinned){d.fx=null;d.fy=null} }))
      .on('click',       (_ev,d)=>this.handleClick(d))
      .on('contextmenu', (ev,d)=>{ ev.preventDefault(); ev.stopPropagation(); this.handleContextMenu(ev,d) })
      .on('wheel',       (ev,d)=>this.handleWheel(ev,d), {passive:false} as EventListenerOptions)

    // Tooltip: static title is updated via select().select('title') below
    nEnter.append('title')

    const nAll = nEnter.merge(nSel)
    nAll
      .attr('r',            d=>nodeRadius(d))
      .attr('fill',         d=>this.highlightedIds.has(d.id)?this.highlightColor:nodeColor(d))
      .attr('stroke',       d=>d.pinned?'#fbbf24':this.highlightedIds.has(d.id)?this.highlightColor:'#1e293b')
      .attr('stroke-width', d=>d.pinned||this.highlightedIds.has(d.id)?3:1.5)
      .attr('filter',       d=>d.pinned?'url(#pin-glow)':this.highlightedIds.has(d.id)?'url(#highlight-glow)':'none')
      .attr('opacity',      d=>{
        if (this.highlightedIds.size>0 && !this.highlightedIds.has(d.id)) return 0.25
        if (!this.spotlight) return 1
        return this.labelFn(d.id).toLowerCase().includes(this.spotlight)||d.label.toLowerCase().includes(this.spotlight)||d.id.toLowerCase().includes(this.spotlight)?1:0.12
      })
    // Update tooltip text on every render (hideScalarArcs may have changed)
    nAll.select<SVGTitleElement>('title').text(d => this.nodeTooltip(d))

    // ── Literal value nodes (rect) ──────────────────────────────────────────
    const rSel = this.nodeG.selectAll<SVGRectElement,GraphNode>('rect.lit-node').data(litNodes,d=>d.id)
    rSel.exit().remove()
    rSel.enter().append('rect').attr('class','lit-node')
      .attr('width',56).attr('height',14).attr('rx',2)
      .attr('fill','#1e293b').attr('stroke','#475569').attr('stroke-width',1)
      .attr('cursor','default').attr('opacity',0.8)
      .append('title').text(d=>d.label)

    // ── Node labels ──────────────────────────────────────────────────────────
    // Labels are shown on all visible nodes.  The spotlight and highlight
    // conditions are kept so those nodes are always labelled even if the
    // general label display were ever made conditional again.
    const showLabel = (_n: GraphNode) => true
    const lSel   = this.labelG.selectAll<SVGTextElement,GraphNode>('text').data(regNodes.filter(showLabel),d=>d.id)
    lSel.exit().remove()
    const lEnter = lSel.enter().append('text')
      .attr('font-family',"'JetBrains Mono', monospace").attr('font-size','10px')
      .attr('fill','#e2e8f0').attr('paint-order','stroke').attr('stroke','#0f172a')
      .attr('stroke-width','3px').attr('pointer-events','none')
    // text must be on the merged selection so it updates on every render
    // (enter-only text would keep stale labels after a labelFn change)
    lEnter.merge(lSel).text(d=>truncate(this.labelFn(d.id),28))

    // ── Simulation ───────────────────────────────────────────────────────────
    this.sim.nodes(vNodes)
    let link = this.sim.force<d3.ForceLink<GraphNode,GraphEdge>>('link')
    if (!link) { link=d3.forceLink<GraphNode,GraphEdge>().id(d=>d.id).distance(90).strength(0.35); this.sim.force('link',link) }
    link.links(vEdges)
    if (this.groupBy!=='none') {
      this.sim.force('groupX',d3.forceX<GraphNode>(d=>this.groupCentroid(getGroupKey(d,this.groupBy),vNodes).x).strength(0.04))
      this.sim.force('groupY',d3.forceY<GraphNode>(d=>this.groupCentroid(getGroupKey(d,this.groupBy),vNodes).y).strength(0.04))
    } else { this.sim.force('groupX',null).force('groupY',null) }

    this.sim.on('tick', () => {
      const rm=new Map<string,number>(); this.allNodes.forEach(n=>rm.set(n.id,nodeRadius(n)))
      this.edgeG.selectAll<SVGPathElement,GraphEdge>('path.edge').attr('d',d=>
        edgePath(getNodeX(d.source),getNodeY(d.source),getNodeX(d.target),getNodeY(d.target),rm.get(getNodeId(d.target))??8,this.edgeCurvature.get(d.id)??0))
      this.edgeLabelG.selectAll<SVGTextElement,GraphEdge>('text.edge-label')
        .attr('x',d=>bezierMid(getNodeX(d.source),getNodeY(d.source),getNodeX(d.target),getNodeY(d.target),this.edgeCurvature.get(d.id)??0)[0])
        .attr('y',d=>bezierMid(getNodeX(d.source),getNodeY(d.source),getNodeX(d.target),getNodeY(d.target),this.edgeCurvature.get(d.id)??0)[1]-2)
      this.nodeG.selectAll<SVGCircleElement,GraphNode>('circle').attr('cx',d=>d.x??0).attr('cy',d=>d.y??0)
      this.nodeG.selectAll<SVGRectElement,GraphNode>('rect.lit-node').attr('x',d=>(d.x??0)-28).attr('y',d=>(d.y??0)-7)
      this.labelG.selectAll<SVGTextElement,GraphNode>('text').attr('x',d=>(d.x??0)+15).attr('y',d=>(d.y??0)+4)
      if (this.groupBy!=='none')
        this.hullG.selectAll<SVGPathElement,{key:string;nodes:GraphNode[]}>('path')
          .attr('d',d=>hullPath(d.nodes.map(n=>[n.x??0,n.y??0])))
    })
    this.sim.alpha(0.3).restart()
  }

  private _gc: Map<string,{x:number;y:number}> = new Map()
  private groupCentroid(key: string, nodes: GraphNode[]): {x:number;y:number} {
    const g=nodes.filter(n=>getGroupKey(n,this.groupBy)===key)
    if (!g.length) return {x:this.W/2,y:this.H/2}
    if (g.some(n=>n.x!=null)) {
      const cx=g.reduce((s,n)=>s+(n.x??0),0)/g.length, cy=g.reduce((s,n)=>s+(n.y??0),0)/g.length
      this._gc.set(key,{x:cx,y:cy}); return {x:cx,y:cy}
    }
    return this._gc.get(key)??{x:this.W/2,y:this.H/2}
  }

  // ── Interaction ─────────────────────────────────────────────────────────────
  private handleClick(d: GraphNode): void {
    if (this.pickMode) { const {resolve}=this.pickMode; this.pickMode=null; this.opts.container.style.cursor=''; resolve(d.id); return }
    d.pinned=!d.pinned
    if (d.pinned) { this.pinnedIds.add(d.id); d.fx=d.x??null; d.fy=d.y??null }
    else          { this.pinnedIds.delete(d.id); d.fx=null; d.fy=null }
    this.opts.onNodeClick?.(d); this.render(); this.saveHistory()
  }

  private handleContextMenu(ev: MouseEvent, d: GraphNode): void {
    const cr=this.opts.container.getBoundingClientRect()
    this.showContextMenu(d, ev.clientX-cr.left, ev.clientY-cr.top)
  }

  private handleWheel(ev: WheelEvent, d: GraphNode): void {
    ev.preventDefault(); ev.stopPropagation()
    d.expanded=ev.deltaY<0
    if (d.expanded) this.expandedIds.add(d.id); else this.expandedIds.delete(d.id)
    this.render(); this.saveHistory()
  }

  private saveHistory(): void {
    pushHistory({...readHistory(), pinned:[...this.pinnedIds], expanded:[...this.expandedIds], group:this.groupBy})
  }

  scrollToNode(id: string): void {
    const n=this.allNodes.find(n=>n.id===id); if (!n||n.x==null||n.y==null) return
    this.svg.transition().duration(600).call(this.zoom.transform, d3.zoomIdentity.translate(this.W/2-n.x,this.H/2-n.y).scale(1.2))
  }

  fitAll(): void {
    const nodes=this.allNodes.filter(n=>n.x!=null); if (!nodes.length) return
    const xs=nodes.map(n=>n.x!), ys=nodes.map(n=>n.y!)
    const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),pad=60
    const scale=Math.min(0.95,(this.W-pad*2)/(x1-x0+1),(this.H-pad*2)/(y1-y0+1))
    this.svg.transition().duration(700).call(this.zoom.transform,
      d3.zoomIdentity.translate(this.W/2-scale*(x0+x1)/2,this.H/2-scale*(y0+y1)/2).scale(scale))
  }

  destroy(): void { this.sim.stop(); this.svg.remove() }
}
