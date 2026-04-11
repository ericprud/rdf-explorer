/**
 * Turtle Diff – triple-level comparison of two Turtle documents
 */
import * as N3 from 'n3'
import { parseTurtle } from '@modular-rdf/rdf-utils'

export interface TripleDiff {
  added:     N3.Quad[]
  removed:   N3.Quad[]
  unchanged: number
}

function quadKey(q: N3.Quad): string {
  return `${q.subject.value}\x00${q.predicate.value}\x00${q.object.value}`
}

export async function diffTurtle(prev: string, next: string): Promise<TripleDiff> {
  const [prevResult, nextResult] = await Promise.all([
    parseTurtle(prev).catch(() => ({ quads: [] as N3.Quad[], prefixes: {} })),
    parseTurtle(next).catch(() => ({ quads: [] as N3.Quad[], prefixes: {} })),
  ])

  const prevKeys = new Map(prevResult.quads.map(q => [quadKey(q), q]))
  const nextKeys = new Map(nextResult.quads.map(q => [quadKey(q), q]))

  const added:   N3.Quad[] = []
  const removed: N3.Quad[] = []
  let unchanged = 0

  for (const [k, q] of nextKeys) {
    if (prevKeys.has(k)) unchanged++
    else added.push(q)
  }
  for (const [k, q] of prevKeys) {
    if (!nextKeys.has(k)) removed.push(q)
  }

  return { added, removed, unchanged }
}

export function renderDiffHtml(diff: TripleDiff, prefixes: Record<string, string>): string {
  function short(iri: string): string {
    for (const [uri, pfx] of Object.entries(prefixes)) {
      if (iri.startsWith(uri)) return `${pfx}:${iri.slice(uri.length)}`
    }
    const m = iri.match(/[/#]([^/#]+)$/)
    return m ? decodeURIComponent(m[1]) : iri
  }

  function renderQuad(q: N3.Quad): string {
    const s = short(q.subject.value)
    const p = short(q.predicate.value)
    const o = q.object.termType === 'Literal'
      ? `"${q.object.value.slice(0, 80)}${q.object.value.length > 80 ? '…' : ''}"`
      : short(q.object.value)
    return `${e(s)} <span class="diff-pred">${e(p)}</span> ${e(o)}`
  }

  const sections: string[] = []

  if (diff.added.length) {
    sections.push(`<div class="diff-section diff-added">
      <div class="diff-header">+ ${diff.added.length} triple${diff.added.length !== 1 ? 's' : ''} added</div>
      ${diff.added.slice(0, 300).map(q => `<div class="diff-row">+ ${renderQuad(q)}</div>`).join('')}
      ${diff.added.length > 300 ? `<div class="diff-more">… and ${diff.added.length - 300} more</div>` : ''}
    </div>`)
  }

  if (diff.removed.length) {
    sections.push(`<div class="diff-section diff-removed">
      <div class="diff-header">− ${diff.removed.length} triple${diff.removed.length !== 1 ? 's' : ''} removed</div>
      ${diff.removed.slice(0, 300).map(q => `<div class="diff-row">− ${renderQuad(q)}</div>`).join('')}
      ${diff.removed.length > 300 ? `<div class="diff-more">… and ${diff.removed.length - 300} more</div>` : ''}
    </div>`)
  }

  if (!sections.length) {
    return `<div class="diff-none">No changes – ${diff.unchanged.toLocaleString()} triples unchanged</div>`
  }

  return `<div class="diff-summary">${diff.unchanged.toLocaleString()} unchanged</div>` +
    sections.join('')
}

function e(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}
