/**
 * URL-hash view-state — encode/decode + history push/read.
 *
 * Extracted from graph-store.ts so it can be shared across packages.
 */

export interface ViewState {
  regex:    string
  pinned:   string[]
  expanded: string[]
  group:    string
}

export function encodeViewState(vs: ViewState): string {
  try { return btoa(encodeURIComponent(JSON.stringify(vs))) } catch { return '' }
}

export function decodeViewState(hash: string): ViewState | null {
  try { return JSON.parse(decodeURIComponent(atob(hash))) as ViewState } catch { return null }
}

export function pushHistory(vs: ViewState): void {
  const enc = encodeViewState(vs)
  if (enc && location.hash.slice(1) !== enc) history.pushState(null, '', '#' + enc)
}

export function readHistory(): ViewState {
  return decodeViewState(location.hash.slice(1)) ??
    { regex: '', pinned: [], expanded: [], group: 'type' }
}
