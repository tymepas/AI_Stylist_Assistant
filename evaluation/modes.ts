/**
 * Chooses how an evaluation runs. The evaluation command has exactly two modes
 * that do work, and neither can reach a model provider:
 *
 * - mock   (default): committed, hand-written fixture outputs. Runs in CI.
 * - replay: previously recorded model outputs, read from a file.
 *
 * Live calls are not part of this command at all. They exist only in the
 * benchmark runner (`npm run benchmark`), behind its own opt-in phrase and
 * spend cap. Asking this command for `live` is refused; it never falls back to
 * another mode, and a missing recording is an error rather than a reason to
 * fetch fresh outputs.
 */

export type EvaluationPlan =
  | { mode: 'mock' }
  | { mode: 'replay'; recordingPath: string; casesPath: string; baselinePath?: string }
  | { mode: 'refused'; reason: string }

export const EVALUATION_MODES = ['mock', 'replay'] as const

export function resolveEvaluationPlan(env: Record<string, string | undefined>): EvaluationPlan {
  const requested = (env.EVAL_MODE ?? 'mock').trim().toLowerCase()

  if (requested === 'live') {
    return {
      mode: 'refused',
      reason: 'The evaluation command never calls a model. Live runs go through "npm run benchmark" with its explicit opt-in and spend cap, and write a recording that can then be replayed here.',
    }
  }
  if (requested === 'mock') return { mode: 'mock' }
  if (requested !== 'replay') {
    return { mode: 'refused', reason: 'EVAL_MODE must be "mock" or "replay".' }
  }

  const recordingPath = env.EVAL_RECORDING?.trim()
  const casesPath = env.EVAL_CASES?.trim()
  if (!recordingPath) return { mode: 'refused', reason: 'Replay needs EVAL_RECORDING (path to a recording file). Nothing is fetched when it is missing.' }
  if (!casesPath) return { mode: 'refused', reason: 'Replay needs EVAL_CASES (path to the manifest the recording was made with).' }
  const baselinePath = env.EVAL_BASELINE?.trim()
  return { mode: 'replay', recordingPath, casesPath, baselinePath: baselinePath || undefined }
}
