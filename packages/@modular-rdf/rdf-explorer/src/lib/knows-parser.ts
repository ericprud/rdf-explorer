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

import type { GraphSource, ParseResult, TurtleChangedCallback } from '@modular-rdf/graph-source-api'
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
  const triples: Array<[string, string, string]> = []
  const warnings: string[] = []
  const people = new Set<string>()

  for (const rawLine of text.split('\n')) {
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

    people.add(subj)
    people.add(obj)
    triples.push([`${BASE}${subj}`, `${NS_FOAF}knows`, `${BASE}${obj}`])
  }

  // Emit a foaf:Person + foaf:name triple for every person mentioned
  for (const name of people) {
    const iri = `${BASE}${name}`
    triples.push([iri, `${NS_RDF}type`,    `${NS_FOAF}Person`])
    triples.push([iri, `${NS_FOAF}name`,   `"${name}"^^${XSD_STR}`])
  }

  return { triples, warnings }
}

/** Serialise triples to Turtle text */
export function triplesToTurtle(triples: Array<[string, string, string]>, baseIri = BASE): string {
  const lines = [
    `@prefix foaf: <${NS_FOAF}> .`,
    `@prefix xsd:  <${NS_XSD}> .`,
    `@prefix rdf:  <${NS_RDF}> .`,
    '',
    `@base <${baseIri}> .`,
    '',
  ]

  // Group by subject
  const bySubj = new Map<string, Array<[string, string]>>()
  for (const [s, p, o] of triples) {
    if (!bySubj.has(s)) bySubj.set(s, [])
    bySubj.get(s)!.push([p, o])
  }

  for (const [subj, pairs] of bySubj) {
    const shorten = (iri: string) =>
      iri === `${NS_RDF}type`      ? 'a' :
      iri.startsWith(BASE)         ? `<#${iri.slice(BASE.length)}>` :
      iri.startsWith(NS_FOAF)      ? `foaf:${iri.slice(NS_FOAF.length)}` :
      iri.startsWith('"')          ? iri :
      `<${iri}>`

    const s = shorten(subj)
    const preds = pairs.map(([p, o], i) =>
      `  ${shorten(p)} ${shorten(o)}${i === pairs.length - 1 ? ' .' : ' ;'}`
    )
    lines.push(s)
    lines.push(...preds)
    lines.push('')
  }

  return lines.join('\n')
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

  readonly typeColors: Record<string, string> = {
    'foaf:Person': '#4f9cf9',
  }

  readonly typeRadii: Record<string, number> = {
    'foaf:Person': 10,
  }

  readonly hullFills: Record<string, string> = {
    'foaf:Person': 'rgba(79,156,249,0.07)',
  }

  private baseIri    = BASE
  private lastText   = ''
  private onChanged: TurtleChangedCallback = () => { /**/ }

  buildPanel(container: HTMLElement, onTurtleChanged: TurtleChangedCallback): void {
    this.onChanged = onTurtleChanged
    buildBasePanel(container, this, async (file) => {
      const result = await this.parse(await file.arrayBuffer())
      onTurtleChanged(result.turtle)
    })
  }

  setBaseIri(baseIri: string): void {
    this.baseIri = baseIri
    if (this.lastText) {
      const { triples, warnings: _ } = parseKnowsDsl(this.lastText)
      this.onChanged(triplesToTurtle(triples, this.baseIri))
    }
  }

  async parse(buffer: ArrayBuffer): Promise<ParseResult> {
    const text = new TextDecoder().decode(buffer)
    this.lastText = text
    const { triples, warnings } = parseKnowsDsl(text)
    const turtle = triplesToTurtle(triples, this.baseIri)

    let hash = 0
    for (let i = 0; i < Math.min(text.length, 4096); i++)
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0

    return {
      turtle,
      warnings,
      sheetsSeen:  ['knows DSL'],
      tripleCount: triples.length,
      timestamp:   new Date().toISOString(),
      fileHash:    hash.toString(16).padStart(8, '0'),
    }
  }
}

export const parser: GraphSource = new KnowsLoader()

export default parser
