/**
 * Unit tests for @modular-rdf/source-knows
 *
 * Run with: npx vitest run
 */
import { describe, it, expect } from 'vitest'
import { parseKnowsDsl, parser } from '@modular-rdf/source-knows'

const BASE = 'https://example.org/knows#'

describe('parseKnowsDsl', () => {
  it('parses a single statement', () => {
    const { knowses, warnings } = parseKnowsDsl('Alice knows Bob.')
    expect(warnings).toHaveLength(0)
    const aliceKnows = knowses.get('Alice')
    expect(aliceKnows).toBeDefined()
    expect(aliceKnows!.map(([name]) => name)).toContain('Bob')
  })

  it('populates people for both subject and object', () => {
    const { people } = parseKnowsDsl('Alice knows Bob.')
    expect(people.has('Alice')).toBe(true)
    expect(people.has('Bob')).toBe(true)
  })

  it('handles multiple statements', () => {
    const { people, knowses } = parseKnowsDsl('Alice knows Bob.\nBob knows Carol.')
    expect(people.size).toBe(3)
    expect(knowses.get('Alice')!.length).toBe(1)
    expect(knowses.get('Bob')!.length).toBe(1)
  })

  it('deduplicates people mentioned multiple times', () => {
    const { people } = parseKnowsDsl('Alice knows Bob.\nAlice knows Carol.')
    expect(people.size).toBe(3)
    expect(people.has('Alice')).toBe(true)
  })

  it('capitalises lower-case names', () => {
    const { knowses } = parseKnowsDsl('alice knows bob.')
    expect(knowses.has('Alice')).toBe(true)
    expect(knowses.get('Alice')![0][0]).toBe('Bob')
  })

  it('ignores blank lines and comments', () => {
    const { knowses, warnings } = parseKnowsDsl('# comment\n\nAlice knows Bob.\n')
    expect(warnings).toHaveLength(0)
    expect(knowses.has('Alice')).toBe(true)
  })

  it('warns on unrecognised input', () => {
    const { warnings } = parseKnowsDsl('this is not valid')
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('returns empty result for empty input', () => {
    const { people, knowses, warnings } = parseKnowsDsl('')
    expect(people.size).toBe(0)
    expect(knowses.size).toBe(0)
    expect(warnings).toHaveLength(0)
  })

  it('handles trailing dot being optional', () => {
    const withDot    = parseKnowsDsl('Alice knows Bob.')
    const withoutDot = parseKnowsDsl('Alice knows Bob')
    expect([...withDot.people.keys()]).toEqual([...withoutDot.people.keys()])
    expect([...withDot.knowses.entries()]).toEqual([...withoutDot.knowses.entries()])
  })

  it('records first-seen line numbers in people map', () => {
    const { people } = parseKnowsDsl('Alice knows Bob.\nBob knows Carol.')
    expect(people.get('Alice')).toBe(1)
    expect(people.get('Bob')).toBe(1)
    expect(people.get('Carol')).toBe(2)
  })
})

describe('GraphSource interface conformance', () => {
  it('has required name, accepts, parse fields', () => {
    expect(typeof parser.name).toBe('string')
    expect(parser.name.length).toBeGreaterThan(0)
    expect(Array.isArray(parser.accepts)).toBe(true)
    expect(parser.accepts.length).toBeGreaterThan(0)
    expect(typeof parser.parse).toBe('function')
  })

  it('parse() returns a valid ParseResult shape', async () => {
    const buf = new TextEncoder().encode('Alice knows Bob.').buffer as ArrayBuffer
    const r = await parser.parse!(buf)
    expect(typeof r.turtle).toBe('string')
    expect(typeof r.tripleCount).toBe('number')
    expect(typeof r.timestamp).toBe('string')
    expect(typeof r.fileHash).toBe('string')
    expect(Array.isArray(r.warnings)).toBe(true)
    expect(Array.isArray(r.sheetsSeen)).toBe(true)
  })

  it('parse() turtle has prefix and base declarations', async () => {
    const buf = new TextEncoder().encode('Alice knows Bob.').buffer as ArrayBuffer
    const r = await parser.parse!(buf)
    expect(r.turtle).toContain('PREFIX foaf:')
    expect(r.turtle).toContain(`BASE <${BASE}>`)
  })

  it('parse() turtle uses relative IRIs and foaf:knows', async () => {
    const buf = new TextEncoder().encode('Alice knows Bob.').buffer as ArrayBuffer
    const r = await parser.parse!(buf)
    expect(r.turtle).toContain('<#Alice>')
    expect(r.turtle).toContain('foaf:knows')
    expect(r.turtle).toContain('a foaf:Person')
    expect(r.tripleCount).toBeGreaterThan(0)
  })

  it('parse() round-trips all subjects into Turtle', async () => {
    const buf = new TextEncoder().encode('Alice knows Bob.\nBob knows Carol.').buffer as ArrayBuffer
    const r = await parser.parse!(buf)
    expect(r.turtle).toContain('<#Alice>')
    expect(r.turtle).toContain('<#Bob>')
    expect(r.turtle).toContain('<#Carol>')
    // 3 people × (type + name) = 6, plus 2 knows = 8
    expect(r.tripleCount).toBe(8)
  })

  it('parse() warns on bad input', async () => {
    const buf = new TextEncoder().encode('Alice knows Bob.\nbad line').buffer as ArrayBuffer
    const r = await parser.parse!(buf)
    expect(r.warnings.length).toBeGreaterThan(0)
  })
})
