/**
 * Serialise / parse the rdf-explorer rendering config as JSON-LD.
 *
 * The output format:
 * {
 *   "@context": {
 *     "rex": "https://github.com/ericprud/rdf-explorer/ns#",
 *     "xsd": "http://www.w3.org/2001/XMLSchema#",
 *     "typeColor": "rex:typeColor",
 *     "typeRadius": { "@id": "rex:typeRadius", "@type": "xsd:integer" },
 *     "hullFill": "rex:hullFill",
 *     "foaf": "http://xmlns.com/foaf/0.1/",
 *     ...  (other prefixes from current document)
 *   },
 *   "@graph": [
 *     { "@id": "foaf:Person", "typeColor": "#4f9cf9", "typeRadius": 10 },
 *     ...
 *   ]
 * }
 *
 * IRIs in @graph/@id are compacted using the prefix map wherever possible;
 * otherwise written as <full-iri>.
 *
 * Note on prefix formats
 * ─────────────────────
 * main.ts's `prefixes` variable is a mixed record whose entries come from two
 * sources with opposite key/value directions:
 *   • WELL_KNOWN (graph-store.ts): { nsUri → prefixLabel }
 *   • N3 parser output:            { prefixLabel → nsUri }
 * `normalisePrefixes()` below separates them and merges into a clean
 * { prefixLabel → nsUri } map for JSON-LD context use.
 */

const REX_NS  = 'https://github.com/ericprud/rdf-explorer/ns#'
const XSD_NS  = 'http://www.w3.org/2001/XMLSchema#'

/** Produce { prefixLabel → nsUri } from the mixed-format main.ts prefixes map. */
function normalisePrefixes(mixed: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(mixed)) {
    if (k.startsWith('http')) {
      // WELL_KNOWN style: k = nsUri, v = prefixLabel → invert
      out[v] = k
    } else {
      // N3 style: k = prefixLabel, v = nsUri → keep as-is
      out[k] = v
    }
  }
  return out
}

/** Compact an IRI to prefix:local using a { prefixLabel → nsUri } map. */
function compactIri(iri: string, pfxMap: Record<string, string>): string {
  for (const [pfx, ns] of Object.entries(pfxMap)) {
    if (iri.startsWith(ns)) return `${pfx}:${iri.slice(ns.length)}`
  }
  return `<${iri}>`
}

/**
 * Expand a JSON-LD @id value to a full IRI using a { prefixLabel → nsUri } map.
 * Handles: prefix:local, <iri>, and bare full IRIs.
 */
function expandId(id: string, pfxMap: Record<string, string>): string {
  if (id.startsWith('<') && id.endsWith('>')) return id.slice(1, -1)
  const colon = id.indexOf(':')
  if (colon > 0 && !id.startsWith('http')) {
    const pfx = id.slice(0, colon)
    const ns  = pfxMap[pfx]
    if (ns) return ns + id.slice(colon + 1)
  }
  return id  // already a full IRI or unrecognised
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface RenderConfig {
  typeColors: Record<string, string>
  typeRadii:  Record<string, number>
  hullFills:  Record<string, string>
}

/**
 * Build a JSON-LD object representing the current rendering config.
 *
 * @param typeColors  TYPE_COLORS map (full IRIs → hex)
 * @param typeRadii   TYPE_RADII map  (full IRIs → radius)
 * @param hullFills   HULL_FILLS map  (full IRIs → CSS color)
 * @param prefixes    main.ts `prefixes` variable (mixed WELL_KNOWN + N3 format)
 */
export function buildRenderConfigJsonLd(
  typeColors: Record<string, string>,
  typeRadii:  Record<string, number>,
  hullFills:  Record<string, string>,
  prefixes:   Record<string, string>,
): object {
  const pfxMap = normalisePrefixes(prefixes)

  // Collect all type IRIs that have any configured value (skip 'default', 'rdfs*')
  const allKeys = new Set([
    ...Object.keys(typeColors),
    ...Object.keys(typeRadii),
    ...Object.keys(hullFills),
  ].filter(k => k !== 'default' && !k.startsWith('rdfs')))

  const graph = [...allKeys].sort().map(iri => {
    const entry: Record<string, unknown> = { '@id': compactIri(iri, pfxMap) }
    if (typeColors[iri]) entry['typeColor'] = typeColors[iri]
    if (typeRadii[iri])  entry['typeRadius'] = typeRadii[iri]
    if (hullFills[iri])  entry['hullFill']   = hullFills[iri]
    return entry
  })

  const context: Record<string, unknown> = {
    rex:         REX_NS,
    xsd:         XSD_NS,
    typeColor:   'rex:typeColor',
    typeRadius:  { '@id': 'rex:typeRadius', '@type': 'xsd:integer' },
    hullFill:    'rex:hullFill',
    ...pfxMap,
  }
  // Remove rex and xsd from pfxMap echo (already declared above)
  delete (context as Record<string, unknown>)['rex']
  delete (context as Record<string, unknown>)['xsd']

  return { '@context': context, '@graph': graph }
}

/**
 * Parse a JSON-LD render-config object (as produced by buildRenderConfigJsonLd)
 * back into typed records with full IRI keys.
 * Returns null if the object is not recognisable as a render config.
 */
export function parseRenderConfigJsonLd(jsonld: unknown): RenderConfig | null {
  if (!jsonld || typeof jsonld !== 'object') return null
  const doc = jsonld as Record<string, unknown>

  const graph = doc['@graph']
  if (!Array.isArray(graph) || graph.length === 0) return null

  // Build prefix map from @context
  const ctx = doc['@context'] ?? {}
  const pfxMap: Record<string, string> = {}
  if (ctx && typeof ctx === 'object') {
    for (const [k, v] of Object.entries(ctx as Record<string, unknown>)) {
      if (k === 'rex')     { pfxMap['rex'] = REX_NS; continue }
      if (k === 'xsd')     { pfxMap['xsd'] = XSD_NS; continue }
      if (typeof v === 'string' && v.startsWith('http')) pfxMap[k] = v
      // 'rex:typeColor' etc. are term definitions, not prefixes — skip objects
    }
  }
  // Expand 'rex:' if present
  if (pfxMap['rex']) {
    for (const [k, v] of Object.entries(pfxMap)) {
      if (typeof v === 'string' && v.startsWith('rex:')) {
        pfxMap[k] = REX_NS + v.slice(4)
      }
    }
  }

  const typeColors: Record<string, string> = {}
  const typeRadii:  Record<string, number>  = {}
  const hullFills:  Record<string, string>  = {}

  // Property names to check (both compact and expanded forms)
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

  if (Object.keys(typeColors).length === 0 &&
      Object.keys(typeRadii).length  === 0 &&
      Object.keys(hullFills).length  === 0) return null

  return { typeColors, typeRadii, hullFills }
}
