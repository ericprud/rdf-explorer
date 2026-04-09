/**
 * Normalise type-key formats in a Record so keys match what graph-store's
 * shortIri() produces when building node.types.
 *
 * shortIri() shortens well-known-prefix IRIs to "prefix:local" (e.g. foaf:Person)
 * and falls back to just the local name for any namespace it doesn't recognise
 * (e.g. "ManufacturingSite" for https://example.org/siteDNA#ManufacturingSite).
 *
 * Supported input key formats:
 *   <http://example.org/Foo>  →  http://example.org/Foo   (strip angle brackets;
 *                                  remains a full IRI — only useful if you later
 *                                  fix graph-store to use full-IRI keys)
 *   <LocalName>               →  LocalName   (bare local name after stripping <>)
 *   foaf:Person               →  foaf:Person (kept as-is; matches shortIri output
 *                                  for WELL_KNOWN prefixes like foaf/rdf/rdfs/xsd)
 *   ManufacturingSite         →  ManufacturingSite (pass through)
 *   default                   →  default     (sentinel key, pass through)
 *
 * The `prefixes` parameter is accepted for API consistency but is intentionally
 * NOT used for expansion: expanding prefix:local to full IRIs would break the
 * match against node.types which always uses short forms.
 */
export function resolveTypeKeys<V>(
  record:   Record<string, V>,
  _prefixes: Record<string, string>,   // reserved for future use
): Record<string, V> {
  const out: Record<string, V> = {}
  for (const [key, val] of Object.entries(record)) {
    // Strip angle brackets: <LocalName> → LocalName, <http://…> → http://…
    if (key.startsWith('<') && key.endsWith('>')) {
      out[key.slice(1, -1)] = val
    } else {
      out[key] = val
    }
  }
  return out
}
