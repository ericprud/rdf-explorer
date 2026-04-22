/**
 * RDF Explorer – Main entry point
 *
 * Design principles for loaders:
 *  • Each GraphSource owns its own panel DOM (via buildPanel).
 *  • Loaders call onTurtleChanged(turtle) whenever their output changes.
 *  • main.ts knows nothing about vocab toggles or parser-internal state.
 *
 * load-title accepts:
 *  • .js / .mjs  — register as a new loader
 *  • .ttl / .n3  — load Turtle directly (replace, or augment if Ctrl held)
 *
 * Ctrl+PgUp/Dn works in all panes including CodeMirror (turtle/shex).
 *
 * Runtime configuration
 *  • On startup the app fetches the URL in ?configURL= (default: ./config.json).
 *  • The config lists graphHandler entries (which tabs to show) and graphSources
 *    entries (loaders to register automatically, e.g. from ./loaders/*.js).
 *  • Built-in handlers are statically bundled; a config entry with a "url" field
 *    dynamically imports that module instead (useful for custom deployments).
 */
import './styles/main.css'
import { readHistory }                                        from './lib/graph-store'
import { parseRenderConfigJsonLd,
         normalisePrefixes,
         TYPE_COLORS, TYPE_RADII, HULL_FILLS }               from '@modular-rdf/pane-graph'
import { diffTurtle, renderDiffHtml }                        from './lib/diff'
import { getLoaders, loadLoaderFromBlob, onLoadersChange }   from './lib/parser-registry'
import { buildLoaderPanels }                                 from './lib/loader-panels'
import { resolveTypeKeys }                                   from '@modular-rdf/rdf-utils'
import { getHandlers, loadHandlerFromBlob, onHandlersChange } from './lib/handler-registry'
import { registerBuiltinHandlers }                           from './lib/handler-config'
import { buildHandlerDropZone, mountExternalHandler,
         updateExternalHandlers }                            from './lib/handler-panels'
import type { GraphSource, ApplyGraphInput }                 from '@modular-rdf/graph-source-api'
import type { HandlerCallbacks }                             from '@modular-rdf/graph-handler-api'
import * as N3                                               from 'n3'
import { LABEL_MODES, LABEL_MODE_NAMES,
         SEGMENT_SEP, type LabelMode,
         parseIntoStore }                                    from '@modular-rdf/rdf-utils'

// ── Register built-in pane handlers ──────────────────────────────────────────
registerBuiltinHandlers()

// ── Preference constants ────────────────────────────────────────────────────
const PREF_RERUN_ON_BASE_CHANGE  = true
const PREF_RELABEL_ON_MODE_CHANGE = true
const PREF_DEFAULT_BASE_IRI = window.location.origin + '/upload/'

// ── Runtime config types ──────────────────────────────────────────────────────
interface HandlerEntry {
  name:    string
  label:   string
  hidden?: boolean
  /** If present, dynamically import this ES module URL for the handler. */
  url?:    string
}
interface SourceEntry {
  url:    string
  label?: string
}
interface AppConfig {
  graphHandler: HandlerEntry[]
  graphSources: SourceEntry[]
}

