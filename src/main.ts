/**
 * RDF Explorer – Main entry point
 *
 * Design principles for loaders:
 *  • Each DataLoader owns its own panel DOM (via buildPanel).
 *  • Loaders call onTurtleChanged(turtle) whenever their output changes.
 *  • main.ts knows nothing about vocab toggles or parser-internal state.
 *
 * load-title accepts:
 *  • .js / .mjs  — register as a new loader
 *  • .ttl / .n3  — load Turtle directly (replace, or augment if Ctrl held)
 *
 * Ctrl+PgUp/Dn works in all panes including CodeMirror (turtle/shex).
 */
import './styles/main.css'
import { parseTurtleToGraph, readHistory, pushHistory } from './lib/graph-store'
import { buildN3Store, runSparqlSelect }                from './lib/sparql-runner'
import { generateShEx, EX as EX_ns }                   from './lib/shex-validator'
import { assignTypeColors }                             from './lib/color-scheme'
import { buildRenderConfigJsonLd, parseRenderConfigJsonLd } from './lib/render-config-jsonld'
import { diffTurtle, renderDiffHtml }                  from './lib/diff'
import { GraphView, TYPE_COLORS, TYPE_RADII, HULL_FILLS } from './components/graph-view'
import { TurtleEditor }                                from './components/turtle-editor'
import { ShExEditor }                                  from './components/shex-editor'
import { ShExWorkerClient }                            from './lib/shex-worker-client'
import { getLoaders, loadLoaderFromBlob, onLoadersChange } from './lib/parser-registry'
import { buildLoaderPanels }                           from './lib/loader-panels'
import type { DataLoader, ParseResult }                from './lib/parser-api'
import { inferTypes }                                  from './lib/type-inference'
import type { GraphNode, GraphData }                   from './lib/graph-store'
import * as N3                                         from 'n3'
import { labelIri, LABEL_MODES, LABEL_MODE_NAMES, SEGMENT_SEP,
         type LabelMode }                              from './lib/label-mode'

// ── Dev: pre-register loaders.  Remove for production. ───────────────────────
import { registerDevLoaders } from './lib/loader-config'
registerDevLoaders()

// ── Preference constants ────────────────────────────────────────────────────
// These will eventually be exposed in a preferences pane.  For now they are
// hard-coded constants; change them here to adjust default behaviour.

/** When true, all loaders that implement setBaseIri() are re-run automatically
 *  whenever the user changes the base IRI input in the header. */
const PREF_RERUN_ON_BASE_CHANGE = true

/** When true, the current active pane is re-rendered (graph labels rebuilt,
 *  validation node labels refreshed) whenever the label mode button is cycled. */
const PREF_RELABEL_ON_MODE_CHANGE = true

/** Default base IRI used for relative-IRI resolution.  Parsers use this as
 *  the @base declaration in their Turtle output. */
// Default base IRI: the service origin + '/' so that relative IRIs resolve
// to the same host the app is served from.  Evaluated at runtime so it
// works on any port (dev: localhost:5173, prod: your deployment URL).
const PREF_DEFAULT_BASE_IRI = window.location.origin + '/upload/'

// Validation marks as inline SVG — no font dependency whatsoever.
// Renders identically on every platform and browser.
// pass = checkmark, fail = cross, test = middle dot
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


