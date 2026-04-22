/**
 * Expand type-key formats in a Record to full IRIs so keys match the full-IRI
 * values stored in node.types by graph-store's parseTurtleToGraph().
 *
 * Supported input key formats → output:
 *   foaf:Person               →  http://xmlns.com/foaf/0.1/Person  (prefix:local expanded via prefixes map)
 *   <http://example.org/Foo>  →  http://example.org/Foo            (angle brackets stripped)
 *   http://example.org/Foo    →  http://example.org/Foo            (pass-through)
 *   default                   →  default                           (sentinel, pass-through)
 *
 * @param record    The Record whose keys may be in any of the above formats.
 * @param prefixes  { prefixLabel → namespaceUri } map from the loader
 *                  (e.g. { foaf: 'http://xmlns.com/foaf/0.1/' }).
 */
export function resolveTypeKeys<V>(
  record:   Record<string, V>,
  prefixes: Record<string, string>,
): Record<string, V> {
  const out: Record<string, V> = {}
  for (const [key, val] of Object.entries(record)) {
    // Sentinel — never try to expand
    if (key === 'default') { out[key] = val; continue }

    // <iri> — strip angle brackets, leave as full IRI
    if (key.startsWith('<') && key.endsWith('>')) {
      out[key.slice(1, -1)] = val; continue
    }

    // Already a full IRI
    if (key.startsWith('http://') || key.startsWith('https://')) {
      out[key] = val; continue
    }

    // prefix:local — expand via the supplied prefix map
    const colon = key.indexOf(':')
    if (colon > 0) {
      const pfx = key.slice(0, colon)
      const ns  = prefixes[pfx]
      if (ns) { out[ns + key.slice(colon + 1)] = val; continue }
    }

    // Unknown format — pass through as-is
    out[key] = val
  }
  return out
}
