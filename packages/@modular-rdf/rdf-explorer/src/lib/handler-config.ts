/**
 * handler-config.ts
 *
 * Lists the built-in pane handlers pre-registered at startup.
 *
 * graph, turtle, shex: still managed by main.ts stubs (DOM in HTML template).
 * sparql, inference: fully extracted — real handlers from their own packages.
 *   main.ts calls handler.mount(paneEl, callbacks) explicitly for these two.
 */

import { registerHandler } from './handler-registry'
import type { GraphHandler, HandlerState, HandlerCallbacks } from '@modular-rdf/graph-handler-api'
import { handler as sparqlHandlerImpl    } from '@modular-rdf/pane-sparql'
import { handler as inferenceHandlerImpl } from '@modular-rdf/pane-inference'

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
      void _callbacks
    },
  }
}

// ── Built-in pane handlers ────────────────────────────────────────────────────

export const graphHandler:     GraphHandler = makeBuiltin('graph',  'Graph')
export const turtleHandler:    GraphHandler = makeBuiltin('turtle', 'Turtle')
export const shexHandler:      GraphHandler = makeBuiltin('shex',   'ShEx')

// Fully extracted handlers — real implementations from their own packages.
export const sparqlHandler:    GraphHandler = sparqlHandlerImpl
export const inferenceHandler: GraphHandler = inferenceHandlerImpl

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
 */
export function registerBuiltinHandlers(
  handlers: GraphHandler[] = BUILTIN_HANDLERS,
): void {
  for (const h of handlers) registerHandler(h)
}