// ── HTML skeleton ─────────────────────────────────────────────────────────────
document.querySelector('#app')!.innerHTML = `
<div class="header">
  <div class="header-logo">RDF<span>/</span>Explorer</div>
  <div class="header-sep"></div>
  <div class="cache-badge" id="cache-badge"><div class="dot"></div><span id="cache-info">no file loaded</span></div>
  <input class="base-iri-input" id="base-iri-input"
         title="Base IRI for relative-IRI resolution (@base in Turtle output)"
         spellcheck="false" />
  <div class="header-spacer"></div>
  <button class="icon-btn" id="btn-label-mode" title="Cycle label display mode">&#x2113;</button>
  <button class="icon-btn" id="btn-download"  title="Download Turtle (Alt+D)" style="display:none">&#x2B07;</button>
  <button class="icon-btn" id="btn-theme"     title="Toggle dark/light mode">&#x25D1;</button>
  <button class="icon-btn" id="btn-shortcuts" title="Keyboard shortcuts (?)">&#x2328;</button>
</div>

<div class="layout">
  <aside class="sidebar">

    <div class="sidebar-section">
      <div class="sidebar-section-title load-title" id="load-title"
           title="Drop a .js loader or .ttl Turtle file here. Ctrl+drop augments.">
        Load
        <span class="load-title-hint">&#x2295; .js loader or .ttl Turtle</span>
      </div>
      <div id="loader-panels"></div>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-section-title">Filter / Spotlight</div>
      <div class="input-group">
        <label class="input-label">Regex filter (nodes shown)</label>
        <input class="input" id="regex-input" placeholder="e.g. Film.*SUT|Logan" spellcheck="false"/>
        <div class="input-hint" id="regex-hint"></div>
      </div>
      <div class="input-group">
        <label class="input-label">Spotlight (dim others)</label>
        <input class="input" id="spotlight-input" placeholder="search labels&hellip;"/>
      </div>
    </div>

    <div class="sidebar-section">
      <div class="sidebar-section-title">Group by</div>
      <select class="input" id="group-select">
        <option value="type">RDF type</option>
        <option value="namespace">Namespace</option>
        <option value="none">None</option>
      </select>
    </div>

    <div class="sidebar-section" id="stats-section" style="display:none">
      <div class="sidebar-section-title">Stats</div>
      <div id="stats-content" class="mono text-xs text-muted" style="line-height:1.9"></div>
    </div>

    <div class="sidebar-section" style="flex:1;overflow-y:auto;min-height:0;">
      <div class="sidebar-section-title flex-row" style="justify-content:space-between;align-items:center;">
        <span>Nodes <span id="node-count" class="text-muted"></span></span>
        <input class="input" id="node-filter" placeholder="filter list&hellip;"
               style="width:88px;font-size:10px;padding:2px 6px;"/>
      </div>
      <div id="node-list"></div>
    </div>
  </aside>

  <div class="main">
    <div class="tabs" id="tabs">
      <div class="tab active" data-tab="graph">Graph</div>
      <div class="tab" data-tab="turtle">Turtle</div>
      <div class="tab" data-tab="sparql">SPARQL</div>
      <div class="tab" data-tab="shex">ShEx</div>
      <div class="tab" data-tab="inference">Type Inference</div>
      <div class="tab" data-tab="diff" id="diff-tab" style="display:none">Diff</div>
    </div>

    <div class="tab-content">

      <!-- Graph -->
      <div class="pane active" data-pane="graph">
        <div class="graph-toolbar">
          <span class="text-xs mono text-muted">Scroll&#x2191; expand &middot; Scroll&#x2193; contract &middot; Click pin &middot; Drag move &middot; Right-click menu</span>
          <div class="header-spacer"></div>
          <span class="text-xs mono text-muted" id="graph-stats-inline"></span>
          <button class="icon-btn sm active" id="btn-hide-type-arcs"   title="Show rdf:type edges and type-only nodes (currently hidden)">&#x1D461; arcs</button>
          <button class="icon-btn sm"        id="btn-type-connectivity" title="Exclude rdf:type edges from connectivity (currently excluded)">&#x1D461; conn</button>
          <button class="icon-btn sm active" id="btn-hide-scalar-arcs"  title="Show scalar property edges (currently hidden; values shown in tooltip)">scalar arcs</button>
          <button class="icon-btn sm"        id="btn-scalar-connectivity" title="Include scalar arcs in connectivity (currently excluded)">scalar conn</button>
          <button class="icon-btn sm"        id="btn-arc-filter"         title="Filter which arc types are shown">arcs &#x25BE;</button>
          <button class="icon-btn sm"        id="btn-fit"                title="Fit graph to screen (Alt+G)">&#x229F;</button>
        </div>
        <div id="graph-container"></div>
        <div class="node-detail" id="node-detail">
          <div class="node-detail-header">
            <div>
              <div class="node-detail-label" id="nd-label"></div>
              <div class="node-detail-types" id="nd-types"></div>
            </div>
            <button class="icon-btn sm" id="nd-close">&#x2715;</button>
          </div>
          <div class="node-detail-body" id="nd-body"></div>
          <div class="node-detail-footer">
            <button class="btn sm" id="nd-turtle-link">&#x2192; Turtle</button>
            <button class="btn sm" id="nd-expand-btn">Expand node</button>
          </div>
        </div>
        <div class="legend" id="graph-legend">
          <div id="legend-items"></div>
          <button class="icon-btn sm" id="btn-legend-download" title="Download rendering config as JSON-LD" style="display:none;margin-top:4px;width:100%;font-size:10px">&#x2B07; JSON-LD</button>
        </div>
      </div>

      <!-- Turtle (editable) -->
      <div class="pane" data-pane="turtle">
        <div class="pane-toolbar flex-row">
          <span class="mono text-xs text-muted grow">Turtle &middot; editable &middot; changes update SPARQL &amp; ShEx</span>
          <button class="btn sm" id="btn-revert-turtle" style="display:none">&#x21BA; Revert</button>
          <button class="btn sm" id="btn-rendering-toggle" title="Show / hide rendering options">Rendering</button>
        </div>
        <div class="render-panel" id="render-panel" style="display:none"></div>
        <div id="turtle-container" class="pane-scroll-host"></div>
      </div>

      <!-- SPARQL -->
      <div class="pane" data-pane="sparql">
        <div class="sparql-pane">
          <div class="sparql-editor-wrap">
            <div class="pane-toolbar flex-row">
              <span class="mono text-xs text-muted grow">SPARQL SELECT &middot; Ctrl+Enter to run</span>
              <button class="btn sm primary" id="btn-run-sparql">&#x25B6; Run</button>
            </div>
            <textarea class="sparql-textarea" id="sparql-query" spellcheck="false">SELECT ?s ?p ?o
WHERE {
  ?s ?p ?o .
}
LIMIT 50</textarea>
          </div>
          <div class="sparql-results pane-scroll-host" id="sparql-results">
            <div class="mono text-xs text-muted" style="padding:12px">Run a query to see results.</div>
          </div>
        </div>
      </div>

      <!-- ShEx -->
      <div class="pane" data-pane="shex">
        <div class="shex-pane">
          <div class="pane-toolbar flex-row">
            <span class="mono text-xs text-muted grow">ShEx 2.0 &middot; auto-generated &middot; editable</span>
            <button class="btn sm" id="btn-gen-shex">Generate ShEx</button>
            <button class="btn sm" id="btn-pick-validation-types">Pick Types</button>
            <button class="btn sm primary" id="btn-validate-shex">Validate</button>
          </div>
          <div class="shex-split">
            <div id="shex-editor-container" class="shex-editor-host"></div>
            <div class="shex-results-wrap">
              <div class="shex-results-sticky" id="shex-results-sticky" style="display:none"></div>
              <div class="shex-results pane-scroll-host" id="shex-results">
                <div class="mono text-xs text-muted" style="padding:12px">Pick types then Validate.</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Type Inference -->
      <div class="pane" data-pane="inference">
        <div class="pane-toolbar flex-row">
          <span class="mono text-xs text-muted grow">Plain-string literals that look like typed values</span>
          <button class="btn sm primary" id="btn-run-inference">Analyse</button>
        </div>
        <ul class="inference-list pane-scroll-host" id="inference-list">
          <li style="color:var(--text-muted);font-family:var(--font-mono);font-size:11px;padding:12px;">
            Load a file then click Analyse.
          </li>
        </ul>
      </div>

      <!-- Diff -->
      <div class="pane" data-pane="diff">
        <div class="pane-toolbar flex-row">
          <span class="mono text-xs text-muted grow">Triple-level diff: previous load vs current</span>
          <span class="mono text-xs text-muted" id="diff-filenames"></span>
        </div>
        <div id="diff-content" class="diff-pane pane-scroll-host"></div>
      </div>

    </div>
  </div>
</div>

<!-- Keyboard shortcuts -->
<div class="kbd-overlay" id="kbd-overlay">
  <div class="kbd-panel">
    <div class="kbd-panel-title">Keyboard Shortcuts</div>
    ${([
      ['Scroll &#x2191; on node',  'Expand node'],
      ['Scroll &#x2193; on node',  'Contract node'],
      ['Click node',               'Pin / unpin'],
      ['Drag node',                'Reposition'],
      ['Alt+1 &hellip; 5',         'Switch tabs'],
      ['Alt+F',                    'Focus regex filter'],
      ['Alt+S',                    'Focus spotlight'],
      ['Alt+D',                    'Download Turtle'],
      ['Alt+G',                    'Fit graph to screen'],
      ['PgUp / PgDn',              'Scroll active pane'],
      ['Ctrl+PgUp / PgDn',         'Top / bottom of pane'],
      ['?',                        'This help'],
      ['Esc',                      'Close panels'],
    ] as [string,string][]).map(([k,v]) => `
      <div class="kbd-row"><span class="kbd-action">${v}</span><kbd>${k}</kbd></div>`
    ).join('')}
    <div style="margin-top:16px;text-align:right;">
      <button class="btn sm" id="kbd-close">Close</button>
    </div>
  </div>
</div>

<div class="toast-area" id="toast-area"></div>
`

// ── App state ─────────────────────────────────────────────────────────────────
let currentTurtle    = ''
let prevTurtle       = ''
let prevFilename     = ''
let currentFilename  = ''
let graphView:    GraphView    | null = null
let turtleEditor: TurtleEditor | null = null
let shexEditor:   ShExEditor   | null = null
let n3Store:      N3.Store     | null = null
let graphData:    GraphData    | null = null
let prefixes:     Record<string, string> = {}
let detailNode:   GraphNode    | null = null
let shexWorker:   ShExWorkerClient | null = null
let validationRunning = false
let selectedTypes     = new Set<string>()
let labelMode: LabelMode = 'segment'   // current IRI label display mode
// rdfs:label map: IRI → label string (populated after each parse)
let rdfsLabels = new Map<string, string>()
let baseIri    = PREF_DEFAULT_BASE_IRI

// ── Init views ────────────────────────────────────────────────────────────────
graphView    = new GraphView({
  container:   document.getElementById('graph-container')!,
  onNodeClick: showNodeDetail,
  onToast:     toast,
  labelFn:     (iri) => labelNode(iri),
})
turtleEditor = new TurtleEditor(document.getElementById('turtle-container')!, { editable: true })
turtleEditor.onChange(onTurtleEdited)
shexEditor   = new ShExEditor(document.getElementById('shex-editor-container')!)
restoreCacheBadge()
restoreTheme()

