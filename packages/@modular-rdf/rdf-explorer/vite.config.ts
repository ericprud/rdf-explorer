import { defineConfig } from 'vite'
import { resolve } from 'path'

function buildInfoPlugin() {
  return {
    name: 'build-info',
    transformIndexHtml(html: string) {
      return html.replace('__BUILD_TIME__', new Date().toISOString())
    }
  }
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [buildInfoPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@modular-rdf/graph-source-api':  resolve(__dirname, '../graph-source-api/src/index.ts'),
      '@modular-rdf/graph-handler-api': resolve(__dirname, '../graph-handler-api/src/index.ts'),
      '@modular-rdf/rdf-utils':         resolve(__dirname, '../rdf-utils/src/index.ts'),
      '@modular-rdf/pane-sparql':       resolve(__dirname, '../pane-sparql/src/index.ts'),
      '@modular-rdf/pane-inference':    resolve(__dirname, '../pane-inference/src/index.ts'),
      '@modular-rdf/pane-graph':        resolve(__dirname, '../pane-graph/src/index.ts'),
      '@modular-rdf/pane-turtle':       resolve(__dirname, '../pane-turtle/src/index.ts'),
      '@modular-rdf/pane-shex':         resolve(__dirname, '../pane-shex/src/index.ts'),
    }
  },
  server: {
    watch: { usePolling: false },
    hmr: true,
    headers: { 'Cache-Control': 'no-store' }
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          'd3':         ['d3'],
          'n3':         ['n3'],
          'codemirror': ['codemirror', '@codemirror/state', '@codemirror/view',
                         '@codemirror/language', '@codemirror/commands',
                         '@codemirror/search', '@codemirror/autocomplete',
                         '@codemirror/theme-one-dark', 'codemirror-lang-turtle'],
          // shex-worker: Vite auto-detects new Worker(new URL(...)) and emits
          // a separate chunk — no manual entry needed.
        }
      }
    }
  },
  optimizeDeps: {
    include: ['d3', 'n3', 'codemirror'],
    // shex-worker is excluded from pre-bundling via the Vite worker config below
  },
  worker: {
    // Emit worker as ES module so it can use import() inside the worker
    format: 'es',
  },
})
