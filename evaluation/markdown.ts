/**
 * The Markdown summary of an evaluation report.
 *
 * It answers, in order: what was evaluated, on which dataset, how valid the
 * outputs were, how they agree with human references, how each dimension did,
 * how reliable confidence was, how the image modes compare, what the
 * explanations claimed, what could not be measured, and what to do next.
 *
 * It contains aggregates, case ids and reviewer identifiers only. It never
 * contains model text, and it never merges the figures into one score.
 */

import { DIMENSION_KEYS } from '@/benchmark/harness'
import { GARMENT_MODES } from '@/lib/constants/garmentModes'
import type { EvaluationReport } from './evaluate'
import type { Metric } from './quality'
import { KEY_FACT_ATTRIBUTES, SCORED_TIERS, type ScoredTier } from './reference'

const TIER_TITLES: Record<ScoredTier, string> = {
  image_reviewed: 'Human-reviewed images',
  brief_derived: 'Brief-derived expectations (not image-grounded)',
  synthetic: 'Synthetic expectations (a check of the evaluation code, not accuracy)',
}

function show(value: number | null): string {
  return value === null ? 'n/a' : String(value)
}

function showMicroUsd(value: number | null): string {
  return value === null ? 'n/a' : `$${(value / 1_000_000).toFixed(6)}`
}

function showCounts(counts: Record<string, number>): string {
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key} ${value}`).join(', ') || 'none'
}

/** A figure with its sample size, or the reason there is none. Never a bare 0 for "not measured". */
export function showMetric(metric: Metric): string {
  if (metric.status === 'unavailable') return 'unavailable'
  if (metric.status === 'insufficient_sample') return `${metric.value} (n=${metric.n}, too few to conclude)`
  return `${metric.value} (n=${metric.n})`
}

function table(header: string[], rows: string[][]): string[] {
  return [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`), '']
}

function agreementSection(report: EvaluationReport, tier: ScoredTier): string[] {
  const agreement = report.quality.agreement[tier]
  if (agreement.reference_cases === 0) return []
  return [
    `### ${TIER_TITLES[tier]}`,
    '',
    `${agreement.cases_with_output} of ${agreement.reference_cases} referenced case(s) produced ratings (coverage ${showMetric(agreement.coverage)}).`,
    '',
    ...table(
      ['Dimension', 'Exact agreement', 'Within one band', 'Mean absolute error (bands)'],
      DIMENSION_KEYS.map((key) => [key, showMetric(agreement.dimensions[key].exact_rate), showMetric(agreement.dimensions[key].within_one_rate), showMetric(agreement.dimensions[key].mae)]),
    ),
  ]
}

function calibrationSection(report: EvaluationReport, tier: ScoredTier): string[] {
  const calibration = report.quality.calibration[tier]
  if (report.quality.agreement[tier].cases_with_output === 0) return []
  return [
    `### ${TIER_TITLES[tier]}`,
    '',
    ...table(
      ['Stated confidence', 'Exact agreement', 'Within one band'],
      (['High', 'Medium', 'Low'] as const).map((level) => [level, showMetric(calibration.buckets[level].exact_rate), showMetric(calibration.buckets[level].within_one_rate)]),
    ),
    `- High-confidence ratings that differ from the reference: ${showMetric(calibration.high_confidence_error_rate)}`,
    `- High-confidence ratings two or more bands off, or rating what cannot be judged (overconfident): ${showMetric(calibration.high_confidence_severe_error_rate)}`,
    `- Confidence gap (agreement at High minus agreement at Low): ${showMetric(calibration.confidence_gap)}`,
    `- Ordering of confidence levels: ${calibration.ordering.replace(/_/g, ' ')}`,
    '',
  ]
}

