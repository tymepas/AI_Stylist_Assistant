/**
 * Running part of a dataset: by case id, by image-condition category or by
 * scenario type.
 *
 * A filtered run is PARTIAL. Its report says so, and a partial report can never
 * become a baseline (see regression.ts). A filter that names something the
 * dataset does not contain is an error rather than an empty run, so a typo
 * cannot look like a pass.
 */

import { CASE_CATEGORIES, SCENARIO_TYPES, type BenchmarkCase } from '@/benchmark/harness'

export interface CaseSelection {
  caseIds?: string[]
  categories?: string[]
  scenarios?: string[]
}

export interface SelectionReport {
  /** True when a filter was applied, whatever it matched. */
  partial: boolean
  cases_evaluated: number
  filters: { case_ids: string[]; categories: string[]; scenarios: string[] }
}

function list(value: string | undefined): string[] {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean)
}

/** Reads EVAL_CASE_IDS, EVAL_CATEGORIES and EVAL_SCENARIOS (comma-separated). */
export function selectionFromEnv(env: Record<string, string | undefined>): CaseSelection {
  return { caseIds: list(env.EVAL_CASE_IDS), categories: list(env.EVAL_CATEGORIES), scenarios: list(env.EVAL_SCENARIOS) }
}

export function isFiltered(selection: CaseSelection | undefined): boolean {
  return Boolean(selection && ((selection.caseIds?.length ?? 0) + (selection.categories?.length ?? 0) + (selection.scenarios?.length ?? 0) > 0))
}

/**
 * The cases a selection picks. Filters of different kinds are combined with AND;
 * several values of one kind with OR. Throws when a filter is unknown or matches nothing.
 */
export function selectCases(cases: BenchmarkCase[], selection: CaseSelection | undefined): BenchmarkCase[] {
  if (!isFiltered(selection)) return cases
  const { caseIds = [], categories = [], scenarios = [] } = selection as CaseSelection

  const known = new Set(cases.map((benchmarkCase) => benchmarkCase.id))
  const unknownIds = caseIds.filter((id) => !known.has(id))
  if (unknownIds.length > 0) throw new Error(`Unknown case id(s): ${unknownIds.join(', ')}`)
  const unknownCategories = categories.filter((category) => !(CASE_CATEGORIES as readonly string[]).includes(category))
  if (unknownCategories.length > 0) throw new Error(`Unknown category: ${unknownCategories.join(', ')}`)
  const unknownScenarios = scenarios.filter((scenario) => !(SCENARIO_TYPES as readonly string[]).includes(scenario))
  if (unknownScenarios.length > 0) throw new Error(`Unknown scenario: ${unknownScenarios.join(', ')}`)

  const selected = cases.filter((benchmarkCase) =>
    (caseIds.length === 0 || caseIds.includes(benchmarkCase.id)) &&
    (categories.length === 0 || categories.includes(benchmarkCase.category)) &&
    (scenarios.length === 0 || (benchmarkCase.scenario !== undefined && scenarios.includes(benchmarkCase.scenario))))
  if (selected.length === 0) throw new Error('The selection matches no case in this dataset.')
  return selected
}

export function describeSelection(selection: CaseSelection | undefined, evaluated: number): SelectionReport {
  return {
    partial: isFiltered(selection),
    cases_evaluated: evaluated,
    filters: {
      case_ids: [...(selection?.caseIds ?? [])].sort(),
      categories: [...(selection?.categories ?? [])].sort(),
      scenarios: [...(selection?.scenarios ?? [])].sort(),
    },
  }
}
