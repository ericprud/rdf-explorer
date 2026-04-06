/**
 * ShEx Worker Client
 *
 * Promise-based wrapper around shex-worker.ts.
 * The main thread imports this; the Worker script is shex-worker.ts.
 *
 * Usage:
 *   const client = new ShExWorkerClient()
 *   await client.init(shexSchema, turtleText)
 *   const r = await client.validate(nodeId, shapeId)
 *   client.abort()
 *   client.terminate()
 */

export interface WorkerValidationResult {
  passed:  boolean
  elapsed: number
  errors:  string[]
}

type Resolve<T> = (value: T) => void
type Reject     = (reason: unknown) => void

export class ShExWorkerClient {
  private worker:   Worker
  private pending:  Map<number, { resolve: Resolve<WorkerValidationResult>; reject: Reject }>
  private nextId:   number
  private initRes:  Resolve<void> | null  = null
  private initRej:  Reject | null         = null
  private ready:    Promise<void>

  constructor() {
    this.pending = new Map()
    this.nextId  = 1

    // Vite handles `new Worker(new URL(…, import.meta.url), { type: 'module' })`
    // and emits a separate chunk for the worker script.
    this.worker = new Worker(
      new URL('./shex-worker.ts', import.meta.url),
      { type: 'module' },
    )

    // The worker posts { type: 'ready' } as soon as it loads.
    this.ready = new Promise<void>((resolve, reject) => {
      const onReady = (evt: MessageEvent<Record<string, unknown>>) => {
        if (evt.data.type === 'ready') {
          this.worker.removeEventListener('message', onReady)
          resolve()
        }
      }
      this.worker.addEventListener('message', onReady)
      this.worker.addEventListener('error', e => reject(new Error(`Worker load error: ${e.message}`)))
    })

    this.worker.addEventListener('message', (evt: MessageEvent<Record<string, unknown>>) => {
      this.handleMessage(evt.data)
    })
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'ready':
        break  // handled in constructor

      case 'init-ok':
        this.initRes?.(); this.initRes = null; this.initRej = null
        break

      case 'init-error':
        this.initRej?.(new Error(msg.message as string))
        this.initRes = null; this.initRej = null
        break

      case 'aborted':
        // Reject all pending validate promises
        for (const { reject } of this.pending.values())
          reject(new Error('aborted'))
        this.pending.clear()
        break

      case 'result': {
        const id  = msg.id as number
        const cb  = this.pending.get(id)
        if (cb) {
          this.pending.delete(id)
          cb.resolve({
            passed:  msg.passed as boolean,
            elapsed: msg.elapsed as number,
            errors:  msg.errors as string[],
          })
        }
        break
      }
    }
  }

  /**
   * Send the ShEx schema + Turtle graph to the worker.
   * Must complete before calling validate().
   */
  async init(shex: string, turtle: string): Promise<void> {
    await this.ready
    return new Promise<void>((resolve, reject) => {
      this.initRes = resolve
      this.initRej = reject
      this.worker.postMessage({ type: 'init', shex, turtle })
    })
  }

  /**
   * Validate one node against one shape.
   * Returns a result even if aborted (errors: ['aborted']).
   */
  validate(nodeId: string, shapeId: string): Promise<WorkerValidationResult> {
    const id = this.nextId++
    return new Promise<WorkerValidationResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ type: 'validate', id, nodeId, shapeId })
    })
  }

  /** Tell the worker to drop all pending work. */
  abort(): void {
    this.worker.postMessage({ type: 'abort' })
  }

  /** Hard-kill the worker (use when navigating away or replacing it). */
  terminate(): void {
    this.worker.terminate()
  }
}