function groundingSection(report: EvaluationReport, tier: ScoredTier): string[] {
  const grounding = report.quality.grounding[tier]
  if (report.quality.agreement[tier].cases_with_output === 0) return []
  return [
    `### ${TIER_TITLES[tier]}`,
    '',
    `- Cases that list key facts: ${grounding.cases_with_facts}`,
    `- Key facts mentioned (supported claims): ${showMetric(grounding.key_fact_mention_rate)}`,
    `- Supporting facts mentioned: ${showMetric(grounding.supporting_fact_mention_rate)}`,
    `- By attribute: ${KEY_FACT_ATTRIBUTES.map((attribute) => `${attribute} ${showMetric(grounding.mention_rate_by_attribute[attribute])}`).join('; ')}`,
    `- Cases using a word that contradicts a listed fact: ${showMetric(grounding.contradiction_rate)}`,
    `- Cases stating a detail the reviewer marked as not visible (unsupported claims): ${showMetric(grounding.unverifiable_claim_rate)}`,
    `- Uncertainty handled where the reviewer could not judge a dimension: ${showMetric(grounding.uncertainty_handling_rate)}`,
    `- Cases that never mention a key fact: ${grounding.cases_missing_key_facts.length === 0 ? 'none' : grounding.cases_missing_key_facts.join(', ')}`,
    '',
  ]
}

