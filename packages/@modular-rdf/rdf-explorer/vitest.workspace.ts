import { defineWorkspace } from 'vitest/config'
import { resolve } from 'path'

const apiAlias = {
  '@modular-rdf/api-graph-source':  resolve(__dirname, '../api-graph-source/src/api-graph-source.ts'),
  '@modular-rdf/api-graph-handler': resolve(__dirname, '../api-graph-handler/src/api-graph-handler.ts'),
  '@modular-rdf/util-rdf':         resolve(__dirname, '../util-rdf/src/util-rdf.ts'),
  '@modular-rdf/pane-sparql':       resolve(__dirname, '../pane-sparql/src/pane-sparql.ts'),
  '@modular-rdf/pane-inference':    resolve(__dirname, '../pane-inference/src/pane-inference.ts'),
  '@modular-rdf/pane-graph':        resolve(__dirname, '../pane-graph/src/pane-graph.ts'),
  '@modular-rdf/pane-turtle':       resolve(__dirname, '../pane-turtle/src/pane-turtle.ts'),
  '@modular-rdf/pane-shex':         resolve(__dirname, '../pane-shex/src/pane-shex.ts'),
}

export default defineWorkspace([
  {
    resolve: { alias: apiAlias },
    test: {
      name:        'node',
      environment: 'node',
      include:     ['src/**/__tests__/node/**/*.test.ts',
                    'src/**/__tests__/*.test.ts'],
      exclude:     ['src/**/__tests__/dom/**/*.test.ts'],
    },
  },
  {
    resolve: { alias: apiAlias },
    test: {
      name:        'dom',
      environment: 'jsdom',
      include:     ['src/**/__tests__/dom/**/*.test.ts'],
    },
  },
])
