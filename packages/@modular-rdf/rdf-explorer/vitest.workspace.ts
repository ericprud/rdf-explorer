import { defineWorkspace } from 'vitest/config'
import { resolve } from 'path'

const apiAlias = {
  '@modular-rdf/graph-source-api':  resolve(__dirname, '../graph-source-api/src/graph-source-api.ts'),
  '@modular-rdf/graph-handler-api': resolve(__dirname, '../graph-handler-api/src/graph-handler-api.ts'),
  '@modular-rdf/rdf-utils':         resolve(__dirname, '../rdf-utils/src/rdf-utils.ts'),
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
