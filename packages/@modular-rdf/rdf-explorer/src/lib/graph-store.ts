/**
 * Graph Store – parse Turtle with N3, manage graph data + URL-hash history
 */
import * as N3 from 'n3'
import { parseTurtle } from '@modular-rdf/rdf-utils'

export interface GraphNode {
  id:        string
  label:     string
  types:     string[]
  namespace: string
  expanded:  boolean
  pinned:    boolean
  /** Literal (scalar) properties: predicate → value pairs, in order of appearance. */
  scalars:   Array<{ predicate: string; predicateFull: string; value: string }>
  x?:  number
  y?:  number
  fx?: number | null
  fy?: number | null
}

export interface GraphEdge {
  id:            string
  source:        string | GraphNode
  target:        string | GraphNode
  predicate:     string
  predicateFull: string
  /** True for edges to literal values (scalar properties). */
  isScalar?:     boolean
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

const WELL_KNOWN: Record<string, string> = {
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#': 'rdf',
  'http://www.w3.org/2000/01/rdf-schema#':        'rdfs',
  'http://www.w3.org/2001/XMLSchema#':            'xsd',
  'http://xmlns.com/foaf/0.1/':                   'foaf',
  'http://www.w3.org/2002/07/owl#':               'owl',
}

export function shortIri(iri: string, pfxs: Record<string, string>): string {
  for (const [uri, pfx] of Object.entries(pfxs)) {
    if (iri.startsWith(uri)) return `${pfx}:${iri.slice(uri.length)}`
  }
  for (const [uri, pfx] of Object.entries(WELL_KNOWN)) {
    if (iri.startsWith(uri)) return `${pfx}:${iri.slice(uri.length)}`
  }
  const m = iri.match(/[/#]([^/#]+)$/)
  return m ? decodeURIComponent(m[1]) : iri
}

function namespace(iri: string): string {
  const m = iri.match(/^(https?:\/\/[^/#]+[/#][^#]*[/#])/)
  return m ? m[1] : iri.replace(/[^/]+$/, '')
}

export async function parseTurtleToGraph(
  turtle: string,
  baseIri = 'https://example.org/upload/' // TODO: inherit
): Promise<{ graph: GraphData; parseErrors: string[]; prefixes: Record<string, string> }> {
  const parseErrors: string[] = []
  let quads: N3.Quad[] = []
  let prefixes: Record<string, string> = { ...WELL_KNOWN }

  try {
    const result = await parseTurtle(turtle, baseIri)
    quads = result.quads
    Object.assign(prefixes, result.prefixes)
  } catch (e) {
    parseErrors.push(String(e))
  }

  const nodeMap   = new Map<string, GraphNode>()
  const labelMap  = new Map<string, string>()
  const typeMap   = new Map<string, string[]>()
  const scalarMap = new Map<string, Array<{ predicate: string; predicateFull: string; value: string }>>()
  const edgeList  = new Array<GraphEdge>()
  const edgeIds   = new Set<string>()

  const RDF_TYPE   = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
  const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'

  // First pass: collect labels, types, and scalar properties
  for (const q of quads) {
    if (q.predicate.value === RDFS_LABEL && q.object.termType === 'Literal') {
      labelMap.set(q.subject.value, q.object.value)
    }
    if (q.predicate.value === RDF_TYPE) {
      if (!typeMap.has(q.subject.value)) typeMap.set(q.subject.value, [])
      typeMap.get(q.subject.value)!.push(q.object.value)
    }
    // Collect literal objects as scalar properties
    if (q.subject.termType === 'NamedNode' && q.object.termType === 'Literal') {
      if (!scalarMap.has(q.subject.value)) scalarMap.set(q.subject.value, [])
      scalarMap.get(q.subject.value)!.push({
        predicate:     shortIri(q.predicate.value, prefixes),
        predicateFull: q.predicate.value,
        value:         q.object.value,
      })
    }
  }

  const ensure = (iri: string): GraphNode => {
    if (!nodeMap.has(iri)) {
      nodeMap.set(iri, {
        id:        iri,
        label:     labelMap.get(iri) ?? shortIri(iri, prefixes),
        types:     typeMap.get(iri) ?? [],
        scalars:   scalarMap.get(iri) ?? [],
        namespace: namespace(iri),
        expanded:  false,
        pinned:    false,
      })
    }
    return nodeMap.get(iri)!
  }

  // Second pass: build nodes and IRI→IRI edges
  for (const q of quads) {
    if (q.subject.termType === 'NamedNode') ensure(q.subject.value)
    if (q.object.termType === 'NamedNode') {
      ensure(q.object.value)
      const eid = `${q.subject.value}\x00${q.predicate.value}\x00${q.object.value}`
      if (!edgeIds.has(eid)) {
        edgeIds.add(eid)
        edgeList.push({
          id:            eid,
          source:        q.subject.value,
          target:        q.object.value,
          predicate:     shortIri(q.predicate.value, prefixes),
          predicateFull: q.predicate.value,
        })
      }
    }
  }

  // Third pass: build scalar (literal-object) edges and synthetic literal nodes
  for (const q of quads) {
    if (q.subject.termType !== 'NamedNode' || q.object.termType !== 'Literal') continue
    const subjId  = q.subject.value
    // Synthetic node id: use the literal value string as a pseudo-IRI key
    // Prefix with 'lit' to avoid collisions with real IRIs
    const litKey  = `lit${q.predicate.value}${q.object.value}`
    const litLabel = q.object.value.length > 40
      ? q.object.value.slice(0, 37) + '…'
      : q.object.value
    if (!nodeMap.has(litKey)) {
      nodeMap.set(litKey, {
        id:        litKey,
        label:     litLabel,
        types:     ['__literal__'],
        scalars:   [],
        namespace: '',
        expanded:  false,
        pinned:    false,
      })
    }
    const eid = `scalar${subjId}${q.predicate.value}${q.object.value}`
    if (!edgeIds.has(eid)) {
      edgeIds.add(eid)
      edgeList.push({
        id:            eid,
        source:        subjId,
        target:        litKey,
        predicate:     shortIri(q.predicate.value, prefixes),
        predicateFull: q.predicate.value,
        isScalar:      true,
      })
    }
  }

  return {
    graph:       { nodes: [...nodeMap.values()], edges: edgeList },
    parseErrors,
    prefixes,
  }
}

// ── URL-hash view-state ─────────────────────────────────────────────────────
// Canonical implementations live in @modular-rdf/rdf-utils; re-exported here
// so callers (main.ts) continue to import from a single graph-store import.
export type { ViewState } from '@modular-rdf/rdf-utils'
export { pushHistory, readHistory } from '@modular-rdf/rdf-utils'
