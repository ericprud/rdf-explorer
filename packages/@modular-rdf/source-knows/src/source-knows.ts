/**
 * source-knows.ts
 *
 * GraphSource for the "Alice knows Bob." DSL.
 * Parses the trivial foaf:knows language and emits Turtle.
 *
 * INPUT FORMAT (plain text, one statement per line):
 *   Alice knows Bob.
 *   Bob knows Carol.
 *   # lines starting with # are comments
 *
 * OUTPUT TURTLE:
 *   PREFIX foaf: <http://xmlns.com/foaf/0.1/>
 *   <#Alice> a foaf:Person ; foaf:name "Alice" ; foaf:knows <#Bob> .
 *   ...
 */

import type { GraphSource, ParseResult, ApplyGraphCallback } from '@modular-rdf/api-graph-source'
import { KnowsParser, KnowsParserState } from './KnowsParser'

const BASE    = 'https://example.org/knows#'
const NS_FOAF = 'http://xmlns.com/foaf/0.1/'
const NS_XSD  = 'http://www.w3.org/2001/XMLSchema#'
const NS_RDF  = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'

// ── Pure parsing ─────────────────────────────────────────────────────────────

/** Parse the knows DSL text and return structured data. */
export function parseKnowsDsl(text: string): {
  people:   Map<string, number>   // name → first-seen line (1-based)
  knowses:  Map<string, [string, number][]>  // subj → [(obj, line)]
  warnings: string[]
} {
  const state = new KnowsParserState()
  try {
    new KnowsParser(state).parse(text)
    return state.result()
  } catch (e) {
    return {
      people:   new Map(),
      knowses:  new Map(),
      warnings: [`Parse error: ${e instanceof Error ? e.message : String(e)}`],
    }
  }
}

/** Serialise the parsed data to Turtle text. */
function triplesToTurtle(
  people:  Map<string, number>,
  knowses: Map<string, [string, number][]>,
  baseIri = BASE,
): { turtle: string; tripleCount: number } {
  const lines = [
    `PREFIX foaf: <${NS_FOAF}>`,
    `PREFIX xsd:  <${NS_XSD}>`,
    `PREFIX rdf:  <${NS_RDF}>`,
    '',
    `BASE <${baseIri}>`,
    '',
  ]

  let tripleCount = 0
  for (const [subj, line] of people) {
    const s     = `<#${subj}>`
    const known = knowses.get(subj) ?? []

    lines.push(`${s} a foaf:Person ; # L${line}`)
    ++tripleCount  // rdf:type

    if (known.length) {
      lines.push(`  foaf:name "${subj}" ; # L${line}`)
      ++tripleCount
      known.forEach(([obj, l], i) => {
        const sep = i < known.length - 1 ? ';' : '.'
        lines.push(`  foaf:knows <#${obj}> ${sep} # L${l}`)
        ++tripleCount
      })
    } else {
      lines.push(`  foaf:name "${subj}" . # L${line}`)
      ++tripleCount
    }
    lines.push('')
  }

  return { turtle: lines.join('\n'), tripleCount }
}

// ── Drop-zone panel helper (inlined so this package has no dep on rdf-explorer) ──

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildDropPanel(
  container: HTMLElement,
  loader: Pick<GraphSource, 'name' | 'description' | 'accepts'>,
  onFile: (file: File) => void,
): void {
  const hint = loader.description ?? loader.accepts.join(' · ')

  const zone = document.createElement('div')
  zone.className = 'dropzone loader-dropzone'
  zone.setAttribute('data-loader-name', loader.name)

  const icon    = document.createElement('div')
  icon.className   = 'dropzone-icon'
  icon.textContent = '📂'

  const nameEl  = document.createElement('div')
  nameEl.className   = 'dropzone-text'
  nameEl.textContent = loader.name

  const hintEl  = document.createElement('div')
  hintEl.className   = 'dropzone-hint'
  hintEl.textContent = hint

  const fi       = document.createElement('input')
  fi.type        = 'file'
  fi.accept      = loader.accepts.join(',')
  fi.multiple    = true
  fi.style.display = 'none'

  zone.append(icon, nameEl, hintEl, fi)

  zone.addEventListener('click',     e  => { if (e.target !== fi) fi.click() })
  zone.addEventListener('dragover',  e  => { e.preventDefault(); zone.classList.add('dragging') })
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'))
  zone.addEventListener('drop', e => {
    e.preventDefault()
    zone.classList.remove('dragging')
    for (const f of e.dataTransfer?.files ?? []) {
      const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase()
      if (loader.accepts.includes(ext)) {
        onFile(f)
      } else if (ext === '.js' || ext === '.mjs') {
        const h = zone.querySelector('.dropzone-hint')
        if (h) {
          const prev = h.textContent
          h.textContent = '⚠ Drop .js loaders on the "Load" header above'
          setTimeout(() => { h.textContent = prev }, 3000)
        }
      }
    }
  })
  fi.addEventListener('change', () => {
    for (const f of fi.files ?? []) onFile(f)
    fi.value = ''
  })

  container.appendChild(zone)
}

// ── GraphSource implementation ────────────────────────────────────────────────

class KnowsSource implements GraphSource {
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

  private baseIri  = BASE
  private lastText = ''
  private onChanged: ApplyGraphCallback = () => { /* no-op until buildPanel */ }

  buildPanel(container: HTMLElement, applyGraph: ApplyGraphCallback): void {
    this.onChanged = applyGraph
    buildDropPanel(container, this, async (file) => {
      const result = await this.parse(await file.arrayBuffer())
      if (result.warnings?.length) console.warn('[knows-parser] warnings:', result.warnings)
      applyGraph({ text: result.turtle, filename: result.timestamp })
    })
  }

  setBaseIri(iri: string): void {
    this.baseIri = iri
    if (this.lastText) {
      const { people, knowses } = parseKnowsDsl(this.lastText)
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

export const source: GraphSource = new KnowsSource()

export default source
