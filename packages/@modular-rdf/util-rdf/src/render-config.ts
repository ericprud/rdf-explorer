/**
 * Rendering-preference utilities shared between the main bundle and pane-graph.
 *
 * These live in util-rdf (not pane-graph) so the main bundle can use them
 * without importing the graph pane, which is always loaded externally.
 */

const REX_NS = 'https://github.com/ericprud/rdf-explorer/ns#'
const XSD_NS = 'http://www.w3.org/2001/XMLSchema#'

/**
 * Produce { prefixLabel → nsUri } from the mixed-format prefixes map that
 * main.ts carries.  The map can contain entries in two opposite directions:
 *  - WELL_KNOWN entries:  nsUri  → prefixLabel  (inverted)
 *  - N3 parser output:    prefixLabel → nsUri    (normal)
 */
export function normalisePrefixes(mixed: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(mixed)) {
    if (k.startsWith('http')) {
      out[v] = k  // invert WELL_KNOWN style
    } else {
      out[k] = v  // keep N3 style
    }
  }
  return out
}

/** Expand a compact IRI or angle-bracket IRI using a { prefixLabel → nsUri } map. */
function expandId(id: string, pfxMap: Record<string, string>): string {
  if (id.startsWith('<') && id.endsWith('>')) return id.slice(1, -1)
  const colon = id.indexOf(':')
  if (colon > 0 && !id.startsWith('http')) {
    const ns = pfxMap[id.slice(0, colon)]
    if (ns) return ns + id.slice(colon + 1)
  }
  return id
}

export interface RenderConfig {
  typeColors: Record<string, string>
  typeRadii:  Record<string, number>
  hullFills:  Record<string, string>
}

/**
 * Parse a JSON-LD render-config object (as produced by pane-graph's
 * buildRenderConfigJsonLd) back into typed records with full-IRI keys.
 * Returns null if the object is not recognisable as a render config.
 */
export function parseRenderConfigJsonLd(jsonld: unknown): RenderConfig | null {
  if (!jsonld || typeof jsonld !== 'object') return null
  const doc = jsonld as Record<string, unknown>
  const graph = doc['@graph']
  if (!Array.isArray(graph) || graph.length === 0) return null

  const ctx = doc['@context'] ?? {}
  const pfxMap: Record<string, string> = {}
  if (ctx && typeof ctx === 'object') {
    for (const [k, v] of Object.entries(ctx as Record<string, unknown>)) {
      if (k === 'rex') { pfxMap['rex'] = REX_NS; continue }
      if (k === 'xsd') { pfxMap['xsd'] = XSD_NS; continue }
      if (typeof v === 'string' && v.startsWith('http')) pfxMap[k] = v
    }
  }

  const typeColors: Record<string, string> = {}
  const typeRadii:  Record<string, number>  = {}
  const hullFills:  Record<string, string>  = {}

  const COLOR_KEYS  = ['typeColor',  `${REX_NS}typeColor`]
  const RADIUS_KEYS = ['typeRadius', `${REX_NS}typeRadius`]
  const HULL_KEYS   = ['hullFill',   `${REX_NS}hullFill`]

  for (const entry of graph) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as Record<string, unknown>
    const rawId = e['@id']
    if (typeof rawId !== 'string') continue
    const iri = expandId(rawId, pfxMap)

    for (const key of COLOR_KEYS) {
      const v = e[key]
      if (typeof v === 'string') { typeColors[iri] = v; break }
    }
    for (const key of RADIUS_KEYS) {
      const v = e[key]
      if (typeof v === 'number') { typeRadii[iri] = v; break }
      if (typeof v === 'string') { const n = Number(v); if (!isNaN(n)) { typeRadii[iri] = n; break } }
      if (v && typeof v === 'object') {
        const val = (v as Record<string, unknown>)['@value']
        if (val !== undefined) { const n = Number(val); if (!isNaN(n)) { typeRadii[iri] = n; break } }
      }
    }
    for (const key of HULL_KEYS) {
      const v = e[key]
      if (typeof v === 'string') { hullFills[iri] = v; break }
    }
  }

  if (!Object.keys(typeColors).length && !Object.keys(typeRadii).length && !Object.keys(hullFills).length)
    return null

  return { typeColors, typeRadii, hullFills }
}
