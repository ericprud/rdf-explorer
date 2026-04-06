/**
 * ShEx Worker Thread
 *
 * Runs @shexjs/parser + @shexjs/validator entirely off the main thread.
 * Modelled after shexjs/shex-webapp/doc/ShExWorkerThread.js but written as a
 * typed ES module so Vite can bundle it as a Worker chunk.
 *
 * Protocol (all messages are plain objects):
 *
 *   Main → Worker
 *   ─────────────
 *   { type: 'init',     shex: string }
 *     Load and parse the ShEx schema.  Must be sent before any 'validate'.
 *
 *   { type: 'validate', id: number, nodeId: string, shapeId: string }
 *     Validate one node/shape pair.  id is echoed back in the response.
 *
 *   { type: 'abort' }
 *     Cancel any pending work and reset internal state.
 *
 *   Worker → Main
 *   ─────────────
 *   { type: 'ready' }
 *     Worker is alive and awaiting 'init'.
 *
 *   { type: 'init-ok' }
 *     Schema loaded and parsed successfully.
 *
 *   { type: 'init-error', message: string }
 *     Schema failed to load or parse.
 *
 *   { type: 'result', id: number, passed: boolean, elapsed: number, errors: string[] }
 *     Result for a validate request.
 *
 *   { type: 'aborted' }
 *     Abort acknowledged.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>

let validator: null | { validateShapeMap: (sm: {node:string;shape:string}[]) => {status:string;reason?:string}[] } = null
let aborted = false

self.postMessage({ type: 'ready' })

self.addEventListener('message', async (evt: MessageEvent<AnyObj>) => {
  const msg = evt.data

  if (msg.type === 'abort') {
    aborted = true
    validator = null
    self.postMessage({ type: 'aborted' })
    return
  }

  if (msg.type === 'init') {
    aborted   = false
    validator = null
    try {
      const [parserMod, validatorMod, neighborhoodMod, n3Mod] = await Promise.all([
        import('@shexjs/parser')              as Promise<AnyObj>,
        import('@shexjs/validator')           as Promise<AnyObj>,
        import('@shexjs/neighborhood-rdfjs') as Promise<AnyObj>,
        import('n3')                           as Promise<AnyObj>,
      ])

      const shexParserConstruct = parserMod['construct'] as ((...a: unknown[]) => { parse: (s: string) => unknown }) | undefined
      const ShExValidatorClass  = validatorMod['ShExValidator'] as (new (...a: unknown[]) => typeof validator) | undefined

      if (!shexParserConstruct || !ShExValidatorClass) {
        self.postMessage({ type: 'init-error', message: 'ShEx library exports not found' })
        return
      }

      // Build the N3 store from the turtle text bundled in the init message
      const N3: AnyObj = n3Mod
      const store = new N3['Store']()
      await new Promise<void>((resolve, reject) => {
        const parser = new N3['Parser']({ baseIRI: 'https://example.org/upload/', format: 'text/turtle' })
        parser.parse(msg.turtle as string, (err: unknown, quad: unknown) => {
          if (err) { reject(err); return }
          if (quad) store.addQuad(quad)
          else resolve()
        })
      })

      const ctor = neighborhoodMod['ctor'] as (store: unknown) => unknown
      const db   = ctor(store)

      const schema = shexParserConstruct(undefined, {}, {}).parse(msg.shex as string)
      validator    = new ShExValidatorClass(schema, db, {})

      self.postMessage({ type: 'init-ok' })
    } catch (e) {
      self.postMessage({ type: 'init-error', message: String(e) })
    }
    return
  }

  if (msg.type === 'validate') {
    if (aborted) {
      self.postMessage({ type: 'result', id: msg.id, passed: false, elapsed: 0, errors: ['aborted'] })
      return
    }
    if (!validator) {
      self.postMessage({ type: 'result', id: msg.id, passed: false, elapsed: 0, errors: ['validator not initialised'] })
      return
    }
    try {
      const start = Date.now()
      const res   = validator.validateShapeMap([{ node: msg.nodeId as string, shape: msg.shapeId as string }])
      const elapsed = Date.now() - start
      const passed  = (res as {status:string}[]).every(r => r.status === 'conformant')
      const errors  = passed ? [] :
        (res as {status:string;reason?:string}[])
          .filter(r => r.status !== 'conformant')
          .map(r => r.reason ?? 'non-conformant')
      self.postMessage({ type: 'result', id: msg.id, passed, elapsed, errors })
    } catch (e) {
      self.postMessage({ type: 'result', id: msg.id, passed: false, elapsed: 0, errors: [String(e)] })
    }
  }
})
