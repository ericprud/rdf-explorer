/**
 * Loader Registry  (v2)
 *
 * Manages a list of DataLoader instances.  Each loader gets its own drop-zone
 * panel in the sidebar.  Loaders can be added at startup via loader-config.ts
 * (for development) or at runtime by the user dragging a .js loader file onto
 * the "Load" section header.
 *
 * The registry emits change events so the UI can rebuild the sidebar panels.
 */

import type { DataLoader } from './parser-api'

// ── Subscribers ──────────────────────────────────────────────────────────────
type ChangeListener = (loaders: DataLoader[]) => void
const listeners: ChangeListener[] = []

export function onLoadersChange(cb: ChangeListener): void {
  listeners.push(cb)
}
function notify(): void {
  const snap = getLoaders()
  for (const cb of listeners) cb(snap)
}

// ── Internal store ────────────────────────────────────────────────────────────
const _loaders: DataLoader[] = []

/** All currently registered loaders (in registration order). */
export function getLoaders(): DataLoader[] {
  return [..._loaders]
}

/**
 * Register a loader.  If a loader with the same name already exists it is
 * replaced in-place (so re-uploading an updated parser works as expected).
 */
export function registerLoader(loader: DataLoader): void {
  const idx = _loaders.findIndex(l => l.name === loader.name)
  if (idx >= 0) _loaders[idx] = loader
  else          _loaders.push(loader)
  notify()
}

/**
 * Load a DataLoader from a Blob URL that resolves to an ES module.
 * The module must export `parser` (named) or `default`.
 * Validates the export, registers the loader, and returns it.
 */
export async function loadLoaderFromBlob(blobUrl: string): Promise<DataLoader> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: Record<string, any> = await import(/* @vite-ignore */ blobUrl)
  const candidate: DataLoader = mod['parser'] ?? mod['default']

  if (!candidate || typeof candidate.buildPanel !== 'function') {
    throw new Error(
      'Module has no valid DataLoader export.\n' +
      'Expected: export const parser = { name, accepts, buildPanel(container, onTurtleChanged) }',
    )
  }
  if (!candidate.name) {
    throw new Error('DataLoader must have a non-empty name field.')
  }
  if (!Array.isArray(candidate.accepts) || candidate.accepts.length === 0) {
    throw new Error('DataLoader must declare at least one file extension in `accepts`.')
  }

  registerLoader(candidate)
  return candidate
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