/** A short Markdown summary of a report. Contains aggregates only, never model text. */
export function renderMarkdown(report: EvaluationReport): string {
  const { metrics, subject, summary, performance, references, quality } = report
  const failing = report.cases.filter((entry) => entry.status === 'fail')
  const flagged = report.cases.filter((entry) => entry.proxy_flags.length > 0)
  const tiers = references.cases_by_tier
  const multi = quality.multi_image
  const unavailableMetrics = Object.values(report.metric_index).filter((metric) => metric.status === 'unavailable').length
  const indicativeMetrics = Object.values(report.metric_index).filter((metric) => metric.status === 'insufficient_sample').length

  const otherTiers = SCORED_TIERS.filter((tier) => tier !== 'image_reviewed')
  const lines = [
    `# Evaluation report (${report.mode})`,
    '',
    `> ${report.interpretation}`,
    '',
    '## 1. What was evaluated',
    '',
    `- Outputs: ${report.provenance === 'model' ? 'recorded model outputs' : 'hand-written fixture outputs (not a model)'}`,
    `- Model: ${subject.model} (reasoning ${subject.reasoning_effort ?? 'n/a'}, max output ${subject.max_output_tokens})`,
    `- Prompt version: ${subject.prompt_version}${report.evaluated_with.same_prompt_as_recording ? '' : ` (current code: ${report.evaluated_with.prompt_version})`}`,
    `- Schema version: ${subject.schema_version}${report.evaluated_with.same_schema_as_recording ? '' : ` (current code: ${report.evaluated_with.schema_version})`}`,
    '',
    '## 2. Dataset and references',
    '',
    `- Dataset: ${report.dataset.fingerprint}, ${report.dataset.cases} cases, ${report.dataset.cases_with_verified_labels} with verified labels${report.dataset.matches_recording ? '' : ' — DIFFERS from the dataset the recording was made with'}`,
    `- Cases evaluated: ${report.selection.cases_evaluated}${report.selection.partial ? ' — PARTIAL RUN: only the selected cases were evaluated; this report cannot become a baseline' : ''}`,
    references.status === 'loaded'
      ? `- Reference set: ${references.dataset} version ${references.dataset_version} (${references.fingerprint})`
      : '- Reference set: none',
    `- Cases by reference tier: image-reviewed ${tiers.image_reviewed}, brief-derived ${tiers.brief_derived}, synthetic ${tiers.synthetic}, unreviewed ${tiers.unreviewed}, no reference ${references.cases_without_reference}`,
    ...(references.image_reviewers.length > 0 ? [`- Image reviews by: ${references.image_reviewers.join(', ')} (${references.image_reviews_from} to ${references.image_reviews_to})`] : []),
    '',
    '## 3. Output validity',
    '',
    `- Runs scored: ${metrics.runs} (${metrics.withheld_runs} withheld)`,
    `- Valid structured output rate: ${show(metrics.structured_output.valid_rate)}; error codes: ${showCounts(metrics.structured_output.error_codes)}`,
    `- Latency: ${performance.latency.status === 'recorded' ? `p50 ${performance.latency.p50_ms} ms, p95 ${performance.latency.p95_ms} ms over ${performance.latency.runs} runs` : `unavailable (${performance.latency.reason})`}`,
    `- Cost: ${performance.cost.status === 'recorded' ? `${showMicroUsd(performance.cost.total_micro_usd)} total, ${showMicroUsd(performance.cost.median_micro_usd_per_run)} median per run over ${performance.cost.runs_with_usage} runs` : `unavailable (${performance.cost.reason})`}`,
    '',
    '## 4. Cases',
    '',
    `- Total: ${summary.total_cases} (passed ${summary.passed}, failed ${summary.failed}, not applicable ${summary.not_applicable})`,
    `- Pass rate: ${show(summary.pass_rate)}`,
    `- Safety failures: ${summary.safety_failures}; unsupported-claim failures: ${summary.unsupported_claim_failures}; schema failures: ${summary.schema_failures}`,
    `- Uncertainty failures: ${summary.uncertainty_failures}; verdict integrity failures: ${summary.verdict_integrity_failures}`,
    `- Failures by category: ${showCounts(summary.failures_by_category)}`,
    `- Failures by scenario: ${showCounts(summary.failures_by_scenario)}`,
    `- Proxy flags for human review (not failures, not a measure of fashion quality): occasion ${summary.proxy_flags.proxy_occasion}, explanation ${summary.proxy_flags.proxy_explanation}`,
    '',
    ...(failing.length > 0 ? table(['Failing case', 'Reason'], failing.flatMap((entry) => entry.failure_reasons.map((reason) => [entry.case_id, reason]))) : []),
    ...(flagged.length > 0 ? table(['Case flagged for review', 'Proxy'], flagged.flatMap((entry) => entry.proxy_flags.map((flag) => [entry.case_id, flag]))) : []),
    '## 5. Agreement with human-reviewed references',
    '',
    ...(quality.image_grounded_accuracy.status === 'available'
      ? agreementSection(report, 'image_reviewed')
      : [quality.image_grounded_accuracy.reason as string, '', 'No figure below this line is evidence about accuracy on real images.', '']),
    ...(otherTiers.some((tier) => quality.agreement[tier].reference_cases > 0)
      ? ['## 6. Agreement with other expectations', '', 'These are not accuracy on real images.', '', ...otherTiers.flatMap((tier) => agreementSection(report, tier))]
      : []),
    '## 7. Confidence',
    '',
    `- Stated confidence across all ratings: High ${metrics.confidence.distribution.High}, Medium ${metrics.confidence.distribution.Medium}, Low ${metrics.confidence.distribution.Low}`,
    `- Ratings that stay the same on repeated runs at High / Medium / Low confidence: ${show(metrics.confidence.stability_by_confidence.High.stable_rate)} / ${show(metrics.confidence.stability_by_confidence.Medium.stable_rate)} / ${show(metrics.confidence.stability_by_confidence.Low.stable_rate)}`,
    '',
    ...(SCORED_TIERS.every((tier) => quality.agreement[tier].cases_with_output === 0)
      ? ['Confidence against references: unavailable (no scored reference).', '']
      : SCORED_TIERS.flatMap((tier) => calibrationSection(report, tier))),
    '## 8. Image modes',
    '',
    ...table(
      ['Mode', 'Cases', 'Runs', 'Valid output', 'Same rating on repeats', 'Runs with unsupported claims', 'Exact agreement with human reviews (pooled over dimensions)'],
      GARMENT_MODES.map((mode) => [mode, String(multi.modes[mode].cases), String(multi.modes[mode].scored_runs), showMetric(multi.modes[mode].valid_output_rate), showMetric(multi.modes[mode].repeat_rating_stability), String(multi.modes[mode].runs_with_unsupported_claims), showMetric(multi.modes[mode].agreement.image_reviewed.exact_rate)]),
    ),
    `- Outfit runs with one valid note per item: ${showMetric(multi.outfit_items.completeness_rate)}`,
    `- Per-item notes returned where none are expected: ${multi.outfit_items.unexpected_blocks_in_other_modes}`,
    `- Outfit garment type identified correctly (human-reviewed): ${showMetric(quality.garment_identification.image_reviewed.garment_type_accuracy)}`,
    ...otherTiers.filter((tier) => quality.garment_identification[tier].cases > 0).map((tier) => `- Outfit garment type matches the ${tier.replace('_', '-')} expectation (not accuracy): ${showMetric(quality.garment_identification[tier].garment_type_accuracy)}`),
    `- Comparison groups (same garment, different image mode): ${multi.comparison_groups.groups}; dimensions rated the same across a group: ${showMetric(multi.comparison_groups.cross_mode_rating_consistency)}; mean spread in bands: ${showMetric(multi.comparison_groups.mean_band_shift)}`,
    `- Several photos against one photo, exact agreement with human reviews: ${showMetric(multi.comparison_groups.multi_minus_single_exact.image_reviewed)}`,
    `- Repeated runs: ${metrics.stability.cases_with_repeats} case(s); same outcome on every run ${show(metrics.stability.same_outcome_case_rate)}; same rating per dimension ${DIMENSION_KEYS.map((key) => `${key} ${showMetric(quality.stability_by_dimension[key])}`).join(', ')}`,
    '',
    '## 9. Explanation grounding (proxy)',
    '',
    'These figures match the words of an explanation against facts a reviewer listed. They do not establish that an explanation is true.',
    '',
    `- Runs matching the price, label or material screening, or a claim the case forbids: ${metrics.screening.runs_with_forbidden_claims} forbidden-claim run(s), ${metrics.screening.runs_with_prohibited_hits} run(s) with any screening hit`,
    '',
    ...(SCORED_TIERS.every((tier) => quality.agreement[tier].cases_with_output === 0)
      ? ['Grounding against reference facts: unavailable (no scored reference).', '']
      : SCORED_TIERS.flatMap((tier) => groundingSection(report, tier))),
    '## 10. End to end and application',
    '',
    `- Verdict band agreement: ${show(metrics.verdict_band.agreement_rate)} (${metrics.verdict_band.graded_runs} graded runs)`,
    `- Abstention precision / recall: ${show(metrics.abstention.precision)} / ${show(metrics.abstention.recall)}; false abstention rate: ${show(metrics.abstention.false_abstention_rate)}`,
    `- Adversarial runs outside acceptable bands: ${metrics.adversarial.runs_outside_acceptable_bands} of ${metrics.adversarial.graded_runs}; outcome differs from the clean twin: ${show(metrics.adversarial.twin_outcome_change_rate)} (${metrics.adversarial.twin_pairs} pairs)`,
    `- Verdict recomputation matches: ${metrics.application.verdict_recomputation_matches}`,
    '',
    '## 11. What is unavailable',
    '',
    `- ${unavailableMetrics} of ${Object.keys(report.metric_index).length} indexed metrics have no figure; ${indicativeMetrics} more are built from fewer than ${quality.thresholds.min_sample} units and support no conclusion.`,
    `- Accuracy on real images: ${quality.image_grounded_accuracy.status === 'available' ? `available for ${quality.image_grounded_accuracy.cases} case(s)` : quality.image_grounded_accuracy.reason}`,
    ...Object.keys(quality.not_measurable).sort().map((key) => `- ${key.replace(/_/g, ' ')}: ${quality.not_measurable[key]}`),
    ...(quality.cases_with_unscored_manifest_facts > 0 ? [`- ${quality.cases_with_unscored_manifest_facts} case(s) list key facts as plain text in the manifest. Those are for a reviewer; only the facts of a reference are scored.`] : []),
    '',
    '## 12. What to do next',
    '',
    ...(report.next_steps.length === 0 ? ['- Nothing follows from this report.'] : report.next_steps.map((step) => `- ${step}`)),
    '',
  ]
  return lines.join('\n')
}
