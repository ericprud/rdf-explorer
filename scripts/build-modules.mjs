#!/usr/bin/env node
/**
 * build-modules.mjs
 *
 * Builds all @modular-rdf packages as standalone ES module bundles that can be
 * loaded dynamically by any rdf-explorer host — either via config.json URLs,
 * by dragging .js files onto the handler/loader drop-zones, or by third parties
 * publishing their own bundles to a CDN.
 *
 * The browser's native ES module loader rejects bare specifiers (import 'n3')
 * in blob:-loaded modules.  Each bundle externalises only what the host
 * guarantees via its import map (n3, @modular-rdf/util-rdf), and inlines
 * everything else.
 *
 * shex-worker.js is the exception: Web Workers don't inherit import maps in all
 * browsers, so it bundles all its deps (including @shexjs/* and n3) inline.
 *
 * OUTPUT
 *   public/panes/
 *     util-rdf.js        shared RDF utilities          ~  4 KB  external: n3
 *     pane-graph.js      force-directed graph view      ~ ??     external: n3, util-rdf
 *     pane-turtle.js     Turtle editor (CodeMirror)     ~ ??     external: n3, util-rdf
 *     pane-sparql.js     SPARQL SELECT pane             ~  8 KB  external: n3, util-rdf
 *     shex-worker.js     ShEx worker thread             ~886 KB  external: (none)
 *     pane-shex.js       ShEx validation pane           ~863 KB  external: n3, util-rdf
 *     pane-inference.js  RDFS/OWL type inference pane   ~ ??     external: n3, util-rdf
 *     pane-diff.js       Triple-level diff pane         ~ ??     external: n3, util-rdf
 *   public/loaders/
 *     knows-parser.js    "Alice knows Bob." DSL parser  ~  5 KB  external: n3, util-rdf
 *     pane-knows.js      foaf:knows round-trip viewer   ~ ??     external: n3, util-rdf
 *
 * USAGE
 *   node scripts/build-modules.mjs            # one-shot
 *   node scripts/build-modules.mjs --watch    # rebuild on save
 */

import esbuild from 'esbuild'
import { mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root    = resolve(__dirname, '..')                             // repo root
const pkgs    = resolve(root, 'packages', '@modular-rdf')
const pub     = resolve(pkgs, 'rdf-explorer', 'public')
const dist    = resolve(pkgs, 'rdf-explorer', 'dist')
const loaders = resolve(dist, 'loaders')  // knows-parser (GraphSource examples) — served from dist/
const panes   = resolve(pub, 'panes')     // util-rdf + all pane bundles
const watch   = process.argv.includes('--watch')

mkdirSync(loaders, { recursive: true })
mkdirSync(panes,   { recursive: true })

// Deps provided by the host via import map → must stay as bare specifiers.
const HOST_EXTERNALS = ['n3', '@modular-rdf/util-rdf']

const modules = [
  // ── Shared utilities ─────────────────────────────────────────────────────
  {
    label:      'util-rdf',
    entryPoint: resolve(pkgs, 'util-rdf',      'src', 'util-rdf.ts'),
    outfile:    resolve(panes,'util-rdf.js'),
    external:   ['n3'],
  },

  // ── Example GraphSource (parser) ──────────────────────────────────────────
  {
    label:      'knows-parser',
    entryPoint: resolve(pkgs, 'rdf-explorer', 'src', 'lib', 'knows-parser.ts'),
    outfile:    resolve(loaders, 'knows-parser.js'),
    external:   HOST_EXTERNALS,
  },

  // ── GraphHandler panes ────────────────────────────────────────────────────
  {
    label:      'pane-graph',
    entryPoint: resolve(pkgs, 'pane-graph',     'src', 'pane-graph.ts'),
    outfile:    resolve(panes,'pane-graph.js'),
    external:   HOST_EXTERNALS,
    // d3 is inlined — add 'd3' to HOST_EXTERNALS and the import map if size is a concern.
  },
  {
    label:      'pane-turtle',
    entryPoint: resolve(pkgs, 'pane-turtle',    'src', 'pane-turtle.ts'),
    outfile:    resolve(panes,'pane-turtle.js'),
    external:   HOST_EXTERNALS,
    // CodeMirror inlined (~800 KB); externalise in future if shared across panes.
  },
  {
    label:      'pane-sparql',
    entryPoint: resolve(pkgs, 'pane-sparql',    'src', 'pane-sparql.ts'),
    outfile:    resolve(panes,'pane-sparql.js'),
    external:   HOST_EXTERNALS,
  },
  {
    label:      'shex-worker',
    entryPoint: resolve(pkgs, 'pane-shex',      'src', 'shex-worker.ts'),
    outfile:    resolve(panes,'shex-worker.js'),
    // Workers don't reliably inherit the host import map, so bundle everything.
    external:   [],
  },
  {
    label:      'pane-shex',
    entryPoint: resolve(pkgs, 'pane-shex',      'src', 'pane-shex.ts'),
    outfile:    resolve(panes,'pane-shex.js'),
    external:   HOST_EXTERNALS,
    // shex-worker.js is resolved at runtime relative to this file or document.baseURI.
  },
  {
    label:      'pane-inference',
    entryPoint: resolve(pkgs, 'pane-inference', 'src', 'pane-inference.ts'),
    outfile:    resolve(panes,'pane-inference.js'),
    external:   HOST_EXTERNALS,
  },
  {
    label:      'pane-diff',
    entryPoint: resolve(pkgs, 'pane-diff',      'src', 'pane-diff.ts'),
    outfile:    resolve(panes,'pane-diff.js'),
    external:   HOST_EXTERNALS,
  },

  // ── Example GraphHandler — parallel to knows-parser in loaders/ ─────────────
  {
    label:      'pane-knows',
    entryPoint: resolve(pkgs, 'rdf-explorer', 'src', 'lib', 'knows-handler.ts'),
    outfile:    resolve(panes, 'pane-knows.js'),
    external:   HOST_EXTERNALS,
  },
]

const sharedOptions = {
  bundle:      true,
  format:      'esm',
  platform:    'browser',
  target:      'es2022',
  sourcemap:   true,
  treeShaking: true,
}

if (watch) {
  for (const { label, entryPoint, outfile, external } of modules) {
    const ctx = await esbuild.context({ ...sharedOptions, entryPoints: [entryPoint], outfile, external })
    await ctx.watch()
    console.log(`[modules] watching ${label} → ${outfile.replace(root + '/', '')}`)
  }
  console.log('[modules] watching for changes (Ctrl+C to stop)...')
} else {
  const results = await Promise.allSettled(
    modules.map(({ label, entryPoint, outfile, external }) =>
      esbuild.build({ ...sharedOptions, entryPoints: [entryPoint], outfile, external })
        .then(() => ({ label, outfile: outfile.replace(root + '/', ''), ok: true  }))
        .catch(e  => ({ label, outfile: outfile.replace(root + '/', ''), ok: false, err: e }))
    )
  )

  let failed = false
  for (const { value: r } of results) {
    if (r.ok) console.log(`✓  ${r.label.padEnd(16)} →  ${r.outfile}`)
    else     { console.error(`✗  ${r.label}  FAILED:`, r.err?.message ?? r.err); failed = true }
  }
  if (failed) process.exit(1)
}
