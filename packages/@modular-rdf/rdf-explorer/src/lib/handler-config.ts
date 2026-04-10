/**
 * handler-config.ts
 *
 * Lists the built-in pane handlers pre-registered at startup.
 * The built-in handlers are lightweight adapters: they do not own their DOM
 * (the HTML skeleton in main.ts does), but they implement the GraphHandler
 * interface so external code can discover and interact with them.
 *
 * To replace a built-in pane, register a GraphHandler with the same `name`
 * via the drop area or via registerHandler() — the registry will call
 * destroy() on the old handler and swap in the new one.
 */

import { registerHandler } from './handler-registry'
import type { GraphHandler, HandlerState, HandlerCallbacks } from '@modular-rdf/graph-handler-api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBuiltin(name: string, label: string): GraphHandler {
  let _callbacks: HandlerCallbacks | null = null
  return {
    name,
    label,
    mount(_container: HTMLElement, callbacks: HandlerCallbacks): void {
      // Built-in panes own their DOM through the main.ts HTML skeleton.
      // We only record the callbacks so subclasses can call toast() etc.
      _callbacks = callbacks
    },
    update(_state: HandlerState): void {
      // Built-in panes are updated directly by main.ts (applyTurtle, etc.).
      // External code can override this by registering a replacement handler.
      void _callbacks
    },
  }
}

// ── Built-in pane stubs ───────────────────────────────────────────────────────

export const graphHandler:     GraphHandler = makeBuiltin('graph',     'Graph')
export const turtleHandler:    GraphHandler = makeBuiltin('turtle',    'Turtle')
export const sparqlHandler:    GraphHandler = makeBuiltin('sparql',    'SPARQL')
export const shexHandler:      GraphHandler = makeBuiltin('shex',      'ShEx')
export const inferenceHandler: GraphHandler = makeBuiltin('inference', 'Type Inference')

/** The ordered list of panes shown at startup. */
export const BUILTIN_HANDLERS: GraphHandler[] = [
  graphHandler,
  turtleHandler,
  sparqlHandler,
  shexHandler,
  inferenceHandler,
]

/**
 * Register all built-in handlers.
 * Called once at startup by main.ts.
 * Callers can substitute their own list before calling this to customise
 * which panes are shown (e.g. remove ShEx, add a custom SPARQL editor).
 */
export function registerBuiltinHandlers(
  handlers: GraphHandler[] = BUILTIN_HANDLERS,
): void {
  for (const h of handlers) registerHandler(h)
}
