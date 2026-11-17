#!/usr/bin/env node
/**
 * Starts the evaluation runner with options given as flags, so the same
 * commands work on Windows, macOS and Linux (no shell-specific `VAR=value`).
 *
 *   node scripts/evaluation/run-eval.cjs --dataset scenarios-v1
 *   node scripts/evaluation/run-eval.cjs --dataset scenarios-v1 --cases sc-office-tailored,sc-wedding-hoodie
 *   node scripts/evaluation/run-eval.cjs --dataset scenarios-v1 --scenarios wedding,party
 *   node scripts/evaluation/run-eval.cjs --dataset scenarios-v1 --update-baseline
 *
 * It only sets environment variables for evaluation/run.eval.ts and starts
 * Jest. It never sets an opt-in for live model calls: the evaluation runner has
 * no live mode.
 */

const { spawnSync } = require('node:child_process')
const path = require('node:path')

const FLAGS = {
  '--dataset': 'EVAL_DATASET',
  '--cases': 'EVAL_CASE_IDS',
  '--categories': 'EVAL_CATEGORIES',
  '--scenarios': 'EVAL_SCENARIOS',
  '--accept-regressions': 'EVAL_ACCEPT_REGRESSIONS',
}

function parse(argv) {
  const env = {}
  for (let i = 0; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=')
    if (flag === '--update-baseline') { env.EVAL_UPDATE_BASELINE = '1'; continue }
    if (!Object.prototype.hasOwnProperty.call(FLAGS, flag)) throw new Error(`Unknown option: ${argv[i]}`)
    const value = inline !== undefined ? inline : argv[++i]
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} needs a value`)
    env[FLAGS[flag]] = value
  }
  return env
}

function main() {
  let options
  try {
    options = parse(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 2
  }
  const root = path.resolve(__dirname, '..', '..')
  const jest = require.resolve('jest/bin/jest', { paths: [root] })
  const outcome = spawnSync(process.execPath, [jest, '--config', 'jest.evaluation.config.ts', '--runInBand'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...options },
  })
  return outcome.status === null ? 1 : outcome.status
}

process.exit(main())
