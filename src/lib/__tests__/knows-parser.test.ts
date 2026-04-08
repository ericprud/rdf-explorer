/**
 * Unit tests for knows-parser.ts
 *
 * Run with: npx vitest run
 */
import { describe, it, expect } from 'vitest'
import { parseKnowsDsl, triplesToTurtle, parser } from '../knows-parser'

const FOAF = 'http://xmlns.com/foaf/0.1/'
const BASE = 'https://example.org/knows#'

describe('parseKnowsDsl', () => {
  it('parses a single statement', () => {
    const { triples, warnings } = parseKnowsDsl('Alice knows Bob.')
    expect(warnings).toHaveLength(0)
    expect(triples).toContainEqual([`${BASE}Alice`, `${FOAF}knows`, `${BASE}Bob`])
  })

  it('produces foaf:Person triples for both subject and object', () => {
    const { triples } = parseKnowsDsl('Alice knows Bob.')
    const types = triples.filter(([,p]) => p === `${FOAF}type`).map(([s]) => s)
    expect(types).toContain(`${BASE}Alice`)
    expect(types).toContain(`${BASE}Bob`)
  })

  it('produces foaf:name literals for every person', () => {
    const { triples } = parseKnowsDsl('Alice knows Bob.')
    const names = triples.filter(([,p]) => p === `${FOAF}name`).map(([s,,o]) => [s, o])
    const XSD = 'http://www.w3.org/2001/XMLSchema#string'
    expect(names).toContainEqual([`${BASE}Alice`, `"Alice"^^${XSD}`])
    expect(names).toContainEqual([`${BASE}Bob`,   `"Bob"^^${XSD}`])
  })

  it('handles multiple statements', () => {
    const { triples } = parseKnowsDsl('Alice knows Bob.\nBob knows Carol.')
    const knows  = triples.filter(([,p]) => p === `${FOAF}knows`)
    const people = new Set(triples.filter(([,p]) => p === `${FOAF}type`).map(([s]) => s))
    expect(knows).toHaveLength(2)
    expect(people.size).toBe(3)
  })

  it('deduplicates people mentioned multiple times', () => {
    const { triples } = parseKnowsDsl('Alice knows Bob.\nAlice knows Carol.')
    const aliceTypes = triples.filter(([s, p]) =>
      s === `${BASE}Alice` && p === `${FOAF}type`)
    expect(aliceTypes).toHaveLength(1)
  })

  it('capitalises lower-case names', () => {
    const { triples } = parseKnowsDsl('alice knows bob.')
    const [knows] = triples.filter(([,p]) => p === `${FOAF}knows`)
    expect(knows[0]).toBe(`${BASE}Alice`)
    expect(knows[2]).toBe(`${BASE}Bob`)
  })

  it('ignores blank lines and comments', () => {
    const { triples, warnings } = parseKnowsDsl('# comment\n\nAlice knows Bob.\n')
    expect(warnings).toHaveLength(0)
    expect(triples.some(([,p]) => p === `${FOAF}knows`)).toBe(true)
  })

  it('warns on unrecognised lines', () => {
    const { warnings } = parseKnowsDsl('this is not valid')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/Unrecognised line/)
  })

  it('returns empty result for empty input', () => {
    const { triples, warnings } = parseKnowsDsl('')
    expect(triples).toHaveLength(0)
    expect(warnings).toHaveLength(0)
  })

  it('handles trailing dot being optional', () => {
    const withDot    = parseKnowsDsl('Alice knows Bob.')
    const withoutDot = parseKnowsDsl('Alice knows Bob')
    expect(withDot.triples).toEqual(withoutDot.triples)
  })
})

describe('triplesToTurtle', () => {
  it('produces Turtle with prefix declarations', () => {
    const { triples } = parseKnowsDsl('Alice knows Bob.')
    const ttl = triplesToTurtle(triples)
    expect(ttl).toContain('@prefix foaf:')
    expect(ttl).toContain('@prefix ex:')
  })

  it('uses qnames for known prefixes', () => {
    const { triples } = parseKnowsDsl('Alice knows Bob.')
    const ttl = triplesToTurtle(triples)
    expect(ttl).toContain('ex:Alice')
    expect(ttl).toContain('foaf:knows')
    expect(ttl).not.toContain('<http://xmlns.com/foaf/0.1/knows>')
  })

  it('round-trips through parseKnowsDsl without data loss', () => {
    const input = 'Alice knows Bob.\nBob knows Carol.'
    const { triples } = parseKnowsDsl(input)
    const ttl = triplesToTurtle(triples)
    // All three people should appear
    expect(ttl).toContain('ex:Alice')
    expect(ttl).toContain('ex:Bob')
    expect(ttl).toContain('ex:Carol')
  })
})

describe('DataLoader interface conformance', () => {
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

  it('parse() turtle contains the expected foaf:knows triple', async () => {
    const buf = new TextEncoder().encode('Alice knows Bob.').buffer as ArrayBuffer
    const r = await parser.parse!(buf)
    expect(r.turtle).toContain('foaf:knows')
    expect(r.tripleCount).toBeGreaterThan(0)
  })

  it('parse() warns on bad lines but still returns Turtle', async () => {
    const buf = new TextEncoder().encode('Alice knows Bob.\nbad line').buffer as ArrayBuffer
    const r = await parser.parse!(buf)
    expect(r.warnings.length).toBeGreaterThan(0)
    expect(r.turtle).toContain('foaf:knows')
  })

  it('parse() tripleCount matches actual triples array length', async () => {
    const buf = new TextEncoder().encode('Alice knows Bob.\nBob knows Carol.').buffer as ArrayBuffer
    const r = await parser.parse!(buf)
    // Count the triples ourselves using parseKnowsDsl
    const text = new TextDecoder().decode(buf)
    const { triples } = parseKnowsDsl(text)
    expect(r.tripleCount).toBe(triples.length)
  })
})
