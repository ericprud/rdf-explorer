/**
 * @modular-rdf/api-graph-handler
 *
 * A GraphHandler defines a pluggable pane in the RDF Explorer UI.
 *
 * LIFECYCLE
 * ─────────
 * 1. The host calls `handler.mount(container)` once to render the pane's DOM.
 * 2. The host calls `handler.update(state)` whenever application state changes.
 * 3. If the handler declares `updateText`, the host also calls it with the
 *    current text form (Turtle/TriG) whenever it changes.
 * 4. If the user drops a .js file that exports a valid GraphHandler, the host
 *    registers it and mounts it as a new pane tab.
 *
 * STATE
 * ─────
 * `HandlerState` carries only the pane-agnostic canonical fields.
 * `turtle`, `graph` (D3), and `selectedTypes` (ShEx) are intentionally absent —
 * they are internal state of specific built-in panes, not shared concerns.
 *
 * CALLBACKS
 * ─────────
 * `HandlerCallbacks` is the set of host-provided functions a handler may call
 * to trigger side-effects.  `applyGraph` mirrors the same callback type that
 * GraphSources use, so any handler can push new RDF into the pipeline.
 */

import type { ApplyGraphInput, DatasetCore } from '@modular-rdf/api-graph-source'
export type { ApplyGraphInput, ApplyGraphCallback, ApplyGraphText, ApplyGraphStore,
              Term, Quad, DatasetCore, ResolverContext } from '@modular-rdf/api-graph-source'

// ── Shared state snapshot ────────────────────────────────────────────────────

/**
 * Read-only snapshot of the application state delivered on each update.
 * Handlers must not mutate it.
 */
export interface HandlerState {
  /** Parsed RDF dataset (null until data has been loaded). N3.Store satisfies this. */
  store:      DatasetCore | null
  /** Prefix map from the parsed source: { prefixLabel → namespaceUri }. */
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
  /**
   * Push new RDF into the host pipeline — identical to what a GraphSource
   * calls.  Accepts Turtle/TriG text or a pre-parsed RDF/JS dataset.
   */
  applyGraph(input: ApplyGraphInput): void
  /** Switch the active pane tab by name (e.g. 'turtle', 'graph'). */
  switchTab(name: string): void
  /** Navigate the graph view to show a specific node. */
  showNode?(nodeId: string): void
  /**
   * Scroll the active pane to highlight the first occurrence of the given IRI.
   * Routes to the active handler's focusTerm() method.
   */
  focusTerm(iri: string): void
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
   * Called by the host whenever application state changes.
   * Handlers should re-render only the parts of their UI that changed.
   */
  update(state: HandlerState): void

  /**
   * Optional: called by the host with the text form of the current RDF graph
   * (Turtle or TriG) whenever it changes.
   * If the source delivered an RDF/JS dataset, the host serialises to Turtle
   * before calling this.
   * Implement this to receive raw source text (e.g. a Turtle editor pane).
   */
  updateText?(text: string, format?: 'turtle' | 'trig', filename?: string): void

  /**
   * Optional: called when the user switches to this pane's tab.
   * The handler receives the bottom sidebar container and may populate it.
   * Use this for deferred layout work (e.g. CodeMirror requestMeasure) and
   * to fill the sidebar with pane-specific controls (node list, filters, etc.).
   */
  onActivate?(sidebarEl: HTMLElement): void

  /**
   * Optional: called when the user leaves this pane's tab.
   * Use this to clear any pane-specific sidebar content.
   */
  onDeactivate?(): void

  /**
   * Optional: scroll the pane to highlight the first occurrence of the IRI.
   * Graph: ensure the node is visible and highlight it.
   * Turtle: scroll to and select the first occurrence of the IRI text.
   * SPARQL: scroll to the first result row mentioning the IRI.
   * ShEx: scroll to the shape used to validate nodes of this type.
   * Inference: scroll to the first inference involving this IRI.
   */
  focusTerm?(iri: string): void

  /**
   * Optional: called when the handler is removed from the registry.
   * Use this to tear down timers, workers, etc.
   */
  destroy?(): void
}
