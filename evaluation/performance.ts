/**
 * Latency and cost of the runs in a recording.
 *
 * These are reported ONLY when they were measured: the recording must hold real
 * model outputs (`provenance: 'model'`) with a latency above zero or reported
 * token usage. A synthetic fixture was never timed and never billed, so its
 * figures are `unavailable`. A value is never estimated or invented here.
 *
 * Cost is computed from the recorded token usage with the production pricing
 * table (`computeCostMicroUsd`). No call is made.
 */

import { computeCostMicroUsd, resolveModelConfig } from '@/lib/services/openai/modelConfig'
import type { Recording, RecordingEntry } from './recording'

export interface LatencyReport {
  status: 'recorded' | 'unavailable'
  /** Why nothing is reported. Present only when the status is `unavailable`. */
  reason?: string
  runs: number
  p50_ms: number | null
  p95_ms: number | null
  max_ms: number | null
}

export interface CostReport {
  status: 'recorded' | 'unavailable'
  reason?: string
  runs_with_usage: number
  input_tokens: number | null
  output_tokens: number | null
  total_micro_usd: number | null
  median_micro_usd_per_run: number | null
}

export interface PerformanceReport {
  latency: LatencyReport
  cost: CostReport
}

const SYNTHETIC_REASON = 'Synthetic fixture: nothing was measured, so no figure is reported.'

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}

function unavailableLatency(reason: string): LatencyReport {
  return { status: 'unavailable', reason, runs: 0, p50_ms: null, p95_ms: null, max_ms: null }
}

function unavailableCost(reason: string): CostReport {
  return { status: 'unavailable', reason, runs_with_usage: 0, input_tokens: null, output_tokens: null, total_micro_usd: null, median_micro_usd_per_run: null }
}

/** Performance of the given entries. Pass only the entries of the cases being reported. */
export function computePerformance(recording: Pick<Recording, 'provenance' | 'model'>, entries: RecordingEntry[]): PerformanceReport {
  if (recording.provenance !== 'model') {
    return { latency: unavailableLatency(SYNTHETIC_REASON), cost: unavailableCost(SYNTHETIC_REASON) }
  }

  const timings = entries.map((entry) => entry.latency_ms).filter((value) => value > 0)
  const latency: LatencyReport = timings.length === 0
    ? unavailableLatency('The recording holds no measured timing.')
    : { status: 'recorded', runs: timings.length, p50_ms: percentile(timings, 50), p95_ms: percentile(timings, 95), max_ms: Math.max(...timings) }

  const config = resolveModelConfig(recording.model)
  const used = entries.filter((entry) => entry.usage !== undefined)
  if (!config || used.length === 0) {
    return { latency, cost: unavailableCost(config ? 'The recording holds no token usage.' : 'The recorded model has no pricing entry.') }
  }
  const costs = used.map((entry) => computeCostMicroUsd(config, entry.usage as NonNullable<RecordingEntry['usage']>))
  return {
    latency,
    cost: {
      status: 'recorded',
      runs_with_usage: used.length,
      input_tokens: used.reduce((sum, entry) => sum + (entry.usage?.input_tokens ?? 0), 0),
      output_tokens: used.reduce((sum, entry) => sum + (entry.usage?.output_tokens ?? 0), 0),
      total_micro_usd: costs.reduce((sum, value) => sum + value, 0),
      median_micro_usd_per_run: percentile(costs, 50),
    },
  }
}
