/**
 * Loader / Parser API  (v4)
 *
 * A DataLoader converts files to Turtle and optionally owns UI controls
 * rendered inside its sidebar panel.
 *
 * TURTLE CALLBACK
 * ───────────────
 * After parsing, or when internal state changes (e.g. a vocab-toggle or a
 * base-IRI change), the loader calls `onTurtleChanged(turtle)`.
 *
 * BASE IRI
 * ────────
 * If a loader supports re-serialising with a different base IRI, it implements
 * the optional `setBaseIri(iri)` method.  The host calls this whenever the
 * user changes the base IRI input.  The loader stores the IRI, re-runs its
 * last parse, and calls `onTurtleChanged` with the new output.
 *
 * PANEL ELEMENT
 * ─────────────
 * `buildPanel(container, onTurtleChanged)` is called once by the host.
 */

export interface ParseResult {
  turtle:      string
  warnings:    string[]
  sheetsSeen:  string[]
  tripleCount: number
  timestamp:   string
  fileHash:    string
}

/** Callback the host supplies; called whenever the loader has new Turtle. */
export type TurtleChangedCallback = (turtle: string) => void

export interface DataLoader {
  /** Short label shown as the drop-zone title. Required. */
  name: string

  /** One-line hint shown below the title. Optional. */
  description?: string

  /** File extensions accepted, e.g. ['.foo', '.bar']. Required. */
  accepts: string[]

  /**
   * Build the sidebar panel DOM inside `container`.
   * Call `onTurtleChanged` after every parse and after any state change
   * that produces new Turtle (vocab toggle, base IRI change, etc.).
   * Called once per loader registration.
   */
  buildPanel(container: HTMLElement, onTurtleChanged: TurtleChangedCallback): void

  /**
   * Optional: parse a raw file buffer and return a ParseResult.
   * Used by loader implementations and tests; not called by the host directly
   * (the host calls buildPanel which wires up drag-drop / file-input).
   */
  parse?(buffer: ArrayBuffer): Promise<ParseResult>

  /**
   * Optional: update the base IRI used for relative-IRI resolution and
   * re-emit Turtle.  Called by the host when the user changes the base IRI.
   * Loaders that do not implement this simply ignore base IRI changes.
   */
  setBaseIri?(baseIri: string): void

  /**
   * Prefix map used to expand typeColors / typeRadii / hullFills keys.
   * Format: { prefixLabel: namespaceUri }
   * e.g. { foaf: 'http://xmlns.com/foaf/0.1/', ex: 'https://example.org/knows#' }
   * These prefixes are also prepended as @prefix declarations to the Turtle
   * output by the host, so loaders need not embed them in the turtle string.
   */
  prefixes?: Record<string, string>

  /**
   * Map from type IRI (or prefixed name / <iri>) to a CSS hex colour.
   * Resolved against `prefixes` before being merged into the global TYPE_COLORS.
   * e.g. { 'foaf:Person': '#4f9cf9', '<http://schema.org/Event>': '#f97316' }
   */
  typeColors?: Record<string, string>

  /**
   * Map from type IRI (or prefixed name / <iri>) to a node radius in pixels.
   * Resolved the same way as typeColors.
   */
  typeRadii?: Record<string, number>

  /**
   * Map from type IRI (or prefixed name / <iri>) to a convex-hull CSS fill.
   * Resolved the same way as typeColors.
   */
  hullFills?: Record<string, string>
}

/** @deprecated Use DataLoader */
export type SpreadsheetParser = DataLoader
