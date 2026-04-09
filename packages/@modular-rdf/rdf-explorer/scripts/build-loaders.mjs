#!/usr/bin/env node
/**
 * build-loaders.mjs
 *
 * Compiles TypeScript loader modules into standalone ES module bundles that
 * the browser can load via blob: URL (dynamic import).
 *
 * The browser's native ES module loader enforces the URL standard: bare
 * specifiers like `import 'foo'` are illegal.  Vite rewrites them in the main
 * bundle, but blob: URL modules bypass Vite entirely.  The solution is to
 * bundle each loader with all its dependencies — including npm packages —
 * fully inlined, so the output has no bare specifiers at all.
 *
 * knows-parser.js   ~  10 KB   (no npm deps, only local files inlined)
 *
 * OUTPUT
 *   public/loaders/knows-parser.js
 *
 * USAGE
 *   node scripts/build-loaders.mjs            # one-shot
 *   node scripts/build-loaders.mjs --watch    # rebuild on save
 */

import esbuild from 'esbuild'
import { mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root   = resolve(__dirname, '..')
const outdir = resolve(root, 'public', 'loaders')
const watch  = process.argv.includes('--watch')

mkdirSync(outdir, { recursive: true })

const loaders = [
  {
    label:      'knows parser',
    entryPoint: resolve(root, 'src', 'lib', 'knows-parser.ts'),
    outfile:    resolve(outdir, 'knows-parser.js'),
    // No npm deps — only local files are inlined.
    external:   [],
  },
]

const sharedOptions = {
  bundle:      true,      // inline everything — no bare specifiers in output
  format:      'esm',     // ES module so the browser can import() it
  platform:    'browser',
  target:      'es2022',
  sourcemap:   true,
  treeShaking: true,
}

if (watch) {
  for (const { label, entryPoint, outfile, external } of loaders) {
    const ctx = await esbuild.context({ ...sharedOptions, entryPoints: [entryPoint], outfile, external })
    await ctx.watch()
    console.log(`[loaders] watching ${label} → ${outfile.replace(root + '/', '')}`)
  }
  console.log('[loaders] watching for changes (Ctrl+C to stop)...')
} else {
  const results = await Promise.allSettled(
    loaders.map(({ label, entryPoint, outfile, external }) =>
      esbuild.build({ ...sharedOptions, entryPoints: [entryPoint], outfile, external })
        .then(() => ({ label, outfile: outfile.replace(root + '/', ''), ok: true  }))
        .catch(e  => ({ label, outfile: outfile.replace(root + '/', ''), ok: false, err: e }))
    )
  )

  let failed = false
  for (const { value: r } of results) {
    if (r.ok) console.log(`✓  ${r.label}  →  ${r.outfile}`)
    else    { console.error(`✗  ${r.label}  FAILED:`, r.err?.message ?? r.err); failed = true }
  }
  if (failed) process.exit(1)
}
