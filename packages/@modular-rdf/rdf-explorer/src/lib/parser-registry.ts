/**
 * Loader Registry  (v2)
 *
 * Manages a list of GraphSource instances.  Each loader gets its own drop-zone
 * panel in the sidebar.  Loaders can be added at startup via loader-config.ts
 * (for development) or at runtime by the user dragging a .js loader file onto
 * the "Load" section header.
 *
 * The registry emits change events so the UI can rebuild the sidebar panels.
 */

import type { GraphSource } from '@modular-rdf/api-graph-source'

// ── Subscribers ──────────────────────────────────────────────────────────────
type ChangeListener = (loaders: GraphSource[]) => void
const listeners: ChangeListener[] = []

export function onLoadersChange(cb: ChangeListener): void {
  listeners.push(cb)
}
function notify(): void {
  const snap = getLoaders()
  for (const cb of listeners) cb(snap)
}

// ── Internal store ────────────────────────────────────────────────────────────
const _loaders: GraphSource[] = []

/** All currently registered loaders (in registration order). */
export function getLoaders(): GraphSource[] {
  return [..._loaders]
}

/**
 * Register a loader.  If a loader with the same name already exists it is
 * replaced in-place (so re-uploading an updated parser works as expected).
 * Returns true if an existing loader was replaced, false if it was newly added.
 */
export function registerLoader(loader: GraphSource): boolean {
  const idx = _loaders.findIndex(l => l.name === loader.name)
  if (idx >= 0) { _loaders[idx] = loader; notify(); return true }
  _loaders.push(loader); notify(); return false
}

/**
 * Load a GraphSource from a Blob URL that resolves to an ES module.
 * The module must export `parser` (named) or `default`.
 * Validates the export, registers the loader, and returns it along with
 * a flag indicating whether an existing loader of the same name was replaced.
 */
export async function loadLoaderFromBlob(blobUrl: string): Promise<{ loader: GraphSource; replaced: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: Record<string, any> = await import(/* @vite-ignore */ blobUrl)
  const candidate: GraphSource = mod['parser'] ?? mod['default']

  if (!candidate || typeof candidate.buildPanel !== 'function') {
    throw new Error(
      'Module has no valid GraphSource export.\n' +
      'Expected: export const parser = { name, accepts, buildPanel(container, onTurtleChanged) }',
    )
  }
  if (!candidate.name) {
    throw new Error('GraphSource must have a non-empty name field.')
  }
  if (!Array.isArray(candidate.accepts) || candidate.accepts.length === 0) {
    throw new Error('GraphSource must declare at least one file extension in `accepts`.')
  }

  const replaced = registerLoader(candidate)
  return { loader: candidate, replaced }
}

/**
 * Comma-separated accept string for <input type="file"> covering all loaders.
 * Also includes .js/.mjs so users can drop new loader modules.
 */
export function getAllAccepts(): string {
  const exts = new Set<string>(['.js', '.mjs'])
  for (const l of _loaders) for (const e of l.accepts) exts.add(e)
  return [...exts].join(',')
}
