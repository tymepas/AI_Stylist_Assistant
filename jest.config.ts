import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  // Default environment; individual test files that need DOM override with
  // @jest-environment jsdom in their file-level docblock.
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // Only run Phase 3 unit tests in this suite.
  // Integration and AI tests are run separately.
  testMatch: ['<rootDir>/tests/phase3/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          // Relax module resolution for tests — ts-jest handles the path aliases above
          moduleResolution: 'node',
        },
      },
    ],
  },
  // Automatically restore mocks between tests
  restoreMocks: true,
  clearMocks: true,
  // Allow @jest-environment docblock annotations in test files
  testEnvironmentOptions: {},
}

export default config