async function loadConfig(): Promise<AppConfig> {
  const params    = new URLSearchParams(window.location.search)
  const configUrl = params.get('configURL') ?? './config.json'
  const resolved  = new URL(configUrl, window.location.href).href
  try {
    const res = await fetch(resolved)
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${resolved}`)
    return await res.json() as AppConfig
  } catch (e) {
    console.error('[config] Failed to load config:', e)
    toast(`Config load failed: ${e instanceof Error ? e.message : e}`, 'error')
    return { graphHandler: [], graphSources: [] }
  }
}

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
    <div id="sidebar-top">
      <div class="sidebar-section">
        <div class="sidebar-section-title load-title" id="load-title"
             title="Drop a .js loader or .ttl Turtle file here. Ctrl+drop augments.">
          Load
          <span class="load-title-hint">&#x2295; .js loader or .ttl Turtle</span>
        </div>
        <div id="loader-panels"></div>
      </div>
    </div>
    <div id="sidebar-pane-section" style="flex:1;overflow-y:auto;min-height:0;display:flex;flex-direction:column;"></div>
  </aside>

  <div class="main">
    <div class="tabs" id="tabs">
      <div class="tab-spacer"></div>
      <div id="handler-drop-zone-placeholder"></div>
    </div>
    <div class="tab-content"></div>
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
      ['Alt+D',                    'Download Turtle'],
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
let n3Store:      N3.Store | null = null
let prefixes:     Record<string, string> = {}
let labelMode: LabelMode = 'segment'
let rdfsLabels = new Map<string, string>()
let baseIri    = PREF_DEFAULT_BASE_IRI

// ── Tab keyboard map — filled by init() ──────────────────────────────────────
let tabMap: Record<string, string> = {}

// ── Active tab name — set by init(), updated by switchTab() ──────────────────
let activeHandlerName = 'graph'

// ── Sidebar bottom section ────────────────────────────────────────────────────
const sidebarPaneSection = document.getElementById('sidebar-pane-section')!

// ── Handler callbacks ─────────────────────────────────────────────────────────
const handlerCallbacks: HandlerCallbacks = {
  toast,
  applyGraph: (input: ApplyGraphInput) => handleApplyGraph(input),
  switchTab,
  showNode: (id: string) => {
    const h = getHandlers().find(x => x.name === 'graph')
    h?.focusTerm?.(id)
  },
  focusTerm: (iri: string) => {
    const activeName = document.querySelector<HTMLElement>('.pane.active')?.dataset.pane
    if (!activeName) return
    const h = getHandlers().find(x => x.name === activeName)
    h?.focusTerm?.(iri)
  },
}

// ── Drop-zone for externally dropped handler .js files ───────────────────────
{
  const tabsEl      = document.getElementById('tabs')!
  const contentEl   = document.querySelector<HTMLElement>('.tab-content')!
  const placeholder = document.getElementById('handler-drop-zone-placeholder')!

  const dropZone = buildHandlerDropZone(
    tabsEl, contentEl,
    handlerCallbacks,
    toast,
    switchTab,
  )
  placeholder.replaceWith(dropZone)
}

// ── Async initialisation — reads config, builds tabs, mounts handlers ─────────
async function init(): Promise<void> {
  const config  = await loadConfig()
  const tabsEl  = document.getElementById('tabs')!
  const contentEl = document.querySelector<HTMLElement>('.tab-content')!
  const tabSpacer = tabsEl.querySelector<HTMLElement>('.tab-spacer')!

  const firstVisible = config.graphHandler.find(h => !h.hidden)
  activeHandlerName  = firstVisible?.name ?? 'graph'
  tabMap = Object.fromEntries(
    config.graphHandler.filter(h => !h.hidden).map((h, i) => [String(i + 1), h.name])
  )

  // Build tab buttons and pane containers from config
  for (const entry of config.graphHandler) {
    const isFirst = entry.name === firstVisible?.name

    const tab = document.createElement('div')
    tab.className   = `tab${isFirst ? ' active' : ''}`
    tab.dataset.tab = entry.name
    if (entry.name === 'diff') tab.id = 'diff-tab'
    if (entry.hidden) tab.style.display = 'none'
    tab.textContent = entry.label
    tabsEl.insertBefore(tab, tabSpacer)

    const pane = document.createElement('div')
    pane.className    = `pane${isFirst ? ' active' : ''}`
    pane.dataset.pane = entry.name
    if (entry.name === 'diff') {
      pane.innerHTML = `
        <div class="pane-toolbar flex-row">
          <span class="mono text-xs text-muted grow">Triple-level diff: previous load vs current</span>
          <span class="mono text-xs text-muted" id="diff-filenames"></span>
        </div>
        <div id="diff-content" class="diff-pane pane-scroll-host"></div>`
    }
    contentEl.appendChild(pane)
  }

  // Load any handler modules specified by URL (overrides pre-bundled handler of same name)
  for (const entry of config.graphHandler) {
    if (!entry.url) continue
    try {
      const url = new URL(entry.url, window.location.href).href
      await loadHandlerFromBlob(url)
    } catch (e) {
      toast(`Failed to load handler '${entry.name}': ${e instanceof Error ? e.message : e}`, 'error')
    }
  }

  // Mount all registered handlers into their pane divs
  for (const { name } of config.graphHandler) {
    const h = getHandlers().find(x => x.name === name)
    if (h) {
      const paneEl = contentEl.querySelector<HTMLElement>(`[data-pane="${name}"]`)!
      h.mount(paneEl, handlerCallbacks)
    }
  }

  // Activate the first visible pane's sidebar section
  if (firstVisible) {
    const firstHandler = getHandlers().find(x => x.name === firstVisible.name)
    firstHandler?.onActivate?.(sidebarPaneSection)
  }

  // Auto-load graph sources listed in the config
  for (const source of config.graphSources ?? []) {
    try {
      const url = new URL(source.url, window.location.href).href
      await loadLoaderFromBlob(url)
    } catch (e) {
      console.warn(`[config] Failed to load source '${source.url}':`, e)
    }
  }

  // Now safe to wire up the handler-change listener (only fires for post-init drops)
  onHandlersChange(handlers => {
    for (const h of handlers) {
      mountExternalHandler(h, tabsEl, contentEl, handlerCallbacks, switchTab)
    }
  })
}

init().catch(e => console.error('[init]', e))

// ── Loader panels ─────────────────────────────────────────────────────────────
const loaderPanelContainer = document.getElementById('loader-panels')!

function rebuildLoaderPanels(loaders: GraphSource[]): void {
  buildLoaderPanels(loaders, loaderPanelContainer, handleApplyGraph, baseIri)
}

onLoadersChange(rebuildLoaderPanels)
rebuildLoaderPanels(getLoaders())

/**
 * Unified entry point for all RDF input — from loaders, handler callbacks,
 * or direct file drops.  Accepts Turtle/TriG text or a pre-parsed RDF dataset.
 *
 * Text path: parse → store + prefixes, keep text for the Turtle editor.
 * Store path: use store directly, serialise to Turtle for text-wanting handlers.
 */
function handleApplyGraph(input: ApplyGraphInput | string): void {
  if (typeof input === 'string') { input = { text: input }; }
  if ('store' in input) {
    const { store, ctx } = input
    const writer = new N3.Writer({ prefixes: ctx?.prefixes ?? {} })
    for (const q of store as Iterable<N3.Quad>) writer.addQuad(q)
    writer.end((_err, turtle) => {
      if (currentTurtle) { prevTurtle = currentTurtle; prevFilename = currentFilename }
      currentTurtle = turtle
      applyTurtle(turtle)
    })
  } else {
    const { text, filename } = input
    if (currentTurtle) { prevTurtle = currentTurtle; prevFilename = currentFilename }
    currentTurtle   = text
    currentFilename = filename ?? currentFilename
    applyTurtle(text)
  }
}

// ── load-title: drop target for .js loaders and .ttl Turtle ──────────────────
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
  const augment = (e as MouseEvent).ctrlKey
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
      const turtlePfx = normalisePrefixes(prefixes)
      Object.assign(TYPE_COLORS, resolveTypeKeys(cfg.typeColors, turtlePfx))
      Object.assign(TYPE_RADII,  resolveTypeKeys(cfg.typeRadii,  turtlePfx))
      Object.assign(HULL_FILLS,  resolveTypeKeys(cfg.hullFills,  turtlePfx))
      toast('Render config applied', 'success')
    } catch (err) { toastError('Failed to parse JSON-LD', err) }
    return
  }

  if (ext === '.ttl' || ext === '.n3' || ext === '.turtle') {
    const turtle = await file.text()
    if (augment && currentTurtle) {
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
  currentTurtle = turtle
  if (filename) currentFilename = filename

  try {
    const { store, prefixes: parsedPrefixes } = await parseIntoStore(turtle, baseIri)

    n3Store  = store
    prefixes = parsedPrefixes
    // Re-expand loader rendering prefs now we have the Turtle's full prefix map.
    const turtlePfx = normalisePrefixes(prefixes)
    for (const loader of getLoaders()) {
      const combined = { ...turtlePfx, ...(loader.prefixes ?? {}) }
      const rp       = loader.renderingPreferences
      if (rp?.typeColors) Object.assign(TYPE_COLORS, resolveTypeKeys(rp.typeColors, combined))
      if (rp?.typeRadii)  Object.assign(TYPE_RADII,  resolveTypeKeys(rp.typeRadii,  combined))
      if (rp?.hullFills)  Object.assign(HULL_FILLS,  resolveTypeKeys(rp.hullFills,  combined))
    }
    refreshRdfsLabels()

    document.getElementById('btn-download')!.style.display = ''

    if (prevTurtle && prevTurtle !== turtle) {
      document.getElementById('diff-tab')?.style && (document.getElementById('diff-tab')!.style.display = '')
      renderDiff()
    }

    updateExternalHandlers(
      getHandlers(),
      { store: n3Store, prefixes, rdfsLabels, baseIri, labelMode },
      { text: turtle, format: 'turtle' },
    )
  } catch (e) {
    toastError('Error applying Turtle', e)
  }
}

// ── RDFS labels ───────────────────────────────────────────────────────────────
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

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(name: string): void {
  // Deactivate previous handler
  if (activeHandlerName !== name) {
    const prevHandler = getHandlers().find(x => x.name === activeHandlerName)
    prevHandler?.onDeactivate?.()
  }

  document.querySelectorAll<HTMLElement>('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name))
  document.querySelectorAll<HTMLElement>('.pane').forEach(p =>
    p.classList.toggle('active', p.dataset.pane === name))

  activeHandlerName = name

  // Activate new handler with sidebar section
  const newHandler = getHandlers().find(x => x.name === name)
  newHandler?.onActivate?.(sidebarPaneSection)
}

document.getElementById('tabs')!.addEventListener('click', e => {
  const tab = (e.target as HTMLElement).closest<HTMLElement>('.tab')
  if (tab?.dataset.tab) switchTab(tab.dataset.tab)
})

// ── Keyboard ──────────────────────────────────────────────────────────────────
function activeScrollHost(): HTMLElement | null {
  const pane = document.querySelector<HTMLElement>('.pane.active')
  if (!pane) return null
  return pane.querySelector<HTMLElement>('.pane-scroll-host') ?? null
}

function cmScrollHost(): HTMLElement | null {
  const pane = document.querySelector<HTMLElement>('.pane.active')
  if (!pane) return null
  return pane.querySelector<HTMLElement>('.cm-scroller') ?? null
}

document.addEventListener('keydown', e => {
  const tag = (e.target as HTMLElement).tagName

  if (e.key === 'PageUp' || e.key === 'PageDown') {
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
    return
  }
  if (e.altKey && tabMap[e.key]) { e.preventDefault(); switchTab(tabMap[e.key]); return }
  if (e.altKey && e.key === 'd') { document.getElementById('btn-download')?.click(); return }
})

// ── Download Turtle ───────────────────────────────────────────────────────────
document.getElementById('btn-download')!.addEventListener('click', () => {
  if (!currentTurtle && !n3Store) return
  const getContent = (): Promise<string> => {
    if (currentTurtle) return Promise.resolve(currentTurtle)
    return new Promise(resolve => {
      const writer = new N3.Writer({ prefixes })
      for (const q of n3Store as Iterable<N3.Quad>) writer.addQuad(q)
      writer.end((_err, turtle) => resolve(turtle))
    })
  }
  getContent().then(content => {
    const a = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(new Blob([content], { type: 'text/turtle;charset=utf-8' })),
      download: (currentFilename.replace(/\.[^.]+$/, '') || 'output') + '.ttl',
    })
    a.click(); URL.revokeObjectURL(a.href)
    toast('Turtle downloaded', 'success')
  })
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
    // Re-push updated state so handlers can re-render labels
    if (n3Store) {
      updateExternalHandlers(
        getHandlers(),
        { store: n3Store, prefixes, rdfsLabels, baseIri, labelMode },
      )
    }
  })
}

// ── Diff ──────────────────────────────────────────────────────────────────────
async function renderDiff(): Promise<void> {
  if (!prevTurtle || !currentTurtle) return
  document.getElementById('diff-content')!.innerHTML = `<div class="mono text-xs text-muted" style="padding:12px">Computing diff…</div>`
  const diff = await diffTurtle(prevTurtle, currentTurtle)
  document.getElementById('diff-content')!.innerHTML = renderDiffHtml(diff, prefixes)
  document.getElementById('diff-filenames')!.textContent = `${prevFilename || 'previous'} → ${currentFilename}`
}

// ── Base IRI input ───────────────────────────────────────────────────────────
{
  const input = document.getElementById('base-iri-input') as HTMLInputElement
  input.value = baseIri

  input.addEventListener('change', () => {
    const newBase = input.value.trim()
    if (!newBase) { input.value = baseIri; return }
    baseIri = newBase
    if (!PREF_RERUN_ON_BASE_CHANGE) return
    for (const loader of getLoaders()) {
      loader.setBaseIri?.(baseIri)
    }
  })

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
  })
}

// ── Cache badge / theme / toast / kbd ────────────────────────────────────────
function restoreCacheBadge(): void {
  const bt = document.querySelector<HTMLMetaElement>('meta[name="build-time"]')?.content
  if (bt && bt !== '__BUILD_TIME__') {
    document.getElementById('cache-info')!.textContent = `bundle built ${new Date(bt).toLocaleString()}`
    document.getElementById('cache-badge')!.className = 'cache-badge stale'
  }
}

function restoreTheme(): void {
  if (localStorage.getItem('rdf-theme') === 'light') document.documentElement.classList.add('light-mode')
}

restoreCacheBadge()
restoreTheme()

document.getElementById('btn-theme')!.addEventListener('click', () => {
  localStorage.setItem('rdf-theme', document.documentElement.classList.toggle('light-mode') ? 'light' : 'dark')
})

function toast(msg: string, type: 'info' | 'success' | 'error' = 'info'): void {
  const el = Object.assign(document.createElement('div'), { className: `toast ${type}`, textContent: msg })
  document.getElementById('toast-area')!.appendChild(el); setTimeout(() => el.remove(), 3500)
}

function toastError(label: string, err: unknown): void {
  const brief = err instanceof Error ? err.message : String(err)
  toast(`${label}: ${brief}`, 'error')
  console.error(`[${label}]`, err)
}

document.getElementById('kbd-close')!.addEventListener('click', () => document.getElementById('kbd-overlay')!.classList.remove('visible'))
document.getElementById('kbd-overlay')!.addEventListener('click', e => { if (e.target === e.currentTarget) document.getElementById('kbd-overlay')!.classList.remove('visible') })
document.getElementById('btn-shortcuts')!.addEventListener('click', () => document.getElementById('kbd-overlay')!.classList.add('visible'))

window.addEventListener('popstate', () => {
  readHistory()
})