// ── Loader panels ─────────────────────────────────────────────────────────────
const loaderPanelContainer = document.getElementById('loader-panels')!

function rebuildLoaderPanels(loaders: DataLoader[]): void {
  buildLoaderPanels(loaders, loaderPanelContainer, handleTurtleFromLoader)
  // Push the current baseIri to any newly registered loader that supports it
  for (const loader of loaders) loader.setBaseIri?.(baseIri)
}

onLoadersChange(rebuildLoaderPanels)
rebuildLoaderPanels(getLoaders())

/**
 * Called by any loader whenever it has new or updated Turtle.
 * Single entry point — no loader-specific state lives in main.ts.
 * Also saves a revert snapshot for btn-revert-turtle.
 */
function handleTurtleFromLoader(turtle: string, filename?: string): void {
  if (currentTurtle) { prevTurtle = currentTurtle; prevFilename = currentFilename }
  savedTurtle     = turtle          // revert target for btn-revert-turtle
  currentTurtle   = turtle
  currentFilename = filename ?? currentFilename
  applyTurtle(turtle)
}

// ── load-title: drop target for .js loaders and .ttl Turtle ──────────────────
//
// Ctrl+drop or Ctrl+file-select augments (appends) the current graph.
// Plain drop/select replaces.

const loadTitle     = document.getElementById('load-title')!
const loadTitleInput = (() => {
  const fi = document.createElement('input')
  fi.type    = 'file'
  fi.accept  = '.js,.mjs,.ttl,.n3,.turtle,.jsonld,.json'
  fi.multiple = true
  fi.style.display = 'none'
  document.body.appendChild(fi)
  return fi
})()

loadTitle.addEventListener('click',    () => loadTitleInput.click())
loadTitle.addEventListener('dragover', e  => { e.preventDefault(); loadTitle.classList.add('load-title-drag') })
loadTitle.addEventListener('dragleave', () => loadTitle.classList.remove('load-title-drag'))
loadTitle.addEventListener('drop', async e => {
  e.preventDefault(); loadTitle.classList.remove('load-title-drag')
  const augment = e.ctrlKey
  for (const f of e.dataTransfer?.files ?? []) await handleLoadTitleFile(f, augment)
})
loadTitleInput.addEventListener('change', async e => {
  const augment = (e as MouseEvent).ctrlKey  // ctrlKey on the change event (not reliable cross-browser)
  for (const f of loadTitleInput.files ?? []) await handleLoadTitleFile(f, augment)
  loadTitleInput.value = ''
})

async function handleLoadTitleFile(file: File, augment: boolean): Promise<void> {
  const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase()

  if (ext === '.js' || ext === '.mjs' || ext === '.ts') {
    const url = URL.createObjectURL(new Blob([await file.text()], { type: 'application/javascript' }))
    try {
      const loader = await loadLoaderFromBlob(url)
      toast(`Loader registered: ${loader.name}`, 'success')
    } catch (err) {
      toastError('Loader load failed', err)
    } finally {
      URL.revokeObjectURL(url)
    }
    return
  }

  if (ext === '.jsonld' || ext === '.json-ld' || ext === '.json') {
    try {
      const cfg = parseRenderConfigJsonLd(JSON.parse(await file.text()))
      if (!cfg) { toast('Not a valid render config JSON-LD', 'error'); return }
      Object.assign(TYPE_COLORS, cfg.typeColors)
      Object.assign(TYPE_RADII,  cfg.typeRadii)
      Object.assign(HULL_FILLS,  cfg.hullFills)
      buildLegend()
      if (graphData) graphView?.refreshColors()
      if (document.getElementById('render-panel')!.style.display !== 'none') buildRenderPanel()
      toast('Render config applied', 'success')
    } catch (err) { toastError('Failed to parse JSON-LD', err) }
    return
  }

  if (ext === '.ttl' || ext === '.n3' || ext === '.turtle') {
    const turtle = await file.text()
    if (augment && currentTurtle) {
      // Append: concatenate, drop duplicate @prefix lines from the appended block
      const basePrefix = currentTurtle.match(/(@prefix[^\n]+\n)+/)?.[0] ?? ''
      const newBody = turtle.replace(/(@prefix[^\n]+\n)+/g, '')
      const merged  = currentTurtle.trimEnd() + '\n\n# augmented from ' + file.name + '\n' + newBody
      toast(`Augmented graph from ${file.name}`, 'info')
      applyTurtle(merged, file.name)
    } else {
      toast(`Loaded Turtle from ${file.name}`, 'info')
      applyTurtle(turtle, file.name)
    }
    return
  }

  toast(`Unsupported file: ${file.name}. Drop .js loaders or .ttl Turtle here.`, 'info')
}

// ── Core Turtle → graph pipeline ─────────────────────────────────────────────
async function applyTurtle(turtle: string, filename?: string): Promise<void> {
  if (prevTurtle !== currentTurtle) {
    prevTurtle    = currentTurtle
    prevFilename  = currentFilename
  }
  currentTurtle   = turtle
  if (filename) currentFilename = filename

  try {
    const [parsed, store] = await Promise.all([
      parseTurtleToGraph(turtle),
      buildN3Store(turtle),
    ])

    if (parsed.parseErrors.length) {
      toast(`${parsed.parseErrors.length} Turtle parse error(s)`, 'error')
      console.error('Turtle parse errors:', parsed.parseErrors)
    }

    n3Store   = store
    graphData = parsed.graph
    prefixes  = parsed.prefixes
    refreshRdfsLabels()

    graphView!.load(graphData)
    turtleEditor!.setContent(turtle)
    document.getElementById('btn-revert-turtle')!.style.display = 'none'
    buildNodeList(graphData.nodes)
    buildLegend()
    if (document.getElementById('render-panel')!.style.display !== 'none') buildRenderPanel()
    document.getElementById('btn-download')!.style.display = ''

    if (prevTurtle && prevTurtle !== turtle) {
      document.getElementById('diff-tab')!.style.display = ''
      renderDiff()
    }
  } catch (e) {
    toastError('Error applying Turtle', e)
  }
}

// ── Label-mode helpers ───────────────────────────────────────────────────────
/**
 * Produce a display label for a node IRI under the current labelMode.
 * Falls back gracefully through the mode hierarchy.
 */
function labelNode(iri: string): string {
  return labelIri(iri, labelMode, prefixes, rdfsLabels)
}

/**
 * Populate rdfsLabels from the N3 store after each successful parse.
 * Must be called whenever n3Store is updated.
 */
function refreshRdfsLabels(): void {
  rdfsLabels = new Map()
  if (!n3Store) return
  const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'
  for (const q of n3Store.getQuads(null, N3.DataFactory.namedNode(RDFS_LABEL), null, null)) {
    if (q.object.termType === 'Literal' && !rdfsLabels.has(q.subject.value)) {
      rdfsLabels.set(q.subject.value, q.object.value)
    }
  }
}

// ── Turtle edit handler (user typing in the editor) ───────────────────────────
let turtleEditTimer: ReturnType<typeof setTimeout> | null = null
let savedTurtle = ''   // snapshot before user started editing, for revert

