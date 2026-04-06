/**
 * label-mode.ts
 *
 * Four label display modes for IRIs, available everywhere the app renders
 * node or predicate names (graph node labels, validation rows, sidebar list,
 * node-detail panel).
 *
 * MODE DESCRIPTIONS
 * ─────────────────
 *  'full'      Full IRI, angle-bracket wrapped: <https://…/Resource/TXT/…>
 *  'prefixed'  Prefixed name using prefixes from the loaded Turtle: ex:Resource
 *  'label'     rdfs:label if available, else falls back to 'prefixed'
 *  'segment'   URL-decoded IRI tail segments, enough to be locally unique.
 *              e.g. <…/Bar/Some%20Topic/KIND/Text>
 *              renders as "Some Topic · KIND · Text"
 *              The separator is SEGMENT_SEP (configurable below).
 *
 * SEGMENT MODE ALGORITHM
 * ──────────────────────
 * 1. Strip the scheme+authority prefix up to the first path separator after
 *    the last '/' that ends a well-known namespace.
 * 2. Split the remaining path on '/' and '%2F', decode each segment.
 * 3. Drop empty, numeric-only, or single-character segments.
 * 4. Keep the last N segments where N is chosen so the result is at most
 *    SEGMENT_MAX_PARTS segments long.
 * 5. Join with SEGMENT_SEP.
 *
 * The result for <https://example.org/foo/Bar/Some%20Topic/KIND/Text>
 * is "Bar · Some Topic · KIND · Text" (4 parts) and for
 * <https://example.org/foo/Resource/TXT/Some/More/Stuff>
 * is "Resource · TXT · Some · More · Stuff" (5 parts).
 *
 * Both examples share only "KIND" in the last segment, so the shorter
 * single-segment form would be ambiguous.  The algorithm automatically uses
 * enough segments to fill up to SEGMENT_MAX_PARTS — callers can adjust the
 * constant to taste.
 */

// ── Configurable constants ───────────────────────────────────────────────────
/** Separator inserted between IRI path segments in 'segment' mode. */
export const SEGMENT_SEP      = ' \u00B7 '   // ' · '
/** Maximum number of path segments to include in 'segment' mode. */
export const SEGMENT_MAX_PARTS = 4

// ── Types ────────────────────────────────────────────────────────────────────
export type LabelMode = 'full' | 'prefixed' | 'label' | 'segment'

export const LABEL_MODES: LabelMode[] = ['full', 'prefixed', 'label', 'segment']

export const LABEL_MODE_NAMES: Record<LabelMode, string> = {
  full:     'Full IRI',
  prefixed: 'Prefixed name',
  label:    'rdfs:label',
  segment:  'IRI segments',
}

// ── Core labelling function ──────────────────────────────────────────────────
/**
 * Return a display label for `iri` under the current mode.
 *
 * @param iri       Full IRI string to label.
 * @param mode      Which labelling strategy to apply.
 * @param prefixes  Prefix map from the loaded Turtle (uri → prefix, e.g. "https://…#" → "ex").
 * @param labels    Optional map of IRI → rdfs:label value (for 'label' mode).
 */
export function labelIri(
  iri:      string,
  mode:     LabelMode,
  prefixes: Record<string, string>,
  labels?:  Map<string, string>,
): string {
  switch (mode) {
    case 'full':
      return `<${iri}>`

    case 'prefixed':
      return prefixedName(iri, prefixes)

    case 'label': {
      const lbl = labels?.get(iri)
      return lbl ?? prefixedName(iri, prefixes)
    }

    case 'segment':
      return iriSegments(iri, prefixes)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const WELL_KNOWN: Record<string, string> = {
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#': 'rdf',
  'http://www.w3.org/2000/01/rdf-schema#':        'rdfs',
  'http://www.w3.org/2001/XMLSchema#':            'xsd',
  'http://xmlns.com/foaf/0.1/':                   'foaf',
  'http://www.w3.org/2002/07/owl#':               'owl',
  'https://example.org/knows#':                   'knows',
}

function prefixedName(iri: string, pfxs: Record<string, string>): string {
  // User-supplied prefixes first, then well-known
  for (const [uri, pfx] of Object.entries(pfxs)) {
    if (iri.startsWith(uri)) return `${pfx}:${iri.slice(uri.length)}`
  }
  for (const [uri, pfx] of Object.entries(WELL_KNOWN)) {
    if (iri.startsWith(uri)) return `${pfx}:${iri.slice(uri.length)}`
  }
  // Fragment or final path component as minimal fallback
  const m = iri.match(/[/#]([^/#]+)$/)
  return m ? decodeURIComponent(m[1]) : iri
}

/**
 * Produce a short human-readable label from an IRI by taking its decoded
 * path segments, filtering noise, and joining with SEGMENT_SEP.
 *
 * Strategy:
 *  1. Find the "interesting" part: everything after the longest matching
 *     well-known or user namespace prefix.  If nothing matches, use
 *     everything after the last ':' (strips scheme).
 *  2. Split on '/' (encoded or literal).
 *  3. Decode each segment; drop empty, very short (≤1 char), or purely
 *     numeric segments.
 *  4. Take up to SEGMENT_MAX_PARTS segments from the end.
 *  5. Join with SEGMENT_SEP.
 */
function iriSegments(iri: string, pfxs: Record<string, string> = {}): string {
  // Strip the namespace prefix to find the local part.
  // Try user-supplied prefixes first (longest URI wins), then well-known.
  let local = iri
  const allUris = [
    ...Object.keys(pfxs),
    ...Object.keys(WELL_KNOWN),
  ].sort((a, b) => b.length - a.length)   // longest first → most specific wins
  for (const uri of allUris) {
    if (iri.startsWith(uri)) { local = iri.slice(uri.length); break }
  }
  // If no prefix matched, strip scheme+authority
  if (local === iri) {
    const afterScheme = iri.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')
    local = afterScheme.replace(/^\//, '')
  }

  const rawSegments = local.split(/\/|%2F/i)
  const segments = rawSegments
    .map(s => { try { return decodeURIComponent(s) } catch { return s } })
    .filter(s => s.length > 1 && !/^\d+$/.test(s))

  if (segments.length === 0) {
    // Nothing useful — fall back to final component of original IRI
    const m = iri.match(/[/#]([^/#]+)$/)
    return m ? decodeURIComponent(m[1]) : iri
  }

  // Take up to SEGMENT_MAX_PARTS from the end
  const parts = segments.slice(-SEGMENT_MAX_PARTS)
  return parts.join(SEGMENT_SEP)
}
