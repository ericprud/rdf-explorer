/**
 * loader-panels.ts
 *
 * Hosts the per-loader sidebar panels.  Each GraphSource is responsible for
 * building its own panel DOM via `loader.buildPanel(container, applyGraph)`.
 * This module manages the container element and the registry-change subscription.
 */

import type { GraphSource, ApplyGraphCallback } from '@modular-rdf/graph-source-api'
import { TYPE_COLORS, TYPE_RADII, HULL_FILLS }    from '@modular-rdf/pane-graph'
import { resolveTypeKeys }                         from '@modular-rdf/rdf-utils'

export type { ApplyGraphCallback }

/**
 * (Re)build all loader panels inside `container`.
 *
 * For each loader, creates a wrapper div, calls `loader.buildPanel()`, then
 * immediately pushes `baseIri` via `loader.setBaseIri()` so the panel starts
 * with the same base IRI that main.ts is currently using.
 * `applyGraph` is forwarded to each loader so they can notify the host
 * when their RDF output changes.
 */
export function buildLoaderPanels(
  loaders:     GraphSource[],
  container:   HTMLElement,
  applyGraph:  ApplyGraphCallback,
  baseIri:     string,
): void {
  container.innerHTML = ''

  if (loaders.length === 0) {
    const hint = document.createElement('div')
    hint.className    = 'mono text-xs text-muted'
    hint.style.padding = '8px 0'
    hint.textContent  = 'Drop a .js loader module onto "Load" to add a data source.'
    container.appendChild(hint)
    return
  }

  for (const loader of loaders) {
    const wrapper = document.createElement('div')
    wrapper.className = 'loader-panel-wrapper'
    wrapper.setAttribute('data-loader-name', loader.name)
    container.appendChild(wrapper)
    // Delegate all DOM construction (drop-zone, controls) to the loader itself
    loader.buildPanel(wrapper, applyGraph)
    loader.setBaseIri?.(baseIri)
    const pfx  = loader.prefixes ?? {}
    const rp   = loader.renderingPreferences
    if (rp?.typeColors) Object.assign(TYPE_COLORS, resolveTypeKeys(rp.typeColors, pfx))
    if (rp?.typeRadii)  Object.assign(TYPE_RADII,  resolveTypeKeys(rp.typeRadii,  pfx))
    if (rp?.hullFills)  Object.assign(HULL_FILLS,  resolveTypeKeys(rp.hullFills,  pfx))
  }
}