function onTurtleEdited(text: string): void {
  currentTurtle = text
  document.getElementById('btn-revert-turtle')!.style.display =
    text !== savedTurtle ? '' : 'none'
  if (turtleEditTimer) clearTimeout(turtleEditTimer)
  turtleEditTimer = setTimeout(async () => {
    try {
      const [parsed, store] = await Promise.all([
        parseTurtleToGraph(text),
        buildN3Store(text),
      ])
      if (parsed.parseErrors.length) return
      n3Store   = store
      graphData = parsed.graph
      prefixes  = parsed.prefixes
      refreshRdfsLabels()
      graphView!.load(graphData)
      buildNodeList(graphData.nodes)
    } catch { /**/ }
  }, 600)
}

document.getElementById('btn-revert-turtle')!.addEventListener('click', () => {
  if (!savedTurtle) return
  currentTurtle = savedTurtle
  turtleEditor!.setContent(savedTurtle)
  document.getElementById('btn-revert-turtle')!.style.display = 'none'
  applyTurtle(savedTurtle)
  toast('Turtle reverted', 'info')
})



// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(name: string): void {
  document.querySelectorAll<HTMLElement>('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name))
  document.querySelectorAll<HTMLElement>('.pane').forEach(p =>
    p.classList.toggle('active', p.dataset.pane === name))
  if (name === 'turtle') turtleEditor?.requestMeasure()
  if (name === 'shex')   shexEditor?.requestMeasure()
}
document.getElementById('tabs')!.addEventListener('click', e => {
  const tab = (e.target as HTMLElement).closest<HTMLElement>('.tab')
  if (tab?.dataset.tab) switchTab(tab.dataset.tab)
})

// ── Keyboard ──────────────────────────────────────────────────────────────────
// activeScrollHost returns null for turtle/shex because CodeMirror manages its
// own scroll container — we scroll it differently below.
function activeScrollHost(): HTMLElement | null {
  const pane = document.querySelector<HTMLElement>('.pane.active')
  if (!pane) return null
  const name = pane.dataset.pane
  if (name === 'turtle' || name === 'shex') return null
  return pane.querySelector<HTMLElement>('.pane-scroll-host') ?? null
}

// For CodeMirror panes, scroll the .cm-scroller element.
function cmScrollHost(): HTMLElement | null {
  const pane = document.querySelector<HTMLElement>('.pane.active')
  if (!pane) return null
  const name = pane.dataset.pane
  if (name !== 'turtle' && name !== 'shex') return null
  return pane.querySelector<HTMLElement>('.cm-scroller') ?? null
}

document.addEventListener('keydown', e => {
  const tag = (e.target as HTMLElement).tagName

  if (e.key === 'PageUp' || e.key === 'PageDown') {
    // Try regular scroll host first; fall back to CodeMirror scroller.
    // Must prevent default regardless so the browser doesn't also scroll.
    const host = activeScrollHost() ?? cmScrollHost()
    if (host) {
      e.preventDefault()
      if (e.ctrlKey) {
        host.scrollTop = e.key === 'PageUp' ? 0 : host.scrollHeight
      } else {
        host.scrollBy({ top: e.key === 'PageUp' ? -host.clientHeight * 0.85 : host.clientHeight * 0.85, behavior: 'smooth' })
      }
      return
    }
  }

  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (e.key === '?') { document.getElementById('kbd-overlay')!.classList.add('visible'); return }
  if (e.key === 'Escape') {
    document.getElementById('kbd-overlay')!.classList.remove('visible')
    document.getElementById('node-detail')!.classList.remove('visible')
    return
  }
  const tabMap: Record<string,string> = { '1':'graph','2':'turtle','3':'sparql','4':'shex','5':'inference' }
  if (e.altKey && tabMap[e.key]) { e.preventDefault(); switchTab(tabMap[e.key]); return }
  if (e.altKey && e.key === 'f') { e.preventDefault(); regexInput.focus(); return }
  if (e.altKey && e.key === 's') { e.preventDefault(); spotInput.focus(); return }
  if (e.altKey && e.key === 'd') { document.getElementById('btn-download')?.click(); return }
  if (e.altKey && e.key === 'g') { graphView?.fitAll(); return }
})

// ── Regex / spotlight / group ─────────────────────────────────────────────────
const regexInput = document.getElementById('regex-input') as HTMLInputElement
const regexHint  = document.getElementById('regex-hint')!
regexInput.addEventListener('input', () => {
  const val   = regexInput.value.trim()
  const valid = !val || isValidRegex(val)
  regexInput.classList.toggle('error', !valid)
  regexHint.textContent = valid ? '' : 'Invalid regex'
  if (valid) { graphView?.setFilter(val || null); pushHistory({ ...readHistory(), regex: val }) }
})
const savedVs = readHistory()
if (savedVs.regex) { regexInput.value = savedVs.regex; setTimeout(() => graphView?.setFilter(savedVs.regex), 0) }
function isValidRegex(s: string): boolean { try { new RegExp(s); return true } catch { return false } }

const spotInput = document.getElementById('spotlight-input') as HTMLInputElement
spotInput.addEventListener('input', () => graphView?.setSpotlight(spotInput.value))

const groupSel = document.getElementById('group-select') as HTMLSelectElement
if (savedVs.group) groupSel.value = savedVs.group
groupSel.addEventListener('change', () => {
  graphView?.setGroupBy(groupSel.value); pushHistory({ ...readHistory(), group: groupSel.value })
})

// ── Fit / Download ────────────────────────────────────────────────────────────
document.getElementById('btn-fit')!.addEventListener('click', () => graphView?.fitAll())

// ── Graph toolbar button wiring ──────────────────────────────────────────────
// Each button toggles one of the four independent flags on GraphView.
// "active" class = the flag is ON (the thing is currently hidden/excluded).

function wireToggle(
  id:         string,
  getState:   () => boolean,
  doToggle:   () => boolean,
  labelOn:    string,  // tooltip when active (feature currently ON / hidden)
  labelOff:   string,  // tooltip when inactive (feature currently OFF / shown)
  msgOn:      string,
  msgOff:     string,
): void {
  const btn = document.getElementById(id) as HTMLButtonElement
  const update = (active: boolean) => {
    btn.classList.toggle('active', active)
    btn.title = active ? labelOn : labelOff
  }
  update(getState())
  btn.addEventListener('click', () => {
    if (!graphView) return
    const now = doToggle()
    update(now)
    toast(now ? msgOn : msgOff, 'info')
  })
}

wireToggle(
  'btn-hide-type-arcs',
  () => graphView?.getHideTypeArcs()  ?? true,
  () => graphView!.toggleHideTypeArcs(),
  'rdf:type arcs hidden (type-only nodes hidden too) — click to show',
  'rdf:type arcs shown — click to hide',
  'rdf:type arcs hidden',
  'rdf:type arcs shown',
)

wireToggle(
  'btn-type-connectivity',
  () => !(graphView?.getTypeArcsInConnectivity() ?? false),
  () => !graphView!.toggleTypeArcsInConnectivity(),
  'rdf:type arcs excluded from connectivity — click to include',
  'rdf:type arcs included in connectivity — click to exclude',
  'rdf:type arcs excluded from connectivity',
  'rdf:type arcs included in connectivity',
)

