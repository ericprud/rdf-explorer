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

import type { GraphHandler, HandlerState, HandlerCallbacks } from '@modular-rdf/graph-handler-api'
import type { ApplyGraphCallback } from '@modular-rdf/graph-source-api'
import { loadHandlerFromBlob } from './handler-registry'

// Names of panes that are built into the HTML skeleton — they already have
// a tab and a pane div; we must not create duplicates.
const BUILTIN_PANE_NAMES = new Set(['graph', 'turtle', 'sparql', 'shex', 'inference', 'diff'])

// Track which external handlers have already had a tab+pane created.
const mountedExternalHandlers = new Map<string, HTMLElement>()

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
    mountExternalHandler(handler, tabsEl, contentEl, callbacks, switchTab)
    onToast(`Handler registered: ${handler.label ?? handler.name}`, 'success')
  } catch (err) {
    onToast(`Handler load failed: ${err instanceof Error ? err.message : String(err)}`, 'error')
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ── Dynamic tab + pane creation ───────────────────────────────────────────────

/**
 * For an external (non-built-in) handler, create a new tab button and pane
 * div, then call `handler.mount()`.
 * Safe to call multiple times — if the handler was already mounted, its
 * container is re-used (supports hot-swap when re-uploading an updated handler).
 */
export function mountExternalHandler(
  handler:   GraphHandler,
  tabsEl:    HTMLElement,
  contentEl: HTMLElement,
  callbacks: HandlerCallbacks,
  switchTab: (name: string) => void,
): void {
  if (BUILTIN_PANE_NAMES.has(handler.name)) return  // built-in — host owns the DOM

  const label = handler.label ?? handler.name

  // Re-use existing container if the handler was previously mounted
  let paneEl = mountedExternalHandlers.get(handler.name)
  if (!paneEl) {
    // Create pane div
    paneEl = document.createElement('div')
    paneEl.className  = 'pane'
    paneEl.dataset.pane = handler.name
    contentEl.appendChild(paneEl)
    mountedExternalHandlers.set(handler.name, paneEl)

    // Create tab button
    const tabEl = document.createElement('div')
    tabEl.className   = 'tab'
    tabEl.dataset.tab = handler.name
    tabEl.textContent = label
    tabEl.addEventListener('click', () => switchTab(handler.name))
    // Insert before the hidden diff tab (last item) if present, otherwise append
    const diffTab = tabsEl.querySelector<HTMLElement>('[data-tab="diff"]')
    if (diffTab) tabsEl.insertBefore(tabEl, diffTab)
    else         tabsEl.appendChild(tabEl)
  } else {
    // Hot-swap: clear the container so the new handler gets a fresh mount
    paneEl.innerHTML = ''
    // Update tab label in case it changed
    const tabEl = tabsEl.querySelector<HTMLElement>(`[data-tab="${handler.name}"]`)
    if (tabEl) tabEl.textContent = label
  }

  handler.mount(paneEl, callbacks)
}

// ── State broadcast ───────────────────────────────────────────────────────────

/**
 * Push the latest application state to all external handlers.
 * Call this from main.ts after each graph update.
 *
 * @param text  Optional text form of the current graph.  If provided, any
 *              handler that declares `updateText` will receive it.
 */
export function updateExternalHandlers(
  handlers: GraphHandler[],
  state:    HandlerState,
  text?:    { text: string; format?: 'turtle' | 'trig' },
): void {
  for (const h of handlers) {
    if (BUILTIN_PANE_NAMES.has(h.name)) continue
    try { h.update(state) } catch (e) { console.error(`[handler:${h.name}] update() threw`, e) }
    if (text && h.updateText) {
      try { h.updateText(text.text, text.format) } catch (e) { console.error(`[handler:${h.name}] updateText() threw`, e) }
    }
  }
}
