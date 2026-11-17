/**
 * Chooses how an evaluation runs. The evaluation command has exactly two modes
 * that do work, and neither can reach a model provider:
 *
 * - mock   (default): committed, hand-written fixture outputs. Runs in CI.
 * - replay: previously recorded model outputs, read from a file.
 *
 * A third mode, `check-references`, evaluates nothing: it validates a
 * human-review reference set against its manifest.
 *
 * Live calls are not part of this command at all. They exist only in the
 * benchmark runner (`npm run benchmark`), behind its own opt-in phrase and
 * spend cap. Asking this command for `live` is refused; it never falls back to
 * another mode, and a missing recording is an error rather than a reason to
 * fetch fresh outputs.
 */

export type EvaluationPlan =
  | { mode: 'mock' }
  | { mode: 'replay'; recordingPath: string; casesPath: string; baselinePath?: string; referencesPath?: string; imagesDir?: string }
  /** Validates a reference set against its manifest (and its images, when a directory is given). Evaluates nothing. */
  | { mode: 'check_references'; casesPath: string; referencesPath: string; imagesDir?: string }
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

  const casesPath = env.EVAL_CASES?.trim()
  const referencesPath = env.EVAL_REFERENCES?.trim()
  if (requested === 'check-references') {
    if (!casesPath) return { mode: 'refused', reason: 'Checking references needs EVAL_CASES (path to the manifest).' }
    if (!referencesPath) return { mode: 'refused', reason: 'Checking references needs EVAL_REFERENCES (path to the reference set).' }
    return { mode: 'check_references', casesPath, referencesPath, imagesDir: env.EVAL_IMAGES?.trim() || undefined }
  }
  if (requested !== 'replay') {
    return { mode: 'refused', reason: 'EVAL_MODE must be "mock", "replay" or "check-references".' }
  }

  const recordingPath = env.EVAL_RECORDING?.trim()
  if (!recordingPath) return { mode: 'refused', reason: 'Replay needs EVAL_RECORDING (path to a recording file). Nothing is fetched when it is missing.' }
  if (!casesPath) return { mode: 'refused', reason: 'Replay needs EVAL_CASES (path to the manifest the recording was made with).' }
  const baselinePath = env.EVAL_BASELINE?.trim()
  return { mode: 'replay', recordingPath, casesPath, baselinePath: baselinePath || undefined, referencesPath: referencesPath || undefined, imagesDir: env.EVAL_IMAGES?.trim() || undefined }
}

/**
 * Which committed dataset a mock run uses, and whether its baseline may be
 * replaced. Replacing a baseline is always an explicit request
 * (EVAL_UPDATE_BASELINE=1); the rules that can still refuse it are in regression.ts.
 */
export type DatasetRunOptions =
  | { ok: true; dataset: string; updateBaseline: boolean; acceptRegressions: boolean }
  | { ok: false; reason: string }

export function resolveDatasetOptions(env: Record<string, string | undefined>, knownDatasets: readonly string[], acceptPhrase: string): DatasetRunOptions {
  const dataset = (env.EVAL_DATASET ?? knownDatasets[0]).trim()
  if (!knownDatasets.includes(dataset)) return { ok: false, reason: `EVAL_DATASET must be one of: ${knownDatasets.join(', ')}.` }

  const update = (env.EVAL_UPDATE_BASELINE ?? '').trim()
  if (update !== '' && update !== '1') return { ok: false, reason: 'EVAL_UPDATE_BASELINE must be "1" or unset.' }

  const accept = (env.EVAL_ACCEPT_REGRESSIONS ?? '').trim()
  if (accept !== '' && accept !== acceptPhrase) return { ok: false, reason: `EVAL_ACCEPT_REGRESSIONS must be exactly "${acceptPhrase}" or unset.` }
  if (accept !== '' && update !== '1') return { ok: false, reason: 'EVAL_ACCEPT_REGRESSIONS only applies together with EVAL_UPDATE_BASELINE=1.' }

  return { ok: true, dataset, updateBaseline: update === '1', acceptRegressions: accept === acceptPhrase }
}
