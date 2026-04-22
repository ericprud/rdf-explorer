/**
 * @modular-rdf/graph-source-api  (v5)
 *
 * A GraphSource converts files to RDF and optionally owns UI controls
 * rendered inside its sidebar panel.
 *
 * APPLY-GRAPH CALLBACK
 * ────────────────────
 * After parsing, or when internal state changes (e.g. a vocab-toggle or a
 * base-IRI change), the source calls `applyGraph(input)` with either:
 *   • `{ text, format?, filename? }` — Turtle or TriG source text; the host
 *     handles parsing, prefix extraction, and fan-out to all panes.
 *   • `{ store, ctx? }` — a pre-parsed RDF/JS dataset; the host uses `ctx`
 *     for prefix/base context and serialises to text for text-wanting panes.
 *
 * BASE IRI
 * ────────
 * If a source supports re-serialising with a different base IRI, it implements
 * the optional `setBaseIri(iri)` method.  The host calls this whenever the
 * user changes the base IRI input.
 *
 * PANEL ELEMENT
 * ─────────────
 * `buildPanel(container, applyGraph)` is called once by the host.
 */

// ── RDF/JS standard types (re-exported from @rdfjs/types) ───────────────────
// Term   = NamedNode | BlankNode | Literal | Variable | DefaultGraph | BaseQuad
// BaseQuad has subject/predicate/object/graph; N3.Quad satisfies it.
// DatasetCore<Q> is the standard dataset interface; N3.Store satisfies DatasetCore<Quad>.

import type { DatasetCore } from '@rdfjs/types'
export type { Term, BaseQuad, DatasetCore } from '@rdfjs/types'

// ── Resolver context ─────────────────────────────────────────────────────────

/**
 * BASE and PREFIX declarations that accompany a pre-parsed RDF dataset.
 * Analogous to what a Turtle parser would extract from the source text.
 */
export interface ResolverContext {
  /** Base IRI for relative-IRI resolution (analogous to @base in Turtle). */
  base?:     string
  /** Prefix declarations: { prefixLabel → namespaceUri } */
  prefixes?: Record<string, string>
}

// ── applyGraph input types ────────────────────────────────────────────────────

/** Source delivers Turtle or TriG text; the host parses it. */
export interface ApplyGraphText {
  text:      string
  format?:   'turtle' | 'trig'
  /** Optional filename hint for the host UI (cache badge, download name). */
  filename?: string
}

/** Source delivers a pre-parsed RDF/JS dataset. */
export interface ApplyGraphStore {
  store: DatasetCore
  /** BASE and PREFIX context for label shortening and re-serialisation. */
  ctx?:  ResolverContext
}

export type ApplyGraphInput = ApplyGraphText | ApplyGraphStore

/**
 * Callback the host supplies to each GraphSource.
 * Call with text (Turtle/TriG) or a pre-parsed RDF/JS dataset.
 */
export type ApplyGraphCallback = (input: ApplyGraphInput) => void

// ── ParseResult ───────────────────────────────────────────────────────────────

export interface ParseResult {
  turtle:      string
  warnings:    string[]
  sheetsSeen:  string[]
  tripleCount: number
  timestamp:   string
  fileHash:    string
}

// ── GraphSource ───────────────────────────────────────────────────────────────

export interface GraphSource {
  /** Short label shown as the drop-zone title. Required. */
  name: string

  /** One-line hint shown below the title. Optional. */
  description?: string

  /** File extensions accepted, e.g. ['.foo', '.bar']. Required. */
  accepts: string[]

  /**
   * Build the sidebar panel DOM inside `container`.
   * Call `applyGraph` after every parse and after any state change that
   * produces new RDF (vocab toggle, base IRI change, etc.).
   * Called once per source registration.
   */
  buildPanel(container: HTMLElement, applyGraph: ApplyGraphCallback): void

  /**
   * Optional: parse a raw file buffer and return a ParseResult.
   * Used by source implementations and tests; not called by the host directly.
   */
  parse?(buffer: ArrayBuffer): Promise<ParseResult>

  /**
   * Optional: update the base IRI used for relative-IRI resolution and
   * re-emit RDF.  Called by the host when the user changes the base IRI.
   */
  setBaseIri?(baseIri: string): void

  /**
   * Prefix map used to expand typeColors / typeRadii / hullFills keys.
   * Format: { prefixLabel: namespaceUri }
   */
  prefixes?: Record<string, string>

  /** Map from type IRI (or prefixed name / <iri>) to a CSS hex colour. */
  typeColors?: Record<string, string>

  /** Map from type IRI (or prefixed name / <iri>) to a node radius in pixels. */
  typeRadii?: Record<string, number>

  /** Map from type IRI (or prefixed name / <iri>) to a convex-hull CSS fill. */
  hullFills?: Record<string, string>
}
