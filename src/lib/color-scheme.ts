/**
 * Algorithmic color assignment for RDF type IRIs.
 *
 * Groups IRIs by namespace, assigns a base hue per group (evenly spaced around
 * 360°), then within each group orders types by greedy nearest-neighbour on
 * Jaccard similarity of their tokenised local names ("Hungarian notation").
 */

// ── IRI helpers ──────────────────────────────────────────────────────────────

/** Return the namespace portion of an IRI (up to and including the last # or /). */
export function namespaceOf(iri: string): string {
  const h = iri.lastIndexOf('#')
  if (h >= 0) return iri.slice(0, h + 1)
  const s = iri.lastIndexOf('/')
  return s >= 0 ? iri.slice(0, s + 1) : iri
}

/** Return the local name portion (after the last # or /). */
function localNameOf(iri: string): string {
  const m = iri.match(/[#/]([^#/]+)$/)
  return m ? m[1] : iri
}

// ── Tokenisation ─────────────────────────────────────────────────────────────

/**
 * Split a camelCase / underscore-delimited local name into lowercase tokens.
 * Examples:
 *   "PersonAddress"   → ["person", "address"]
 *   "HTTPSLink"       → ["https", "link"]
 *   "person_address"  → ["person", "address"]
 *   "hasName"         → ["has", "name"]
 */
export function tokenize(localName: string): string[] {
  return (localName
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')  // HTTPSLink → HTTPS Link
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')       // camelCase → camel Case
    .split(/[\s_\-]+/)
    .filter(t => t.length > 0)
    .map(t => t.toLowerCase()))
}

/** Jaccard similarity between two token arrays (treated as sets). */
export function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1
  const sa = new Set(a), sb = new Set(b)
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  return inter / (sa.size + sb.size - inter)
}

// ── Greedy nearest-neighbour ordering ────────────────────────────────────────

/**
 * Return items reordered so that each successive item is most similar to
 * the previous one (greedy nearest-neighbour chain).
 */
function greedyOrder(items: string[]): string[] {
  if (items.length <= 1) return items
  const remaining = new Set(items)
  const chain: string[] = [items[0]]
  remaining.delete(items[0])
  while (remaining.size > 0) {
    const last = chain[chain.length - 1]
    const lastTok = tokenize(localNameOf(last))
    let best = '', bestSim = -1
    for (const cand of remaining) {
      const s = jaccardSimilarity(lastTok, tokenize(localNameOf(cand)))
      if (s > bestSim) { bestSim = s; best = cand }
    }
    chain.push(best)
    remaining.delete(best)
  }
  return chain
}

// ── HSL → hex ─────────────────────────────────────────────────────────────────

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const channel = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return '#' + channel(0) + channel(8) + channel(4)
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Assign distinct hex colors to a list of type IRIs.
 *
 * - Types in the same namespace cluster around the same base hue.
 * - Within a namespace, similar local names (by Jaccard on camelCase tokens)
 *   receive adjacent hues via greedy nearest-neighbour ordering.
 * - Hue ranges for each namespace are evenly spread across 360°.
 */
export function assignTypeColors(typeIris: string[]): Record<string, string> {
  if (typeIris.length === 0) return {}

  // Group by namespace
  const nsGroups = new Map<string, string[]>()
  for (const iri of typeIris) {
    const ns = namespaceOf(iri)
    if (!nsGroups.has(ns)) nsGroups.set(ns, [])
    nsGroups.get(ns)!.push(iri)
  }

  const groups = [...nsGroups.entries()]
  const N = groups.length

  const result: Record<string, string> = {}

  groups.forEach(([, types], gi) => {
    // Base hue evenly spread, plus a small rotation to avoid red=0 being default
    const baseHue = (gi * 360 / N + 15) % 360

    // Hue range allocated to this namespace: narrow for many groups, wider otherwise
    const hueRange = Math.max(0, Math.min(45, 280 / N - 5))

    const ordered = greedyOrder([...types])

    ordered.forEach((iri, i) => {
      const n = ordered.length
      // Spread within ±(hueRange/2) of baseHue; single-item groups get baseHue exactly
      const offset = n > 1 ? (i / (n - 1) - 0.5) * hueRange : 0
      const hue = (baseHue + offset + 360) % 360
      result[iri] = hslToHex(hue, 65, 55)
    })
  })

  return result
}
