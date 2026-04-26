/**
 * module-loader.ts
 *
 * Load an ES module from a URL and auto-detect whether it exports a
 * GraphHandler, a GraphSource, or both.
 *
 * Detection rules (checked in order, first match wins for each role):
 *   GraphHandler → named export `handler` or default — has .mount(), .update(), .name
 *   GraphSource  → named export `source` or default — has .buildPanel(), .name, .accepts
 *
 * A single module can satisfy both roles (e.g. the Turtle pane is both a
 * handler and a source).
 */

import type { GraphHandler } from '@modular-rdf/api-graph-handler'
import type { GraphSource } from '@modular-rdf/api-graph-source'

export interface LoadedModule {
  handler?: GraphHandler
  source?:  GraphSource
}

function isGraphHandler(obj: unknown): obj is GraphHandler {
  if (!obj || typeof obj !== 'object') return false
  const h = obj as Record<string, unknown>
  return typeof h['name'] === 'string' && h['name'].length > 0
      && typeof h['mount'] === 'function'
      && typeof h['update'] === 'function'
}

function isGraphSource(obj: unknown): obj is GraphSource {
  if (!obj || typeof obj !== 'object') return false
  const s = obj as Record<string, unknown>
  return typeof s['name'] === 'string' && s['name'].length > 0
      && Array.isArray(s['accepts'])
      && typeof s['buildPanel'] === 'function'
}

function pick(mod: Record<string, unknown>, result: LoadedModule): void {
  // Named exports by convention
  if (!result.handler && isGraphHandler(mod['handler'])) result.handler = mod['handler'] as GraphHandler
  if (!result.source  && isGraphSource(mod['source']))   result.source  = mod['source']  as GraphSource

  // Default export — could be either
  const def = mod['default']
  if (def && typeof def === 'object') {
    if (!result.handler && isGraphHandler(def)) result.handler = def as GraphHandler
    if (!result.source  && isGraphSource(def))  result.source  = def as GraphSource
  }

  // Fallback: scan all remaining named exports
  for (const val of Object.values(mod)) {
    if (!result.handler && isGraphHandler(val)) result.handler = val as GraphHandler
    if (!result.source  && isGraphSource(val))  result.source  = val as GraphSource
  }
}

/**
 * Dynamically import a module from `url`, detect its roles, and return
 * whatever GraphHandler / GraphSource exports it provides.
 * Throws if neither role is detected.
 */
export async function loadModuleFromUrl(url: string): Promise<LoadedModule> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await import(/* @vite-ignore */ url) as Record<string, unknown>
  const result: LoadedModule = {}
  pick(mod, result)
  if (!result.handler && !result.source) {
    throw new Error(
      'Module exports no recognisable GraphHandler or GraphSource.\n' +
      'Expected: export const handler = { name, mount, update } or ' +
      'export const source = { name, accepts, buildPanel }',
    )
  }
  return result
}