wireToggle(
  'btn-hide-scalar-arcs',
  () => graphView?.getHideScalarArcs()  ?? true,
  () => graphView!.toggleHideScalarArcs(),
  'Scalar arcs hidden (values shown in node tooltip) — click to show',
  'Scalar arcs shown — click to hide',
  'Scalar arcs hidden',
  'Scalar arcs shown',
)

wireToggle(
  'btn-scalar-connectivity',
  () => !(graphView?.getScalarArcsInConnectivity() ?? false),
  () => !graphView!.toggleScalarArcsInConnectivity(),
  'Scalar arcs excluded from connectivity — click to include',
  'Scalar arcs included in connectivity — click to exclude',
  'Scalar arcs excluded from connectivity',
  'Scalar arcs included in connectivity',
)

// ── Arc filter dropdown ───────────────────────────────────────────────────────
// Shows a dropdown listing all distinct predicates in the current graph,
// each with a checkbox to include/exclude it from rendering (and from the
// connectivity algorithms).

const arcFilterBtn = document.getElementById('btn-arc-filter') as HTMLButtonElement
let arcFilterMenu: HTMLElement | null = null

function dismissArcFilter(): void {
  arcFilterMenu?.remove()
  arcFilterMenu = null
}

arcFilterBtn.addEventListener('click', e => {
  e.stopPropagation()
  if (arcFilterMenu) { dismissArcFilter(); return }
  if (!graphData) { toast('Load a file first', 'info'); return }

  // Collect all distinct predicates from the current graph
  const preds = new Map<string, string>()  // full IRI → short label
  for (const edge of graphData.edges) {
    if (!preds.has(edge.predicateFull)) preds.set(edge.predicateFull, edge.predicate)
  }
  if (!preds.size) { toast('No edges in graph', 'info'); return }

  const menu = document.createElement('div')
  menu.style.cssText = [
    'position:absolute', 'right:8px', 'top:36px',
    'background:var(--bg-card,#1e293b)', 'border:1px solid var(--border,#334155)',
    'border-radius:6px', 'padding:8px', 'min-width:240px', 'max-height:320px',
    'overflow-y:auto', 'z-index:200', 'box-shadow:0 8px 24px rgba(0,0,0,0.4)',
    'font-family:var(--font-mono,monospace)', 'font-size:11px',
  ].join(';')
  menu.style.position = 'absolute'  // relative to graph-toolbar which is position:relative

  for (const [full, short] of [...preds.entries()].sort(([,a],[,b]) => a.localeCompare(b))) {
    const label = document.createElement('label')
    label.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 2px;cursor:pointer;color:var(--text-primary,#e2e8f0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = !graphView!.isExcluded(full)
    cb.addEventListener('change', () => {
      graphView!.togglePredicate(full)
      toast(`${short}: ${cb.checked ? 'shown' : 'hidden'}`, 'info')
    })
    const span = document.createElement('span')
    span.title = full; span.textContent = short
    label.append(cb, span)
    menu.appendChild(label)
  }

  // Position relative to the graph-toolbar
  const toolbar = arcFilterBtn.closest('.graph-toolbar') as HTMLElement
  toolbar.style.position = 'relative'
  toolbar.appendChild(menu)
  arcFilterMenu = menu
})

document.addEventListener('click', dismissArcFilter)
document.getElementById('btn-download')!.addEventListener('click', () => {
  if (!currentTurtle) return
  const a = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(new Blob([currentTurtle], { type: 'text/turtle;charset=utf-8' })),
    download: currentFilename.replace(/\.[^.]+$/, '') + '.ttl' || 'output.ttl',
  })
  a.click(); URL.revokeObjectURL(a.href)
  toast('Turtle downloaded', 'success')
})

// ── Legend download ──────────────────────────────────────────────────────────
document.getElementById('btn-legend-download')!.addEventListener('click', downloadRenderConfig)

// ── Rendering panel toggle ────────────────────────────────────────────────────
document.getElementById('btn-rendering-toggle')!.addEventListener('click', () => {
  const panel = document.getElementById('render-panel')!
  const show  = panel.style.display === 'none'
  if (show) buildRenderPanel()
  panel.style.display = show ? '' : 'none'
})

// ── Label mode button ─────────────────────────────────────────────────────────
{
  const btn = document.getElementById('btn-label-mode') as HTMLButtonElement
  const update = () => {
    btn.title = `Label mode: ${LABEL_MODE_NAMES[labelMode]} (click to cycle)`
    btn.textContent = {
      full:     '<IRI>',
      prefixed: 'pfx:',
      label:    'rdfs:label',
      segment:  `seg${SEGMENT_SEP}ment`,
    }[labelMode]
  }
  update()
  btn.addEventListener('click', () => {
    const idx = LABEL_MODES.indexOf(labelMode)
    labelMode = LABEL_MODES[(idx + 1) % LABEL_MODES.length]
    update()
    toast(`Label mode: ${LABEL_MODE_NAMES[labelMode]}`, 'info')
    if (!PREF_RELABEL_ON_MODE_CHANGE) return
    // Update the graph view's label function so it re-renders with new labels
    graphView?.setLabelFn((iri) => labelNode(iri))
    // Re-render the sidebar node list
    buildNodeList(graphData?.nodes ?? [])
    // Re-render whichever pane is active
    const active = document.querySelector<HTMLElement>('.pane.active')?.dataset.pane
    if (active === 'shex' && document.getElementById('val-counter-row')?.style.display !== 'none') {
      // Validation results are live DOM — rebuild the counter/header text nodes
      document.querySelectorAll<HTMLElement>('.val-type-header').forEach(h => {
        const iri = h.dataset.typeIri
        if (iri) h.textContent = labelNode(iri)
      })
      document.querySelectorAll<HTMLElement>('.val-node').forEach(el => {
        const iri = el.title
        if (iri) el.firstChild!.textContent = labelNode(iri)
      })
    }
  })
}

// ── Node detail panel ─────────────────────────────────────────────────────────
function showNodeDetail(node: GraphNode): void {
  detailNode = node
  document.getElementById('nd-label')!.textContent = labelNode(node.id)
  document.getElementById('nd-types')!.textContent = node.types.join(' \u00B7 ') || '(no type)'
  const body = document.getElementById('nd-body')!
  body.innerHTML = ''
  if (n3Store) {
    const quads = n3Store.getQuads(N3.DataFactory.namedNode(node.id), null, null, null)
    for (const q of quads.slice(0, 50)) {
      const row = document.createElement('div')
      row.className = 'triple-row'
      const predShort = labelNode(q.predicate.value)
      const isIri     = q.object.termType === 'NamedNode'
      const objText   = isIri
        ? labelNode(q.object.value)
        : esc(q.object.value.slice(0, 120) + (q.object.value.length > 120 ? '\u2026' : ''))
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
      more.textContent = `\u2026 ${quads.length - 50} more triples`
      body.appendChild(more)
    }
    body.querySelectorAll<HTMLElement>('.iri-link').forEach(a => {
      a.addEventListener('click', () => {
        const iri = a.dataset.iri!
        graphView?.scrollToNode(iri)
        const target = graphData?.nodes.find(n => n.id === iri)
        if (target) showNodeDetail(target)
      })
    })
  }
  updateExpandBtn()
  document.getElementById('node-detail')!.classList.add('visible')
}

