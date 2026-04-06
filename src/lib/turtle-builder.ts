/**
 * Literate Turtle Builder
 *
 * Provides a fluent API for constructing RDF graphs as Turtle text.
 * Nodes are either named (IRI) or anonymous controlled by a NodeConfig map.
 */

export type IriString = string
export type Literal   = { value: string; datatype?: string; lang?: string }

export interface Triple {
  subject:   IriString
  predicate: IriString
  object:    IriString | Literal
}

export type NodeConfig = Record<string, boolean>

/** Encode a URI path component (spaces → %20 etc.) */
export function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(/%20/g, '%20')
}

/** Build a relative IRI from type-path + segments */
export function relativeIri(typePath: string, ...segments: string[]): IriString {
  const parts = [typePath, ...segments].map(pctEncode)
  return `<../${parts.join('/')}>`
}

export const PREFIXES: Record<string, string> = {
  ex:   'https://example.org/upload#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  rdf:  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  xsd:  'http://www.w3.org/2001/XMLSchema#',
  foaf: 'http://xmlns.com/foaf/0.1/',
  olo:  'http://purl.org/ontology/olo/core#',
  owl:  'http://www.w3.org/2002/07/owl#',
}

export class TurtleBuilder {
  private triples: Triple[] = []
  private declared = new Set<IriString>()
  private config: NodeConfig

  constructor(config: NodeConfig = {}) {
    this.config = config
  }

  shouldName(typeName: string): boolean {
    return this.config[typeName] !== false
  }

  nodeIri(named: boolean, typePath: string, ...segments: string[]): IriString {
    if (named) return relativeIri(typePath, ...segments)
    const key = [typePath, ...segments].map(pctEncode).join('_')
    return `_:${key.replace(/[^A-Za-z0-9_]/g, '_')}`
  }

  add(subject: IriString, predicate: IriString, object: IriString | Literal): this {
    this.triples.push({ subject, predicate, object })
    return this
  }

  addAll(subject: IriString, predicate: IriString, objects: (IriString | Literal)[]): this {
    for (const obj of objects) this.add(subject, predicate, obj)
    return this
  }

  /**
   * Create or update a node, returning its IRI.
   * @param named     - mint a named IRI (true) or blank node (false)
   * @param types     - rdf:type values (short names, prefixed with ex: automatically)
   * @param typePath  - first segment of the relative IRI path
   * @param segments  - remaining IRI path segments
   * @param props     - [predicate, object] pairs to assert
   */
  node(
    named: boolean,
    types: string[],
    typePath: string,
    segments: string[],
    props: [IriString, IriString | Literal][]
  ): IriString {
    const iri = this.nodeIri(named, typePath, ...segments)
    if (!this.declared.has(iri)) {
      this.declared.add(iri)
      for (const t of types) {
        this.add(iri, 'rdf:type', t.includes(':') ? t : `ex:${t}`)
      }
    }
    for (const [p, o] of props) {
      this.add(iri, p, o)
    }
    return iri
  }

  serialize(baseIri = 'https://example.org/upload/'): string {
    const lines: string[] = []

    for (const [pfx, uri] of Object.entries(PREFIXES)) {
      lines.push(`@prefix ${pfx}: <${uri}> .`)
    }
    lines.push('')
    lines.push(`@base <${baseIri}> .`)
    lines.push('')

    // Group triples by subject → predicate → objects[]
    const map = new Map<string, Map<string, (IriString | Literal)[]>>()
    for (const { subject, predicate, object } of this.triples) {
      if (!map.has(subject)) map.set(subject, new Map())
      const pmap = map.get(subject)!
      if (!pmap.has(predicate)) pmap.set(predicate, [])
      pmap.get(predicate)!.push(object)
    }

    for (const [subj, pmap] of map) {
      lines.push(this.formatTerm(subj))
      const entries = [...pmap.entries()]
      entries.forEach(([pred, objs], pi) => {
        const objsStr = objs.map(o => this.formatObject(o)).join(' ,\n    ')
        const sep = pi === entries.length - 1 ? ' .' : ' ;'
        lines.push(`  ${pred} ${objsStr}${sep}`)
      })
      lines.push('')
    }

    return lines.join('\n')
  }

  private formatTerm(term: string): string {
    return term
  }

  private formatObject(obj: IriString | Literal): string {
    if (typeof obj === 'string') return obj
    const { value, datatype, lang } = obj as Literal
    const esc = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
    if (lang) return `"${esc}"@${lang}`
    if (datatype) return `"${esc}"^^${datatype}`
    return `"${esc}"`
  }

  getTriples(): Triple[] { return [...this.triples] }
  reset(): void { this.triples = []; this.declared.clear() }
}

export const lit = (value: string, datatype?: string, lang?: string): Literal =>
  ({ value, datatype, lang })

export const xsdBoolean = (v: boolean): Literal =>
  ({ value: String(v), datatype: 'xsd:boolean' })

export const xsdInt = (v: number): Literal =>
  ({ value: String(v), datatype: 'xsd:integer' })
