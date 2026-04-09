import * as N3 from 'n3'
import { parseTurtle } from './n3-parse'

export interface InferenceSuggestion {
  subject:       string
  predicate:     string
  value:         string
  suggestedType: string
  pattern:       string
  fix:           string
}

const PATTERNS: { type: string; label: string; test: (v: string) => boolean }[] = [
  { type: 'xsd:date',     label: 'date YYYY-MM-DD',  test: v => /^\d{4}-\d{2}-\d{2}$/.test(v) },
  { type: 'xsd:dateTime', label: 'ISO dateTime',      test: v => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) },
  { type: 'xsd:gYear',    label: 'year (4 digits)',   test: v => /^(19|20)\d{2}$/.test(v) },
  { type: 'xsd:integer',  label: 'integer',           test: v => /^-?\d+$/.test(v) },
  { type: 'xsd:decimal',  label: 'decimal',           test: v => /^-?\d+\.\d+$/.test(v) },
  { type: 'xsd:boolean',  label: 'boolean',           test: v => /^(true|false|yes|no|1|0)$/i.test(v) },
  { type: 'xsd:anyURI',   label: 'URI',               test: v => /^https?:\/\//.test(v) },
]

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'

export async function inferTypes(
  turtle: string,
  baseIri = 'https://example.org/upload/'
): Promise<InferenceSuggestion[]> {
  const suggestions: InferenceSuggestion[] = []
  try {
    const { quads } = await parseTurtle(turtle, baseIri)
    for (const q of quads) {
      if (q.object.termType !== 'Literal') continue
      const lit = q.object as N3.Literal
      if (lit.language) continue
      if (lit.datatype.value !== XSD_STRING && lit.datatype.value !== '') continue
      for (const { type, label, test } of PATTERNS) {
        if (test(lit.value)) {
          suggestions.push({
            subject:       q.subject.value,
            predicate:     q.predicate.value,
            value:         lit.value,
            suggestedType: type,
            pattern:       label,
            fix:           `"${lit.value}"^^${type}`,
          })
          break
        }
      }
    }
  } catch { /**/ }
  return suggestions
}
