/**
 * "knows" DSL parser — trivial loader used in unit tests and as a worked example.
 *
 * INPUT FORMAT  (plain text, one statement per line):
 *   Alice knows Bob.
 *   Bob knows Carol.
 *   # lines starting with # are comments
 *
 * OUTPUT TURTLE:
 *   @prefix foaf: <http://xmlns.com/foaf/0.1/> .
 *   @prefix ex:   <https://example.org/knows#> .
 *
 *   ex:Alice a foaf:Person ; foaf:name "Alice" ; foaf:knows ex:Bob .
 *   ex:Bob   a foaf:Person ; foaf:name "Bob"   ; foaf:knows ex:Carol .
 *   ex:Carol a foaf:Person ; foaf:name "Carol" .
 *
 * Rules:
 *   • Names are capitalised words (first char upper-case A-Z).
 *   • "Alice knows Bob." → foaf:knows triple + both people as foaf:Person.
 *   • Duplicates are silently merged.
 *   • Unknown lines produce a warning and are skipped.
 */

import type { DataLoader, ParseResult, TurtleChangedCallback } from './parser-api'
import { buildBasePanel } from './base-panel'

const BASE    = 'https://example.org/knows#'
const FOAF    = 'http://xmlns.com/foaf/0.1/'
const XSD_STR = 'http://www.w3.org/2001/XMLSchema#string'

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
    triples.push([`${BASE}${subj}`, `${FOAF}knows`, `${BASE}${obj}`])
  }

  // Emit a foaf:Person + foaf:name triple for every person mentioned
  for (const name of people) {
    const iri = `${BASE}${name}`
    triples.push([iri, `${FOAF}type`,   `${FOAF}Person`])
    triples.push([iri, `${FOAF}name`,   `"${name}"^^${XSD_STR}`])
  }

  return { triples, warnings }
}

/** Serialise triples to Turtle text */
export function triplesToTurtle(triples: Array<[string, string, string]>, baseIri = BASE): string {
  const lines = [
    '@prefix foaf: <http://xmlns.com/foaf/0.1/> .',
    `@prefix ex:   <${BASE}> .`,
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
      iri.startsWith(BASE)  ? `ex:${iri.slice(BASE.length)}`  :
      iri.startsWith(FOAF)  ? `foaf:${iri.slice(FOAF.length)}` :
      iri.startsWith('"')   ? iri :
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

class KnowsLoader implements DataLoader {
  readonly name        = '"knows" DSL parser'
  readonly description = 'Parses "Alice knows Bob." lines → foaf:knows Turtle'
  readonly accepts     = ['.txt', '.knows']

  readonly prefixes: Record<string, string> = {
    ex:   BASE,
    foaf: FOAF,
  }

  readonly typeColors: Record<string, string> = {
    'foaf:Person': '#4f9cf9',
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

export const parser: DataLoader = new KnowsLoader()

export default parser
