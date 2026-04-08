/**
 * Resolve prefixed-name or angle-bracket IRI keys in a Record to full IRIs.
 *
 * Supported key formats:
 *   <http://example.org/Foo>  →  http://example.org/Foo   (strip angle brackets)
 *   foaf:Person               →  http://xmlns.com/foaf/0.1/Person  (expand prefix)
 *   http://example.org/Foo    →  unchanged (already a full IRI)
 *   default                   →  unchanged (sentinel key)
 */
export function resolveTypeKeys<V>(
  record:   Record<string, V>,
  prefixes: Record<string, string>,   // prefix label → namespace URI
): Record<string, V> {
  const out: Record<string, V> = {}
  for (const [key, val] of Object.entries(record)) {
    if (key === 'default') { out[key] = val; continue }

    // <iri> form
    if (key.startsWith('<') && key.endsWith('>')) {
      out[key.slice(1, -1)] = val
      continue
    }

    // prefix:local form — but not http(s):// URIs
    const colon = key.indexOf(':')
    if (colon > 0 && !key.startsWith('http')) {
      const pfx = key.slice(0, colon)
      const ns  = prefixes[pfx]
      if (ns) {
        out[ns + key.slice(colon + 1)] = val
      } else {
        console.warn(`resolveTypeKeys: unknown prefix "${pfx}" in key "${key}" — keeping as-is`)
        out[key] = val
      }
      continue
    }

    // Already a full IRI (or unknown format) — pass through
    out[key] = val
  }
  return out
}
