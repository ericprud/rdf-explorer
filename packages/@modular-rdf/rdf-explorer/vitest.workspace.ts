import { defineWorkspace } from 'vitest/config'
import { resolve } from 'path'

const apiAlias = {
  '@modular-rdf/graph-source-api':  resolve(__dirname, '../graph-source-api/src/index.ts'),
  '@modular-rdf/graph-handler-api': resolve(__dirname, '../graph-handler-api/src/index.ts'),
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