function updateExpandBtn(): void {
  if (!detailNode) return
  document.getElementById('nd-expand-btn')!.textContent =
    detailNode.expanded ? 'Contract node' : 'Expand node'
}

document.getElementById('nd-turtle-link')!.addEventListener('click', () => {
  if (!detailNode) return
  switchTab('turtle')
  setTimeout(() => turtleEditor?.scrollToTerm(detailNode!.id), 80)
})
document.getElementById('nd-expand-btn')!.addEventListener('click', () => {
  if (!detailNode || !graphView) return
  const nowExpanded = graphView.toggleExpand(detailNode.id)
  detailNode.expanded = nowExpanded
  updateExpandBtn()
  toast(nowExpanded ? `Expanded: ${detailNode.label}` : `Contracted: ${detailNode.label}`, 'info')
})
document.getElementById('nd-close')!.addEventListener('click', () =>
  document.getElementById('node-detail')!.classList.remove('visible'))

// ── SPARQL ────────────────────────────────────────────────────────────────────
document.getElementById('btn-run-sparql')!.addEventListener('click', runSparql)
document.getElementById('sparql-query')!.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runSparql() }
})
function runSparql(): void {
  if (!n3Store) { toast('Load a file first', 'info'); return }
  const query = (document.getElementById('sparql-query') as HTMLTextAreaElement).value
  const t0    = performance.now()
  const res   = runSparqlSelect(n3Store, query)
  const ms    = (performance.now() - t0).toFixed(1)
  const out   = document.getElementById('sparql-results')!
  if (res.error) { out.innerHTML = `<div class="mono text-xs" style="color:var(--accent-rose);padding:12px">${esc(res.error)}</div>`; return }
  if (!res.bindings.length) { out.innerHTML = `<div class="mono text-xs text-muted" style="padding:12px">No results (${ms}ms).</div>`; return }
  let html = `<div class="mono text-xs text-muted" style="padding:4px 12px 6px">${res.bindings.length} result(s) \u00B7 ${ms}ms</div><table class="result-table"><thead><tr>`
  for (const v of res.variables) html += `<th>${esc(v)}</th>`
  html += '</tr></thead><tbody>'
  for (const row of res.bindings) {
    html += '<tr>'
    for (const v of res.variables) {
      const val = row[v] ?? '', short = val.length > 80 ? shorten(val) : val
      html += `<td title="${esc(val)}">${esc(short)}</td>`
    }
    html += '</tr>'
  }
  out.innerHTML = html + '</tbody></table>'
  out.querySelectorAll<HTMLElement>('td').forEach(td => {
    const full = td.title
    if (full && graphData?.nodes.some(n => n.id === full)) {
      td.style.cursor = 'pointer'; td.style.color = 'var(--accent-teal)'
      td.addEventListener('click', () => graphView?.scrollToNode(full))
    }
  })
  toast(`${res.bindings.length} results`, 'success')
}

// ── ShEx: Generate ────────────────────────────────────────────────────────────
document.getElementById('btn-gen-shex')!.addEventListener('click', async () => {
  if (!currentTurtle) { toast('Load a file first', 'info'); return }
  toast('Generating ShEx\u2026', 'info')
  try { shexEditor!.setValue(await generateShEx(currentTurtle)); toast('ShEx generated', 'success') }
  catch (e) { toastError('ShEx generation failed', e) }
})

// ── ShEx: Pick types ──────────────────────────────────────────────────────────
document.getElementById('btn-pick-validation-types')!.addEventListener('click', () => {
  if (!n3Store) { toast('Load a file first', 'info'); return }
  const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
  const typeMap  = new Map<string, number>()
  for (const tq of n3Store.getQuads(null, N3.DataFactory.namedNode(RDF_TYPE), null, null)) {
    const t = tq.object.value
    typeMap.set(t, (typeMap.get(t) ?? 0) + 1)
  }
  if (!typeMap.size) { toast('No typed nodes found', 'info'); return }
  selectedTypes = new Set(typeMap.keys())

  const sticky = document.getElementById('shex-results-sticky')!
  sticky.style.display = ''
  sticky.innerHTML = ''

  const counterRow = document.createElement('div')
  counterRow.className = 'val-counter-row'; counterRow.id = 'val-counter-row'; counterRow.style.display = 'none'
  sticky.appendChild(counterRow)

  const toggleRow = document.createElement('div'); toggleRow.className = 'val-type-toggles'
  toggleRow.append(
    makeToggleBtn('All',  'primary', () => { selectedTypes = new Set(typeMap.keys()); updateCheckboxes() }),
    makeToggleBtn('None', '',        () => { selectedTypes.clear(); updateCheckboxes() }),
  )
  sticky.appendChild(toggleRow)

  const checkRow = document.createElement('div'); checkRow.className = 'val-type-checks'; checkRow.id = 'val-type-checks'
  for (const [typeIri, count] of [...typeMap.entries()].sort()) {
    const shortName = labelNode(typeIri)
    const label = document.createElement('label'); label.className = 'val-type-label'; label.title = typeIri
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.dataset.typeIri = typeIri
    cb.addEventListener('change', () => { if (cb.checked) selectedTypes.add(typeIri); else selectedTypes.delete(typeIri) })
    label.append(cb, ` ${esc(shortName)} `)
    const badge = document.createElement('span'); badge.className = 'val-type-badge'; badge.textContent = String(count)
    label.appendChild(badge); checkRow.appendChild(label)
  }
  sticky.appendChild(checkRow)
  toast(`${typeMap.size} type(s) found \u2014 click Validate`, 'info')
})

function makeToggleBtn(label: string, extra: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button'); btn.className = `btn sm ${extra}`.trim()
  btn.textContent = label; btn.addEventListener('click', onClick); return btn
}
function updateCheckboxes(): void {
  document.querySelectorAll<HTMLInputElement>('#val-type-checks input[type=checkbox]').forEach(cb => {
    cb.checked = selectedTypes.has(cb.dataset.typeIri!)
  })
}

// ── ShEx: Validate ────────────────────────────────────────────────────────────
const validateBtn = document.getElementById('btn-validate-shex') as HTMLButtonElement

