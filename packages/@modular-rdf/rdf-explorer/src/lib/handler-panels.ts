/**
 * handler-panels.ts
 *
 * Manages the "extra handlers" drop zone and dynamic tab/pane creation for
 * GraphHandler plugins loaded at runtime.
 *
 * Built-in panes (Graph, Turtle, SPARQL, ShEx, Type Inference) are wired
 * directly in main.ts and are not created here.  Only handlers whose name
 * does NOT match a built-in tab are given a new DOM tab + pane.
 *
 * The drop zone is a thin strip that sits to the left of the main tab-content
 * area.  Dropping a .js file onto it loads and registers a GraphHandler.
 */

import type { GraphHandler, HandlerState, HandlerCallbacks } from '@modular-rdf/api-graph-handler'
import type { ApplyGraphCallback } from '@modular-rdf/api-graph-source'
import { loadHandlerFromBlob, appendHandler } from './handler-registry'

// ── Pane instance tracking ────────────────────────────────────────────────────
let _paneCounter = 0
const _paneHandlers = new Map<string, GraphHandler>()

/** Look up a dynamically dropped handler by its load-order pane id (e.g. 'pane0'). */
export function getHandlerByPaneId(paneId: string): GraphHandler | undefined {
  return _paneHandlers.get(paneId)
}


// ── Drop zone ─────────────────────────────────────────────────────────────────

/**
 * Build and return the handler drop zone element.
 * Callers should insert it into the DOM at the desired position.
 *
 * @param tabsEl     The `.tabs` bar to append new tab buttons to.
 * @param contentEl  The `.tab-content` area to append new pane divs to.
 * @param callbacks  Host callbacks forwarded to each mounted handler.
 * @param onToast    Show a transient notification.
 * @param switchTab  Switch the active tab by name.
 */
export function buildHandlerDropZone(
  tabsEl:    HTMLElement,
  contentEl: HTMLElement,
  callbacks: HandlerCallbacks,
  onToast:   (msg: string, kind?: 'info' | 'success' | 'error') => void,
  switchTab: (name: string) => void,
  // kept for symmetry with buildLoaderPanels; unused until handler hot-reload
  _applyGraph?: ApplyGraphCallback,
): HTMLElement {
  const zone = document.createElement('div')
  zone.id        = 'handler-drop-zone'
  zone.className = 'handler-drop-zone'
  zone.title     = 'Drop a .js handler plugin here to add a new pane'
  zone.innerHTML = '<span class="handler-drop-icon">&#x2295;</span><span class="handler-drop-label">handler</span>'

  const activate  = () => zone.classList.add('drag-over')
  const deactivate = () => zone.classList.remove('drag-over')

  zone.addEventListener('dragover',  e => { e.preventDefault(); activate() })
  zone.addEventListener('dragleave', deactivate)
  zone.addEventListener('dragend',   deactivate)

  zone.addEventListener('drop', async e => {
    e.preventDefault(); deactivate()
    for (const file of e.dataTransfer?.files ?? []) {
      await loadHandlerFile(file, tabsEl, contentEl, callbacks, onToast, switchTab)
    }
  })

  // Also support click-to-upload
  const fi = document.createElement('input')
  fi.type    = 'file'
  fi.accept  = '.js,.mjs'
  fi.multiple = true
  fi.style.display = 'none'
  document.body.appendChild(fi)

  zone.addEventListener('click', () => fi.click())
  fi.addEventListener('change', async () => {
    for (const file of fi.files ?? []) {
      await loadHandlerFile(file, tabsEl, contentEl, callbacks, onToast, switchTab)
    }
    fi.value = ''
  })

  return zone
}

async function loadHandlerFile(
  file:      File,
  tabsEl:    HTMLElement,
  contentEl: HTMLElement,
  callbacks: HandlerCallbacks,
  onToast:   (msg: string, kind?: 'info' | 'success' | 'error') => void,
  switchTab: (name: string) => void,
): Promise<void> {
  const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase()
  if (ext !== '.js' && ext !== '.mjs') {
    onToast(`Expected a .js handler file, got: ${file.name}`, 'error'); return
  }
  const url = URL.createObjectURL(new Blob([await file.text()], { type: 'application/javascript' }))
  try {
    const handler = await loadHandlerFromBlob(url)
    appendHandler(handler)
    mountExternalHandler(handler, tabsEl, contentEl, callbacks, switchTab)
    onToast(`Handler loaded: ${handler.label ?? handler.name}`, 'success')
  } catch (err) {
    onToast(`Handler load failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ── Dynamic tab + pane creation ───────────────────────────────────────────────

/**
 * Create a new tab + pane for a dropped handler.
 * Always creates a fresh pane — multiple drops of the same handler name each
 * get their own pane with a unique load-order id (pane0, pane1, …).
 */
export function mountExternalHandler(
  handler:   GraphHandler,
  tabsEl:    HTMLElement,
  contentEl: HTMLElement,
  callbacks: HandlerCallbacks,
  switchTab: (name: string) => void,
): void {
  const paneId = `pane${_paneCounter++}`
  const label  = handler.label ?? handler.name

  _paneHandlers.set(paneId, handler)

  const paneEl = document.createElement('div')
  paneEl.className    = 'pane'
  paneEl.dataset.pane = paneId
  contentEl.appendChild(paneEl)

  const tabEl = document.createElement('div')
  tabEl.className    = 'tab'
  tabEl.dataset.tab  = paneId
  tabEl.textContent  = label
  tabEl.addEventListener('click', () => switchTab(paneId))
  const anchor = tabsEl.querySelector<HTMLElement>('.tab-spacer')
  if (anchor) tabsEl.insertBefore(tabEl, anchor)
  else        tabsEl.appendChild(tabEl)

  handler.mount(paneEl, callbacks)
}

// ── State broadcast ───────────────────────────────────────────────────────────

/**
 * Push the latest application state to all handlers.
 * Call this from main.ts after each graph update.
 *
 * @param text  Optional text form of the current graph.  If provided, any
 *              handler that declares `updateText` will receive it.
 */
export function updateExternalHandlers(
  handlers: GraphHandler[],
  state:    HandlerState,
  text?:    { text: string; format?: 'turtle' | 'trig'; filename?: string },
): void {
  for (const h of handlers) {
    try { h.update(state) } catch (e) { console.error(`[handler:${h.name}] update() threw`, e) }
    if (text && h.updateText) {
      try { h.updateText(text.text, text.format, text.filename) } catch (e) { console.error(`[handler:${h.name}] updateText() threw`, e) }
    }
  }
}
