/**
 * loader-config.ts
 *
 * Specifies which loaders are pre-registered at startup.
 *
 * ── DEV vs PROD ──────────────────────────────────────────────────────────────
 *
 * In DEVELOPMENT (default), the parsers listed in BUNDLED_LOADERS are imported
 * directly from their TypeScript source and registered immediately.  No drag-in
 * step is needed.
 *
 * In PRODUCTION, set BUNDLED_LOADERS to [] (or delete this file and remove its
 * import from main.ts).  Users drag compiled .js loader files onto the "Load"
 * title to register them, e.g. public/loaders/knows-parser.js.
 *
 * ── ADDING A LOADER ──────────────────────────────────────────────────────────
 *
 * 1. Write your loader in src/lib/my-loader.ts (implement GraphSource interface).
 * 2. Add a build entry in scripts/build-loaders.mjs.
 * 3. Import and add to BUNDLED_LOADERS below for dev convenience.
 *
 * ── EFFECT OF EMPTYING THIS LIST ─────────────────────────────────────────────
 *
 * Setting BUNDLED_LOADERS = [] and dragging public/loaders/knows-parser.js
 * onto the Load title has exactly the same runtime effect as having the Knows
 * parser in this list.  The only difference is the UX: bundled loaders appear
 * immediately on page load; dragged-in loaders appear after the drag.
 */

import { registerLoader } from './parser-registry'
import { parser as knowsParser } from './knows-parser'
// import { parser as knowsParser } from './knows-parser'   // uncomment to also pre-register

/**
 * Loaders to register at startup.
 * Set to [] for production (users drag in compiled .js files instead).
 */
const BUNDLED_LOADERS: never[] = [
  // knowsParser,   // drag public/loaders/knows-parser.js onto the Load title instead
]

export function registerDevLoaders(): void {
  for (const loader of BUNDLED_LOADERS) {
    registerLoader(loader)
  }
}