document.getElementById('btn-validate-shex')!.addEventListener('click', async () => {
  if (validationRunning)   { abortValidation(); return }
  if (!currentTurtle)      { toast('Load a file first', 'info'); return }
  if (!selectedTypes.size) { toast('Pick types first', 'info'); return }
  const shex = shexEditor!.getValue()
  if (!shex.trim() || shex.startsWith('#')) { toast('Generate ShEx first', 'info'); return }

  validationRunning = true
  validateBtn.textContent = 'Abort'
  validateBtn.classList.add('danger'); validateBtn.classList.remove('primary')

  shexWorker?.terminate(); shexWorker = new ShExWorkerClient()
  const out = document.getElementById('shex-results')!; out.innerHTML = ''

  toast('Initialising ShEx worker\u2026', 'info')
  try { await shexWorker.init(shex, currentTurtle) }
  catch (e) {
    toastError('Worker init failed', e)
    out.innerHTML = `<div class="mono text-xs" style="color:var(--accent-rose);padding:12px">Worker init failed: ${esc(String(e))}</div>`
    finishValidation(); return
  }

  const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
  const allTyped = (n3Store ?? new N3.Store())
    .getQuads(null, N3.DataFactory.namedNode(RDF_TYPE), null, null)
    .filter(tq => selectedTypes.has(tq.object.value))
  const byType = new Map<string, typeof allTyped>()
  for (const tq of allTyped) {
    const t = tq.object.value; if (!byType.has(t)) byType.set(t, []); byType.get(t)!.push(tq)
  }
  const totalNodes = allTyped.length

  const counterRow = document.getElementById('val-counter-row')!; counterRow.style.display = ''
  const passedEl = document.createElement('span'); passedEl.style.color = 'var(--accent-green)'
  passedEl.innerHTML = `${Mark_pass} <span data-role="pass-count">0</span> conformant`
  const failedEl = document.createElement('span'); failedEl.style.color = 'var(--accent-rose)'
  failedEl.innerHTML = `${Mark_fail} <span data-role="fail-count">0</span> non-conformant`
  const remainEl = document.createElement('span'); remainEl.style.color = 'var(--accent-amber)'
  remainEl.innerHTML = `${Mark_test} <span data-role="remain-count">${totalNodes}</span> remaining`
  counterRow.innerHTML = ''; counterRow.append(passedEl, '\u00A0\u00B7\u00A0', failedEl, '\u00A0\u00B7\u00A0', remainEl)

  let pass = 0, fail = 0, done = 0
  toast('Validating\u2026', 'info')

  outer:
  for (const [typeIri, quads] of byType) {
    const shortName  = labelNode(typeIri)
    const typeHeader = document.createElement('div'); typeHeader.className = 'val-type-header'; typeHeader.dataset.typeIri = typeIri; typeHeader.textContent = shortName
    out.appendChild(typeHeader)
    for (const tq of quads) {
      if (!validationRunning) break outer
      const nodeId = tq.subject.value, shapeId = `${typeIri}Shape`, label = labelNode(nodeId)
      const row = document.createElement('div'); row.className = 'validation-row'
      row.innerHTML = `<span data-role="icon" style="color:var(--accent-amber)">${Mark_test}</span><div data-role="body"><div class="val-node" title="${esc(nodeId)}">${esc(label)}</div></div>`
      out.appendChild(row); row.scrollIntoView({ block: 'nearest', behavior: 'auto' })
      const r = await shexWorker!.validate(nodeId, shapeId)
      if (!validationRunning || r.errors[0] === 'aborted') {
        row.querySelector<HTMLElement>('[data-role="body"]')!.innerHTML = `<div class="val-node">${esc(label)} \u2014 cancelled</div>`; break outer
      }
      done++
      if (r.passed) { pass++; passedEl.querySelector('[data-role="pass-count"]')!.textContent = String(pass) }
      else          { fail++; failedEl.querySelector('[data-role="fail-count"]')!.textContent = String(fail) }
      remainEl.querySelector('[data-role="remain-count"]')!.textContent = String(totalNodes - done)
      const icon = row.querySelector<HTMLElement>('[data-role="icon"]')!, body = row.querySelector<HTMLElement>('[data-role="body"]')!
      icon.style.color = r.passed ? 'var(--accent-green)' : 'var(--accent-rose)'; icon.innerHTML = r.passed ? Mark_pass : Mark_fail
      body.innerHTML = `<div class="val-node" title="${esc(nodeId)}">${esc(label)} \u2014 ${r.elapsed}ms</div>${r.errors.slice(0,3).map(e => `<div class="val-error">${esc(e.slice(0,200))}</div>`).join('')}`
    }
  }
  finishValidation(); toast(`Validation: ${pass} pass, ${fail} fail`, fail ? 'error' : 'success')
})

function abortValidation(): void {
  shexWorker?.abort(); shexWorker?.terminate(); shexWorker = null; validationRunning = false; finishValidation()
  toast('Validation aborted', 'info')
}
function finishValidation(): void {
  validationRunning = false; if (shexWorker) { shexWorker.terminate(); shexWorker = null }
  validateBtn.textContent = 'Validate'; validateBtn.classList.remove('danger'); validateBtn.classList.add('primary')
}

// ── Type Inference ────────────────────────────────────────────────────────────
document.getElementById('btn-run-inference')!.addEventListener('click', async () => {
  if (!currentTurtle) { toast('Load a file first', 'info'); return }
  toast('Analysing\u2026', 'info')
  const suggestions = await inferTypes(currentTurtle)
  const list = document.getElementById('inference-list')!
  if (!suggestions.length) {
    list.innerHTML = `<li style="color:var(--text-muted);font-family:var(--font-mono);font-size:11px;padding:12px;">No suggestions.</li>`
    toast('No type issues found', 'success'); return
  }
  list.innerHTML = suggestions.map(s => `
    <li class="inference-item">
      <div class="inference-subject">${esc(shorten(s.subject))}</div>
      <div class="inference-value"><span class="text-muted">${esc(shorten(s.predicate))}</span>&nbsp;<strong>"${esc(s.value)}"</strong></div>
      <div class="inference-type">detected as: <strong>${esc(s.pattern)}</strong></div>
      <div class="inference-fix">&rarr; ${esc(s.fix)}</div>
    </li>`).join('')
  toast(`${suggestions.length} suggestion(s)`, 'info')
})

// ── Diff ──────────────────────────────────────────────────────────────────────
async function renderDiff(): Promise<void> {
  if (!prevTurtle || !currentTurtle) return
  document.getElementById('diff-content')!.innerHTML = `<div class="mono text-xs text-muted" style="padding:12px">Computing diff\u2026</div>`
  const diff = await diffTurtle(prevTurtle, currentTurtle)
  document.getElementById('diff-content')!.innerHTML = renderDiffHtml(diff, prefixes)
  document.getElementById('diff-filenames')!.textContent = `${prevFilename || 'previous'} \u2192 ${currentFilename}`
}

