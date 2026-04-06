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
    alias: { '@': resolve(__dirname, 'src') }
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
          // Worker script gets its own chunk so Vite emits it as a
          // separate file that can be loaded via new Worker(new URL(…))
          'shex-worker': ['./src/lib/shex-worker.ts'],
        }
      }
    }
  },
  optimizeDeps: {
    include: ['d3', 'n3', 'codemirror'],
    // Exclude worker from pre-bundling so it stays as a separate module
    exclude: ['./src/lib/shex-worker.ts'],
  },
  worker: {
    // Emit worker as ES module so it can use import() inside the worker
    format: 'es',
  },
})
