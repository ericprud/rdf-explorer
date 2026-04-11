/**
 * handler-config.ts
 *
 * Lists the built-in pane handlers pre-registered at startup.
 * All five panes now have real handler implementations from their own packages.
 */

import { registerHandler } from './handler-registry'
import type { GraphHandler } from '@modular-rdf/graph-handler-api'
import { handler as graphHandlerImpl    } from '@modular-rdf/pane-graph'
import { handler as turtleHandlerImpl   } from '@modular-rdf/pane-turtle'
import { handler as sparqlHandlerImpl   } from '@modular-rdf/pane-sparql'
import { handler as shexHandlerImpl     } from '@modular-rdf/pane-shex'
import { handler as inferenceHandlerImpl } from '@modular-rdf/pane-inference'

// ── Built-in pane handlers ────────────────────────────────────────────────────

export const graphHandler:     GraphHandler = graphHandlerImpl
export const turtleHandler:    GraphHandler = turtleHandlerImpl
export const sparqlHandler:    GraphHandler = sparqlHandlerImpl
export const shexHandler:      GraphHandler = shexHandlerImpl
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
