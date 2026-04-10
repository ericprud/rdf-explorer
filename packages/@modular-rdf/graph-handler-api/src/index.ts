/**
 * @modular-rdf/graph-handler-api
 *
 * A GraphHandler defines a pluggable pane in the RDF Explorer UI.
 *
 * LIFECYCLE
 * ─────────
 * 1. The host calls `handler.mount(container)` once to render the pane's DOM.
 * 2. The host calls `handler.update(state)` whenever application state changes.
 * 3. If the user drops a .js file that exports a valid GraphHandler, the host
 *    registers it and mounts it as a new pane tab.
 *
 * STATE
 * ─────
 * `HandlerState` is the read-only snapshot the host passes on each update.
 * Handlers must not mutate it.
 *
 * CALLBACKS
 * ─────────
 * `HandlerCallbacks` is the set of host-provided functions a handler may call
 * to trigger side-effects (navigation, Turtle edits, toasts, etc.).
 */

import type * as N3 from 'n3'

// ── Shared state snapshot ────────────────────────────────────────────────────

/**
 * Read-only snapshot of the application state delivered on each update.
 *
 * Only the canonical, pane-agnostic fields are included:
 * - `store` is the parsed N3 quad store — the authoritative RDF representation.
 *   Handlers wanting triples, labels, or type info should read from it directly.
 * - `turtle`, `graph` (D3), and `selectedTypes` (ShEx) are intentionally absent:
 *   they are internal state of specific built-in panes, not shared concerns.
 */
export interface HandlerState {
  /** Parsed N3 quad store (null until a valid Turtle has been loaded). */
  store:      N3.Store | null
  /** N3 prefix map from the parsed Turtle: { prefixLabel → namespaceUri }. */
  prefixes:   Record<string, string>
  /** rdfs:label map: full IRI → label string. */
  rdfsLabels: Map<string, string>
  /** Current base IRI for relative-IRI resolution. */
  baseIri:    string
  /** Current label display mode ('segment' | 'local' | 'full' | 'rdfs'). */
  labelMode:  string
}

// ── Host callbacks available to handlers ────────────────────────────────────

export interface HandlerCallbacks {
  /** Display a toast notification. */
  toast(message: string, kind?: 'info' | 'success' | 'error'): void
  /** Replace the current Turtle with new content and re-run the pipeline. */
  applyTurtle(turtle: string, filename?: string): void
  /** Switch the active pane tab by name (e.g. 'turtle', 'graph'). */
  switchTab(name: string): void
  /** Navigate the graph view to show a specific node. */
  showNode?(nodeId: string): void
}

// ── GraphHandler interface ───────────────────────────────────────────────────

export interface GraphHandler {
  /**
   * Short identifier used as the tab label and unique key.
   * Must be unique across all registered handlers.
   */
  name: string

  /**
   * Tab display label shown to the user.  Defaults to `name` if omitted.
   */
  label?: string

  /**
   * Mount the handler's DOM into `container`.
   * Called exactly once after registration.
   * The handler owns `container` and may mutate it freely.
   *
   * @param container  Empty div that the host provides for this pane.
   * @param callbacks  Host callbacks the handler may invoke.
   */
  mount(container: HTMLElement, callbacks: HandlerCallbacks): void

  /**
   * Called by the host whenever relevant application state changes:
   * - A new Turtle file is loaded.
   * - The user edits the Turtle source.
   * - The base IRI changes.
   * - The label mode changes.
   *
   * Handlers should re-render only the parts of their UI that depend on the
   * changed state.  The host does NOT diff the state — it is the handler's
   * responsibility to avoid unnecessary work.
   */
  update(state: HandlerState): void

  /**
   * Optional: called when the user switches to this pane's tab.
   * Use this for deferred layout work (e.g. CodeMirror requestMeasure).
   */
  onActivate?(): void

  /**
   * Optional: called when the handler is removed from the registry
   * (e.g. user replaces it with an updated version).
   * Use this to tear down timers, workers, etc.
   */
  destroy?(): void
}
