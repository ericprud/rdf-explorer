import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    test: {
      name:        'node',
      environment: 'node',
      include:     ['src/**/__tests__/node/**/*.test.ts',
                    'src/**/__tests__/*.test.ts'],
      exclude:     ['src/**/__tests__/dom/**/*.test.ts'],
    },
  },
  {
    test: {
      name:        'dom',
      environment: 'jsdom',
      include:     ['src/**/__tests__/dom/**/*.test.ts'],
    },
  },
])
