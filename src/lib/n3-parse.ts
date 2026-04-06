/**
 * Promise wrapper around N3.Parser.parse()
 *
 * N3's parser is asynchronous: the callback fires after parse() returns,
 * and signals completion with (null, null, prefixes) on the final call.
 * This wrapper collects quads and resolves when parsing is complete.
 */
import * as N3 from 'n3'

const BASE_IRI = 'https://example.org/upload/'

export interface ParseResult {
  quads:    N3.Quad[]
  prefixes: Record<string, string>
}

export function parseTurtle(
  turtle: string,
  baseIri: string = BASE_IRI
): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const quads: N3.Quad[] = []
    const parser = new N3.Parser({ baseIRI: baseIri, format: 'text/turtle' })

    parser.parse(turtle, (err, quad, prefixes) => {
      if (err) {
        reject(err)
        return
      }
      if (quad) {
        quads.push(quad)
      } else {
        // quad === null signals end of stream; prefixes are finalised here
        resolve({
          quads,
          prefixes: Object.fromEntries(Object.entries(prefixes ?? {}).map(([k,v]) => [k, typeof v === "string" ? v : (v as {value:string}).value])),
        })
      }
    })
  })
}

/** Convenience: parse directly into an N3.Store */
export async function parseIntoStore(
  turtle: string,
  baseIri: string = BASE_IRI
): Promise<{ store: N3.Store; prefixes: Record<string, string> }> {
  const { quads, prefixes } = await parseTurtle(turtle, baseIri)
  const store = new N3.Store()
  store.addQuads(quads)
  return { store, prefixes }
}
