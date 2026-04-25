/**
 * "knows" DSL parser — trivial loader used in unit tests and as a worked example.
 *
 * INPUT FORMAT  (plain text, one statement per line):
 *   Alice knows Bob.
 *   Bob knows Carol.
 *   # lines starting with # are comments
 *
 * OUTPUT TURTLE:
 *   PREFIX foaf: <http://xmlns.com/foaf/0.1/>
 *   PREFIX xsd:  <http://www.w3.org/2001/XMLSchema#>
 *
 *   <#Alice> a foaf:Person ; foaf:name "Alice" ; foaf:knows <#Bob> .
 *   <#Bob>   a foaf:Person ; foaf:name "Bob"   ; foaf:knows <#Carol> .
 *   <#Carol> a foaf:Person ; foaf:name "Carol" .
 *
 * Rules:
 *   • Names are capitalised words (first char upper-case A-Z).
 *   • "Alice knows Bob." → foaf:knows triple + both people as foaf:Person.
 *   • Duplicates are silently merged.
 *   • Unknown lines produce a warning and are skipped.
 */

import type { GraphSource, ParseResult, ApplyGraphCallback } from '@modular-rdf/api-graph-source'
import { buildBasePanel } from './base-panel'

const BASE    = 'https://example.org/knows#'
const NS_FOAF = 'http://xmlns.com/foaf/0.1/'
const NS_RDF  = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const NS_XSD  = 'http://www.w3.org/2001/XMLSchema#'
const XSD_STR = 'xsd:string'

/** Exported for testing: pure function, no I/O */
export function parseKnowsDsl(text: string): {
  triples: Array<[string, string, string]>
  warnings: string[]
} {
  const knowses = new Map<string, Array<string, number>>
  const people = new Map<string, number>()
  const warnings: string[] = []

  let lineNo = -1
  for (const rawLine of text.split('\n')) {
    ++lineNo
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    // Expect: "<Name> knows <Name>."  (trailing dot optional)
    const m = line.match(/^([A-Z][A-Za-z0-9_-]*)\s+knows\s+([A-Z][A-Za-z0-9_-]*)\.?$/i)
    if (!m) {
      warnings.push(`Unrecognised line: ${line}`)
      continue
    }

    // Capitalise first char so "alice" → "Alice"
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
    const subj = cap(m[1]), obj = cap(m[2])

    if (!people.has(subj)) people.set(subj, lineNo)
    if (!people.has(obj)) people.set(obj, lineNo)
    if (knowses.has(subj)) {
      knowses.get(subj).push([obj, lineNo])
    } else {
      knowses.set(subj, [[obj, lineNo]])
    }
  }
  return {knowses, people, warnings}
}

/** Serialise triples to Turtle text */
export function triplesToTurtle(
  people: Map<string, number>,
  knowses: Map<string, Array<string, number>>,
  baseIri = BASE
): string {
  const lines = [
    `PREFIX foaf: <${NS_FOAF}>`,
    `PREFIX xsd:  <${NS_XSD}>`,
    `PREFIX rdf:  <${NS_RDF}>`,
    '',
    `BASE <${baseIri}>`,
    '',
  ]

  let tripleCount = 0
  for (const [subj, mentioned] of people) {
    const shorten = (iri: string) => `<#${iri}>`
    const add = (text: string) => { lines.push(text) ; ++tripleCount }

    const s = shorten(subj)
    add(`${s} a foaf:Person ; # L${mentioned}`)
    const known: Array<string, number> = knowses.get(subj) || []
    add(`  foaf:name "${subj}" ${known.length ? ";" : "."} # L${mentioned}`)
    let knownNo = -1
    for (const [obj, asserted] of known) {
      ++knownNo
      add(`  foaf:knows "${shorten(obj)}" ${knownNo < knowses.get(subj).length - 1 ? ";" : "."} # L${asserted}`)
    }
    lines.push('')
  }

  const turtle = lines.join('\n')
  return { turtle, tripleCount }
}

class KnowsLoader implements GraphSource {
  readonly name        = '"knows" DSL parser'
  readonly description = 'Parses "Alice knows Bob." lines → foaf:knows Turtle'
  readonly accepts     = ['.txt', '.knows']

  readonly prefixes: Record<string, string> = {
    xsd:  NS_XSD,
    foaf: NS_FOAF,
    rdf:  NS_RDF,
  }

  readonly renderingPreferences = {
    typeColors: { 'foaf:Person': '#4f9cf9' },
    typeRadii:  { 'foaf:Person': 10 },
    hullFills:  { 'foaf:Person': 'rgba(79,156,249,0.07)' },
  }

  private baseIri    = BASE
  private lastText   = ''
  private onChanged: ApplyGraphCallback = () => { /**/ }

  buildPanel(container: HTMLElement, applyGraph: ApplyGraphCallback): void {
    this.onChanged = applyGraph
    buildBasePanel(container, this, async (file) => {
      const result = await this.parse(await file.arrayBuffer())
      if (result.warnings) console.warn("asdf", result.warnings)
      applyGraph({ text: result.turtle, filename: result.timestamp })
    })
  }

  setBaseIri(baseIri: string): void {
    this.baseIri = baseIri
    if (this.lastText) {
      const { people, knowses, warnings: _ } = parseKnowsDsl(this.lastText)
      this.onChanged({ text: triplesToTurtle(people, knowses, this.baseIri).turtle })
    }
  }

  async parse(buffer: ArrayBuffer): Promise<ParseResult> {
    const text = new TextDecoder().decode(buffer)
    this.lastText = text
    const { people, knowses, warnings } = parseKnowsDsl(text)
    const { turtle, tripleCount } = triplesToTurtle(people, knowses, this.baseIri)

    let hash = 0
    for (let i = 0; i < Math.min(text.length, 4096); i++)
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0

    return {
      turtle,
      warnings,
      sheetsSeen:  ['knows DSL'],
      tripleCount,
      timestamp:   new Date().toISOString(),
      fileHash:    hash.toString(16).padStart(8, '0'),
    }
  }
}

export const parser: GraphSource = new KnowsLoader()

export default parser
