/**
 * Minimal SPARQL SELECT evaluator over an N3.Store.
 * Handles SELECT/WHERE with basic triple patterns and LIMIT.
 */
import * as N3 from 'n3'
import type { DatasetCore, Term } from '@modular-rdf/graph-handler-api'
import { parseIntoStore } from '@modular-rdf/rdf-utils'

export interface SparqlBinding { [v: string]: string }
export interface SparqlResult  { variables: string[]; bindings: SparqlBinding[]; error?: string }

export async function buildN3Store(
  turtle: string,
  baseIri = 'https://example.org/upload/'
): Promise<DatasetCore> {
  try {
    const { store } = await parseIntoStore(turtle, baseIri)
    return store
  } catch {
    return new N3.Store()
  }
}

export function runSparqlSelect(
  store:           DatasetCore,
  query:           string,
  prefixOverrides: Record<string, string> = {},
): SparqlResult {
  try {
    const variables = extractVars(query)
    const bindings  = evalBGP(store, query, variables, prefixOverrides)
    return { variables, bindings }
  } catch (e) {
    return { variables: [], bindings: [], error: String(e) }
  }
}

// ── Variable extraction ─────────────────────────────────────────────────────
function extractVars(query: string): string[] {
  const m = query.match(/SELECT\s+(.+?)\s+WHERE/si)
  if (!m) return []
  if (m[1].trim() === '*') {
    const vs = new Set<string>()
    for (const match of query.matchAll(/\?(\w+)/g)) vs.add(match[1])
    return [...vs]
  }
  return [...m[1].matchAll(/\?(\w+)/g)].map(x => x[1])
}

// ── Basic graph-pattern evaluator ───────────────────────────────────────────
interface TPattern { s: string; p: string; o: string }

function evalBGP(store: DatasetCore, query: string, _vars: string[], prefixOverrides: Record<string,string> = {}): SparqlBinding[] {
  const wm = query.match(/WHERE\s*\{([\s\S]+?)\}/si)
  if (!wm) return []
  const patterns = parsePatterns(wm[1], prefixOverrides)
  if (!patterns.length) return []

  let bindings: SparqlBinding[] = [{}]

  for (const pat of patterns) {
    const next: SparqlBinding[] = []
    for (const b of bindings) {
      const rs = resolve(pat.s, b)
      const rp = resolve(pat.p, b)
      const ro = resolve(pat.o, b)

      const ss = rs ? N3.DataFactory.namedNode(rs) : null
      const pp = rp ? N3.DataFactory.namedNode(rp) : null
      let oo: Term | null = null
      if (ro) {
        oo = ro.startsWith('"')
          ? N3.DataFactory.literal(ro.slice(1, ro.lastIndexOf('"')))
          : N3.DataFactory.namedNode(ro)
      }

      for (const q of store.match(ss, pp, oo, null)) {
        const nb: SparqlBinding = { ...b }
        if (isVar(pat.s)) nb[pat.s.slice(1)] = q.subject.value
        if (isVar(pat.p)) nb[pat.p.slice(1)] = q.predicate.value
        if (isVar(pat.o)) nb[pat.o.slice(1)] = q.object.value
        next.push(nb)
      }
    }
    bindings = next
  }

  const lm = query.match(/LIMIT\s+(\d+)/i)
  if (lm) bindings = bindings.slice(0, parseInt(lm[1]))
  return bindings
}

// ── Triple pattern parser ─────────────────────────────────────────────────
const BUILTIN_SPARQL_PREFIXES: Record<string, string> = {
  rdf:  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd:  'http://www.w3.org/2001/XMLSchema#',
  foaf: 'http://xmlns.com/foaf/0.1/',
  owl:  'http://www.w3.org/2002/07/owl#',
}

function parsePatterns(body: string, overrides: Record<string,string> = {}): TPattern[] {
  const PREFIXES = { ...BUILTIN_SPARQL_PREFIXES, ...overrides }
  const clean = body.replace(/#[^\n]*/g, '')
  return clean
    .split(/\s*\.\s*/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const toks = tokenize(s)
      return toks.length >= 3
        ? { s: expand(toks[0], PREFIXES), p: expand(toks[1], PREFIXES), o: expand(toks[2], PREFIXES) }
        : null
    })
    .filter((p): p is TPattern => p !== null)
}

function tokenize(s: string): string[] {
  const toks: string[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (' \t\n\r'.includes(ch)) { i++; continue }
    if (ch === '<') {
      const e = s.indexOf('>', i); if (e < 0) break
      toks.push(s.slice(i + 1, e)); i = e + 1
    } else if (ch === '"') {
      const e = s.indexOf('"', i + 1); if (e < 0) break
      toks.push('"' + s.slice(i + 1, e) + '"'); i = e + 1
    } else if (ch === '?') {
      const m = s.slice(i).match(/^\?(\w+)/)
      if (m) { toks.push('?' + m[1]); i += m[0].length } else i++
    } else {
      const m = s.slice(i).match(/^[^\s<>"?;,{}()[\]]+/)
      if (m) { toks.push(m[0]); i += m[0].length } else i++
    }
  }
  return toks
}

function expand(tok: string, pfxMap: Record<string,string>): string {
  if (tok.startsWith('?') || tok.startsWith('"')) return tok
  const ci = tok.indexOf(':')
  if (ci > 0) {
    const pfx = tok.slice(0, ci), local = tok.slice(ci + 1)
    if (pfxMap[pfx]) return pfxMap[pfx] + local
  }
  return tok
}

const isVar    = (t: string) => t.startsWith('?')
const resolve  = (t: string, b: SparqlBinding) => isVar(t) ? (b[t.slice(1)] ?? null) : t
