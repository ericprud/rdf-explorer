/**
 * ShEx Generation & Validation using @shexjs/parser and @shexjs/validator
 *
 * generateShEx derives class names from rdf:type instance data.  It works with
 * any namespace — the prefix declarations in the turtle source are used for IRI
 * shortening so the output mirrors the prefixes the user already chose.
 */
import * as N3 from 'n3'
import { parseTurtle, parseIntoStore } from './n3-parse'

export interface ValidationResult {
  nodeId:  string
  shapeId: string
  passed:  boolean
  errors:  string[]
}

const RDF_TYPE  = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const BUILTIN_PREFIXES: Record<string, string> = {
  rdf:  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd:  'http://www.w3.org/2001/XMLSchema#',
  foaf: 'http://xmlns.com/foaf/0.1/',
}

/** Build an IRI shortener from a merged prefix map. */
function makeShortener(prefixes: Record<string, string>): (iri: string) => string {
  const all = { ...BUILTIN_PREFIXES, ...prefixes }
  return (iri: string) => {
    for (const [pfx, ns] of Object.entries(all))
      if (iri.startsWith(ns)) return `${pfx}:${iri.slice(ns.length)}`
    return `<${iri}>`
  }
}

/**
 * Derive the set of all distinct rdf:type values present in the store.
 * Uses store.match() (RDF/JS Dataset spec) for portability.
 */
export function distinctExTypes(store: N3.Store): string[] {
  const seen = new Set<string>()
  for (const q of store.match(null, N3.DataFactory.namedNode(RDF_TYPE), null))
    seen.add(q.object.value)
  return [...seen].sort()
}

export async function generateShEx(turtle: string, baseIri?: string): Promise<string> {
  const { store, prefixes } = await parseIntoStore(turtle, baseIri)
  const short = makeShortener(prefixes)

  // Collect all distinct rdf:type values, regardless of namespace
  const classes = distinctExTypes(store)

  const classPreds = new Map<string, Map<string, 'IRI' | 'Literal' | 'Both'>>()

  for (const q of store.match(null, N3.DataFactory.namedNode(RDF_TYPE), null)) {
    const cls = q.object.value
    if (!classPreds.has(cls)) classPreds.set(cls, new Map())
    const pm = classPreds.get(cls)!
    for (const pq of store.getQuads(q.subject, null, null, null)) {
      const pred = pq.predicate.value
      if (pred === RDF_TYPE) continue
      const isLit = pq.object.termType === 'Literal'
      const cur   = pm.get(pred)
      pm.set(pred,
        !cur              ? (isLit ? 'Literal' : 'IRI') :
        cur === 'Literal' && !isLit ? 'Both' :
        cur === 'IRI'     &&  isLit ? 'Both' : cur)
    }
  }

  // Emit PREFIX declarations: builtins first, then any extra from the turtle
  const exNs = baseIri ? baseIri.replace(/\/$/, '#') : undefined
  const allPrefixes = { ...BUILTIN_PREFIXES, ...(exNs ? { ex: exNs } : {}), ...prefixes }
  const lines = Object.entries(allPrefixes).map(([p, ns]) => `PREFIX ${p}: <${ns}>`)
  lines.push('')

  for (const cls of classes) {
    const cn = short(cls)
    lines.push(`${cn}Shape EXTRA rdf:type {`)
    lines.push(`  rdf:type [ ${cn} ] ;`)
    const pm = classPreds.get(cls)
    if (pm) {
      for (const [pred, kind] of pm) {
        const sp      = short(pred)
        const valExpr = kind === 'Literal' ? 'xsd:string' : kind === 'IRI' ? 'IRI' : '.'
        lines.push(`  ${sp} ${valExpr} * ;`)
      }
    }
    lines.push(`}`)
    lines.push(``)
  }

  return lines.join('\n')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any
type ShExValidatorCtor = new (...args: unknown[]) => {
  validateShapeMap: (sm: {node:string;shape:string}[]) => {status:string;reason?:string}[]
}

export class ValidationError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'ValidationError'
  }
}
