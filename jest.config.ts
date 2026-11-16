import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  // Default environment; individual test files that need DOM override with
  // @jest-environment jsdom in their file-level docblock.
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  // Every *.test.ts file under tests/ runs, so new suites are never silently skipped.
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  // `next build` (output: 'standalone') copies package.json into .next/; ignoring it
  // prevents Jest module-name collisions when tests run after a local build.
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
  transform: {
    '^.+\\.[tj]sx?$': [
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