// ── Node list / legend / stats / cache / theme / toast / kbd ─────────────────
function buildNodeList(nodes: GraphNode[]): void {
  const container = document.getElementById('node-list')!
  document.getElementById('node-count')!.textContent = `(${nodes.length})`
  function render(filter: string): void {
    const filtered = filter ? nodes.filter(n => {
      const lab = labelNode(n.id).toLowerCase()
      return lab.includes(filter.toLowerCase()) || n.id.toLowerCase().includes(filter.toLowerCase())
    }) : nodes
    container.innerHTML = ''
    for (const node of filtered.slice(0, 300)) {
      const color = Object.entries(TYPE_COLORS).find(([t]) => node.types.includes(t))?.[1] ?? '#94a3b8'
      const item  = document.createElement('div'); item.className = 'node-item'
      item.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${color}"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:var(--text-secondary);" title="${esc(node.id)}">${esc(labelNode(node.id))}</span>`
      item.addEventListener('click', () => { graphView?.scrollToNode(node.id); showNodeDetail(node) })
      container.appendChild(item)
    }
    if (filtered.length > 300) {
      const more = document.createElement('div'); more.className = 'mono text-xs text-muted'; more.style.padding = '4px 8px'
      more.textContent = `\u2026 ${filtered.length - 300} more`; container.appendChild(more)
    }
  }
  render('')
  const nf = document.getElementById('node-filter') as HTMLInputElement
  nf.addEventListener('input', () => render(nf.value))
}
function buildLegend(): void {
  const types = Object.entries(TYPE_COLORS)
    .filter(([k]) => k !== 'default' && !k.startsWith('rdfs'))
  document.getElementById('legend-items')!.innerHTML = types
    .map(([k, color]) => `<div class="legend-item"><div class="legend-dot" style="background:${color}"></div><span>${esc(labelNode(k))}</span></div>`)
    .join('')
  const dlBtn = document.getElementById('btn-legend-download')!
  dlBtn.style.display = types.length ? '' : 'none'
}

function downloadRenderConfig(): void {
  const jsonld = buildRenderConfigJsonLd(TYPE_COLORS, TYPE_RADII, HULL_FILLS, prefixes)
  const blob = new Blob([JSON.stringify(jsonld, null, 2)], { type: 'application/ld+json' })
  const a = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(blob),
    download: 'render-config.jsonld',
  })
  a.click()
  URL.revokeObjectURL(a.href)
  toast('Render config downloaded', 'success')
}

function buildRenderPanel(): void {
  const panel = document.getElementById('render-panel')!
  panel.innerHTML = ''

  const types = Object.entries(TYPE_COLORS)
    .filter(([k]) => k !== 'default' && !k.startsWith('rdfs'))

  if (types.length === 0) {
    const hint = document.createElement('div')
    hint.className = 'mono text-xs text-muted'
    hint.style.padding = '8px'
    hint.textContent = 'No types loaded — load a file to configure colors.'
    panel.appendChild(hint)
    return
  }

  // One swatch row per type
  for (const [typeIri, color] of types) {
    const row = document.createElement('div')
    row.className = 'render-swatch-row'

    const swatch = document.createElement('input')
    swatch.type  = 'color'
    swatch.value = color
    swatch.addEventListener('input', () => {
      TYPE_COLORS[typeIri] = swatch.value
      buildLegend()
      graphView?.refreshColors()
    })

    const label = document.createElement('span')
    label.className   = 'mono text-xs'
    label.textContent = labelNode(typeIri)
    label.title       = typeIri

    row.append(swatch, label)
    panel.appendChild(row)
  }

  // Button row
  const btnRow = document.createElement('div')
  btnRow.className = 'render-btn-row'

  const btnAuto = document.createElement('button')
  btnAuto.className   = 'btn sm'
  btnAuto.textContent = 'Auto-assign colors'
  btnAuto.addEventListener('click', () => {
    const assigned = assignTypeColors(types.map(([iri]) => iri))
    Object.assign(TYPE_COLORS, assigned)
    buildRenderPanel()
    buildLegend()
    graphView?.refreshColors()
  })

  const btnExport = document.createElement('button')
  btnExport.className   = 'btn sm'
  btnExport.textContent = 'Export JSON-LD'
  btnExport.addEventListener('click', downloadRenderConfig)

  btnRow.append(btnAuto, btnExport)
  panel.appendChild(btnRow)
}
function updateCacheBadge(ts: string, hash: string): void {
  document.getElementById('cache-info')!.textContent = `loaded ${new Date(ts).toLocaleTimeString()} \u00B7 ${hash}`
  document.getElementById('cache-badge')!.className = 'cache-badge'
}
function restoreCacheBadge(): void {
  const bt = document.querySelector<HTMLMetaElement>('meta[name="build-time"]')?.content
  if (bt && bt !== '__BUILD_TIME__') {
    document.getElementById('cache-info')!.textContent = `bundle built ${new Date(bt).toLocaleString()}`
    document.getElementById('cache-badge')!.className = 'cache-badge stale'
  }
}
function updateStats(r: ParseResult, nodes: number, edges: number): void {
  document.getElementById('stats-section')!.style.display = ''
  document.getElementById('stats-content')!.innerHTML = `Triples&nbsp;${r.tripleCount.toLocaleString()}<br>Nodes&nbsp;&nbsp;${nodes.toLocaleString()}<br>Edges&nbsp;&nbsp;${edges.toLocaleString()}<br>Sheets&nbsp;${r.sheetsSeen.length}<br>Hash&nbsp;&nbsp;${r.fileHash}`
  document.getElementById('graph-stats-inline')!.textContent = `${nodes} nodes \u00B7 ${edges} edges \u00B7 ${r.tripleCount.toLocaleString()} triples`
}
function restoreTheme(): void {
  if (localStorage.getItem('rdf-theme') === 'light') document.documentElement.classList.add('light-mode')
}
// ── Base IRI input ───────────────────────────────────────────────────────────
{
  const input = document.getElementById('base-iri-input') as HTMLInputElement
  input.value = baseIri

  input.addEventListener('change', () => {
    const newBase = input.value.trim()
    if (!newBase) { input.value = baseIri; return }   // reject empty
    baseIri = newBase
    if (!PREF_RERUN_ON_BASE_CHANGE) return
    for (const loader of getLoaders()) {
      loader.setBaseIri?.(baseIri)
    }
  })

  // Enter key: blur the input which triggers the native 'change' event once
  // (dispatching a synthetic 'change' AND relying on blur would fire twice)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
  })
}
document.getElementById('btn-theme')!.addEventListener('click', () => {
  localStorage.setItem('rdf-theme', document.documentElement.classList.toggle('light-mode') ? 'light' : 'dark')
})
function toast(msg: string, type: 'info' | 'success' | 'error' = 'info'): void {
  const el = Object.assign(document.createElement('div'), { className: `toast ${type}`, textContent: msg })
  document.getElementById('toast-area')!.appendChild(el); setTimeout(() => el.remove(), 3500)
}

/**
 * Report an error to both the toast (brief, user-visible) and console.error
 * (full detail including stack trace, visible in DevTools).
 * Use for any catch block where the user needs to know something went wrong.
 */
function toastError(label: string, err: unknown): void {
  const brief = err instanceof Error ? err.message : String(err)
  toast(`${label}: ${brief}`, 'error')
  console.error(`[${label}]`, err)
}
document.getElementById('kbd-close')!.addEventListener('click', () => document.getElementById('kbd-overlay')!.classList.remove('visible'))
document.getElementById('kbd-overlay')!.addEventListener('click', e => { if (e.target === e.currentTarget) document.getElementById('kbd-overlay')!.classList.remove('visible') })
document.getElementById('btn-shortcuts')!.addEventListener('click', () => document.getElementById('kbd-overlay')!.classList.add('visible'))
window.addEventListener('popstate', () => {
  const vs = readHistory(); regexInput.value = vs.regex; groupSel.value = vs.group ?? 'type'
  graphView?.setFilter(vs.regex || null); graphView?.setGroupBy(vs.group ?? 'type')
})
function esc(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
function shorten(iri: string): string {
  const all = { 'https://example.org/upload#':'ex','http://www.w3.org/2000/01/rdf-schema#':'rdfs','http://www.w3.org/1999/02/22-rdf-syntax-ns#':'rdf','http://www.w3.org/2001/XMLSchema#':'xsd','http://xmlns.com/foaf/0.1/':'foaf', ...prefixes }
  for (const [uri, pfx] of Object.entries(all)) if (iri.startsWith(uri)) return `${pfx}:${iri.slice(uri.length)}`
  const m = iri.match(/[/#]([^/#]+)$/); return m ? decodeURIComponent(m[1]) : iri
}
