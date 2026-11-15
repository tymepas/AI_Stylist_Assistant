import type { Config } from 'jest'

/**
 * Runs the model benchmark (benchmark/run.bench.ts) with the project's TypeScript
 * and path-alias setup. Kept separate so `npm test` can never start a benchmark.
 * Standalone (no import of jest.config.ts) because Jest loads TS configs as native ESM.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['<rootDir>/benchmark/run.bench.ts'],
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: { moduleResolution: 'node' } }],
  },
  restoreMocks: true,
  testTimeout: 2 * 60 * 60 * 1000,
}

export default config
