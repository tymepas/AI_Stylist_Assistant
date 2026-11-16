import type { Config } from 'jest'

/**
 * Runs the evaluation command (evaluation/run.eval.ts) with the project's
 * TypeScript and path-alias setup. The command has no live mode and disables
 * network access, so it can never start a billable call.
 * Standalone (no import of jest.config.ts) because Jest loads TS configs as native ESM.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['<rootDir>/evaluation/run.eval.ts'],
  modulePathIgnorePatterns: ['<rootDir>/.next/'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: { moduleResolution: 'node' } }],
  },
  restoreMocks: true,
}

export default config
