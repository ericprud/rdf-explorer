/**
 * Handler Registry
 *
 * Manages a list of GraphHandler instances (pluggable pane tabs).
 * Mirrors the pattern of parser-registry.ts.
 *
 * Handlers can be added at startup via handler-config.ts or at runtime by
 * the user dropping a .js file that exports a valid GraphHandler.
 *
 * The registry emits change events so the UI can rebuild the tab bar.
 */

import type { GraphHandler } from '@modular-rdf/api-graph-handler'

// ── Subscribers ──────────────────────────────────────────────────────────────
type ChangeListener = (handlers: GraphHandler[]) => void
const listeners: ChangeListener[] = []

export function onHandlersChange(cb: ChangeListener): void {
  listeners.push(cb)
}
function notify(): void {
  const snap = getHandlers()
  for (const cb of listeners) cb(snap)
}

// ── Internal store ────────────────────────────────────────────────────────────
const _handlers: GraphHandler[] = []

/** All currently registered handlers (in registration order). */
export function getHandlers(): GraphHandler[] {
  return [..._handlers]
}

/**
 * Register a handler.  If a handler with the same name already exists it is
 * replaced in-place (re-uploading an updated handler works as expected).
 */
export function registerHandler(handler: GraphHandler): void {
  const idx = _handlers.findIndex(h => h.name === handler.name)
  if (idx >= 0) {
    _handlers[idx].destroy?.()
    _handlers[idx] = handler
  } else {
    _handlers.push(handler)
  }
  notify()
}

/**
 * Load a GraphHandler from a Blob URL that resolves to an ES module.
 * The module must export `handler` (named) or `default`.
 * Validates the export, registers the handler, and returns it.
 */
export async function loadHandlerFromBlob(blobUrl: string): Promise<GraphHandler> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: Record<string, any> = await import(/* @vite-ignore */ blobUrl)
  const candidate: GraphHandler = mod['handler'] ?? mod['default']

  if (!candidate || typeof candidate.mount !== 'function') {
    throw new Error(
      'Module has no valid GraphHandler export.\n' +
      'Expected: export const handler = { name, mount(container, callbacks), update(state) }',
    )
  }
  if (!candidate.name) {
    throw new Error('GraphHandler must have a non-empty name field.')
  }
  if (typeof candidate.update !== 'function') {
    throw new Error('GraphHandler must implement update(state).')
  }

  registerHandler(candidate)
  return candidate
}
