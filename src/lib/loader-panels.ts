/**
 * loader-panels.ts
 *
 * Hosts the per-loader sidebar panels.  Each DataLoader is responsible for
 * building its own panel DOM via `loader.buildPanel(container, onTurtleChanged)`.
 * This module manages the container element and the registry-change subscription.
 */

import type { DataLoader, TurtleChangedCallback } from './parser-api'
import { TYPE_COLORS, TYPE_RADII, HULL_FILLS }    from '../components/graph-view'
import { resolveTypeKeys }                         from './resolve-type-keys'

export type { TurtleChangedCallback }

/**
 * (Re)build all loader panels inside `container`.
 *
 * For each loader, creates a wrapper div and calls `loader.buildPanel()`.
 * `onTurtleChanged` is forwarded to each loader so they can notify the host
 * when their turtle output changes.
 */
export function buildLoaderPanels(
  loaders:          DataLoader[],
  container:        HTMLElement,
  onTurtleChanged:  TurtleChangedCallback,
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
    loader.buildPanel(wrapper, onTurtleChanged)
    const pfx = loader.prefixes ?? {}
    if (loader.typeColors) Object.assign(TYPE_COLORS, resolveTypeKeys(loader.typeColors, pfx))
    if (loader.typeRadii)  Object.assign(TYPE_RADII,  resolveTypeKeys(loader.typeRadii,  pfx))
    if (loader.hullFills)  Object.assign(HULL_FILLS,  resolveTypeKeys(loader.hullFills,  pfx))
  }
}
