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

import { DIMENSION_KEYS, compositionLines } from '@/benchmark/harness'
import { GARMENT_MODES } from '@/lib/constants/garmentModes'
import type { EvaluationReport } from './evaluate'
import { styleDnaMetricName, type Metric, type StyleDnaCondition } from './quality'
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

const STRUCTURAL_LABELS: Array<[keyof EvaluationReport['quality']['visual_evidence']['structural'], string]> = [
  ['observations_valid_rate', 'Observations usable'],
  ['evidence_complete_rate', 'Evidence usable for all six dimensions'],
  ['invalid_citation_rate', 'Cites an observation that does not exist or was not visible'],
  ['unsupplied_source_rate', 'Names an input that was not sent'],
  ['support_conflict_rate', 'Evidence contradicts its rating'],
  ['unsupported_text_rate', 'States a price, material, brand, quality, link or instruction'],
  ['image_mapping_error_rate', 'Observations not mapped one per garment image'],
  ['view_contradiction_rate', 'Views said to be one garment but identified as different garments'],
  ['outfit_identity_consistency_rate', 'Outfit items: per-item note and observation name the same kind of garment'],
  ['evidence_relevance_proxy_rate', 'Evidence points at the kind of fact its dimension is about (proxy)'],
]

const REFERENCE_LABELS: Array<[Exclude<keyof EvaluationReport['quality']['visual_evidence']['by_tier'][ScoredTier], 'cases'>, string]> = [
  ['garment_category_accuracy', 'Garment category matches the reviewer'],
  ['confident_misidentification_rate', 'Identified with confidence as a different garment'],
  ['identification_abstention_rate', 'Abstains where the reviewer could not identify the garment'],
  ['dominant_colour_recall', 'Reviewer\'s dominant colour families reported'],
  ['unsupported_colour_rate', 'Colour families the reviewer did not list'],
  ['pattern_accuracy', 'Pattern matches the reviewer'],
  ['visual_abstention_rate', 'Does not state as observed what the reviewer could not see'],
  ['supported_detail_rate', 'Details the reviewer confirmed'],
  ['contradicted_detail_rate', 'Details the reviewer marked absent or unverifiable'],
  ['same_garment_agreement_rate', 'Views: same-garment answer matches the reviewer'],
]

const OCCASION_LABELS: Array<[Exclude<keyof EvaluationReport['quality']['occasion'], 'applicable' | 'reason' | 'cases_without_profile'>, string]> = [
  ['occasion_evidence_context_rate', 'Occasion evidence names the occasion as a source'],
  ['occasion_reason_relevance_rate', 'Occasion reason uses the occasion or its profile (proxy)'],
  ['formality_occasion_conflict_rate', 'Formality rated Poor while occasion fit is Excellent'],
  ['unsupported_assumption_rate', 'Occasion explanation assumes a culture, religion or region (proxy)'],
  ['seasonality_overconfidence_rate', 'High-confidence seasonality with no season stated'],
  ['preference_without_input_rate', 'Preference match rated with no preferences or Style DNA'],
  ['occasion_sensitivity_rate', 'Occasion fit changes across contrasting occasions (groups)'],
]

/** Occasion intelligence (Phase 4 Milestone 2). Aggregates only; never model text. */
function occasionSection(report: EvaluationReport): string[] {
  const occasion = report.quality.occasion
  const heading = ['## 9c. Occasion intelligence', '']
  if (!occasion.applicable) return [...heading, occasion.reason as string, '']
  return [
    ...heading,
    'Whether outputs follow the occasion-profile rules. None of these figures says whether a rating is right.',
    '',
    ...table(['Figure', 'Value'], OCCASION_LABELS.map(([key, label]) => [label, showMetric(occasion[key])])),
    `- Cases whose occasion has no profile: ${occasion.cases_without_profile.length === 0 ? 'none' : occasion.cases_without_profile.join(', ')}`,
    '',
  ]
}

/** Observations and rating evidence (analysis-output/3). Aggregates only; never model text. */
function visualEvidenceSection(report: EvaluationReport): string[] {
  const visual = report.quality.visual_evidence
  const heading = ['## 9b. Observations and evidence', '']
  if (!visual.applicable) return [...heading, visual.reason as string, '']
  const fixture = report.provenance !== 'model'
  return [
    ...heading,
    fixture
      ? 'Hand-written fixture outputs: these figures check that Verdict validates the blocks as intended. They say nothing about how well any model observes garments.'
      : 'Recorded model outputs. The blocks are informational; none of these figures is part of the verdict.',
    '',
    ...table(['Structural figure (no reference needed)', 'Value'], STRUCTURAL_LABELS.map(([key, label]) => [label, showMetric(visual.structural[key])])),
    `- Runs with usable observations per mode: ${GARMENT_MODES.map((mode) => `${mode} ${visual.valid_runs_by_mode[mode]}`).join(', ')}`,
    '',
    ...SCORED_TIERS.flatMap((tier) => {
      const block = visual.by_tier[tier]
      if (block.cases === 0) return tier === 'image_reviewed' ? [`Observations against human-reviewed images: ${block.garment_category_accuracy.reason ?? 'unavailable'}.`, ''] : []
      return [`### ${TIER_TITLES[tier]}`, '', ...table(['Figure', 'Value'], REFERENCE_LABELS.map(([key, label]) => [label, showMetric(block[key])]))]
    }),
  ]
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

/** How far reviewers agree with each other. Shown wherever a second review exists, whatever the outputs are. */
function reviewerSection(report: EvaluationReport, tier: ScoredTier): string[] {
  const reviewers = report.quality.reviewer_agreement[tier]
  if (reviewers.cases === 0) return []
  return [
    `### Agreement between reviewers: ${TIER_TITLES[tier].toLowerCase()}`,
    '',
    `${reviewers.cases} case(s) were rated by a second person, independently. Where two careful people differ, neither is wrong, and a model rating inside their range is not an error.`,
    '',
    ...table(
      ['Dimension', 'Reviewers: same rating', 'Reviewers: within one band', 'Reviewers: mean distance (bands)', `${report.provenance === 'model' ? 'Model' : 'Fixture outputs (not a model)'} within the reviewers' range`],
      DIMENSION_KEYS.map((key) => [key, showMetric(reviewers.dimensions[key].exact_rate), showMetric(reviewers.dimensions[key].within_one_rate), showMetric(reviewers.dimensions[key].mean_distance), showMetric(reviewers.model_within_reviewer_range[key])]),
    ),
    ...(reviewers.disagreements.length === 0
      ? ['No recorded disagreement between reviewers.', '']
      : table(['Case reviewers differ on', 'Dimensions', 'Far apart (two bands or more, or one reviewer could not judge)'], reviewers.disagreements.map((entry) => [entry.case_id, entry.dimensions.join(', '), entry.severe.join(', ') || 'none']))),
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

/** A figure of one Style DNA condition. Unavailable when the condition has too few cases behind it. */
function conditionMetric(report: EvaluationReport, condition: StyleDnaCondition, name: string): string {
  const metric = report.metric_index[styleDnaMetricName(condition, name)]
  return metric ? showMetric(metric) : 'unavailable'
}

function pooledMetric(report: EvaluationReport, name: string): string {
  const metric = report.metric_index[name]
  return metric ? showMetric(metric) : 'unavailable'
}

/**
 * Style DNA is a condition on a case, not a garment mode. When a report mixes both conditions, this section
 * puts the pooled figure next to the figure of each condition, so that neither is read for the other.
 */
function styleDnaSection(report: EvaluationReport): string[] {
  const summary = report.quality.style_dna
  if (!summary.mixed) return ['### With and without Style DNA', '', summary.reading, '']
  const rows: Array<[string, string]> = [
    ['Valid output', 'validity.valid_output_rate'],
    ['Verdict band agreement', 'end_to_end.verdict_band_agreement_rate'],
    ...GARMENT_MODES.map((mode): [string, string] => [`Valid output, ${mode}`, `multi_image.${mode}.valid_output_rate`]),
    ...DIMENSION_KEYS.map((key): [string, string] => [`Exact agreement with human reviews, ${key}`, `agreement.image_reviewed.${key}.exact_rate`]),
    ...GARMENT_MODES.map((mode): [string, string] => [`Exact agreement with human reviews, ${mode} (pooled over dimensions)`, `multi_image.${mode}.agreement.image_reviewed.exact_rate`]),
  ]
  const separate = Object.entries(report.metric_index).filter(([name]) => name.startsWith('style_dna.'))
  const available = separate.filter(([, metric]) => metric.status === 'measured').length
  return [
    '### With and without Style DNA',
    '',
    `Style DNA is a condition on a case, not a garment mode. ${summary.cases_with_style_dna} evaluated case(s) send a profile and ${summary.cases_without_style_dna} do not. A profile changes what the model is told, so the two are not the same question.`,
    '',
    `- A **pooled** figure combines both conditions. Every figure in sections 3 to 10 is pooled unless it says otherwise.`,
    `- A **separate** figure is given for a condition only when at least ${report.quality.thresholds.min_sample} cases of that condition stand behind it. With fewer it is unavailable: it is not shown as a small-sample value.`,
    `- ${available} of ${separate.length} separate figures are available in this report. All of them are in the metric index, under \`style_dna.with_style_dna.\` and \`style_dna.without_style_dna.\`.`,
    '',
    ...table(['Figure', 'Without Style DNA', 'With Style DNA', 'Pooled (both together)'], rows.map(([label, name]) => [label, conditionMetric(report, 'without_style_dna', name), conditionMetric(report, 'with_style_dna', name), pooledMetric(report, name)])),
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
  // Said at the head of every section whose figures combine both Style DNA conditions. Empty for a single-condition report.
  const styleDna = quality.style_dna
  const pooled = styleDna.mixed ? [`**Pooled:** the figures of this section combine ${styleDna.cases_with_style_dna} case(s) with and ${styleDna.cases_without_style_dna} without Style DNA, unless a line says otherwise. Separate figures per condition: section 8, "With and without Style DNA".`, ''] : []
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
    ...(report.evaluated_with.same_prompt_as_recording && report.evaluated_with.same_schema_as_recording
      ? []
      : ['- **The recording was made with a different prompt or schema than the current code.** Every figure describes the recorded prompt and schema. None of them is evidence about the current prompt.']),
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
    ...(references.image_reviewers.length > 0 ? [`- Rated by a second person as well: ${references.image_cases_with_second_review} of ${tiers.image_reviewed} image-reviewed case(s)${references.image_second_reviewers.length > 0 ? ` (${references.image_second_reviewers.join(', ')})` : ''}`] : []),
    ...compositionLines(report.composition).map((line) => `- ${line}`),
    '',
    '## 3. Output validity',
    '',
    ...pooled,
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
    `- Uncertainty failures: ${summary.uncertainty_failures}; verdict integrity failures: ${summary.verdict_integrity_failures}; observation and evidence failures: ${summary.visual_evidence_failures ?? 0}`,
    `- Failures by category: ${showCounts(summary.failures_by_category)}`,
    `- Failures by scenario: ${showCounts(summary.failures_by_scenario)}`,
    `- Proxy flags for human review (not failures, not a measure of fashion quality): occasion ${summary.proxy_flags.proxy_occasion}, explanation ${summary.proxy_flags.proxy_explanation}`,
    '',
    ...(failing.length > 0 ? table(['Failing case', 'Reason'], failing.flatMap((entry) => entry.failure_reasons.map((reason) => [entry.case_id, reason]))) : []),
    ...(flagged.length > 0 ? table(['Case flagged for review', 'Proxy'], flagged.flatMap((entry) => entry.proxy_flags.map((flag) => [entry.case_id, flag]))) : []),
    '## 5. Agreement with human-reviewed references',
    '',
    ...(quality.image_grounded_accuracy.status === 'available' ? pooled : []),
    ...(quality.image_grounded_accuracy.status === 'available'
      ? ['A reference rating is one reviewer\'s judgement, not a fact about the image. "Agreement" means agreement with that reviewer.', '', ...agreementSection(report, 'image_reviewed')]
      : [quality.image_grounded_accuracy.reason as string, '', 'No figure below this line is evidence about accuracy on real images.', '']),
    ...reviewerSection(report, 'image_reviewed'),
    ...(otherTiers.some((tier) => quality.agreement[tier].reference_cases > 0)
      ? ['## 6. Agreement with other expectations', '', 'These are not accuracy on real images.', '', ...pooled, ...otherTiers.flatMap((tier) => [...agreementSection(report, tier), ...reviewerSection(report, tier)])]
      : []),
    '## 7. Confidence',
    '',
    ...pooled,
    `- Stated confidence across all ratings: High ${metrics.confidence.distribution.High}, Medium ${metrics.confidence.distribution.Medium}, Low ${metrics.confidence.distribution.Low}`,
    `- Ratings that stay the same on repeated runs at High / Medium / Low confidence: ${show(metrics.confidence.stability_by_confidence.High.stable_rate)} / ${show(metrics.confidence.stability_by_confidence.Medium.stable_rate)} / ${show(metrics.confidence.stability_by_confidence.Low.stable_rate)}`,
    '',
    ...(SCORED_TIERS.every((tier) => quality.agreement[tier].cases_with_output === 0)
      ? ['Confidence against references: unavailable (no scored reference).', '']
      : SCORED_TIERS.flatMap((tier) => calibrationSection(report, tier))),
    '## 8. Image modes',
    '',
    ...pooled,
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
    ...styleDnaSection(report),
    '## 9. Explanation grounding (proxy)',
    '',
    ...pooled,
    'These figures match the words of an explanation against facts a reviewer listed. They do not establish that an explanation is true.',
    '',
    `- Runs matching the price, label or material screening, or a claim the case forbids: ${metrics.screening.runs_with_forbidden_claims} forbidden-claim run(s), ${metrics.screening.runs_with_prohibited_hits} run(s) with any screening hit`,
    '',
    ...(SCORED_TIERS.every((tier) => quality.agreement[tier].cases_with_output === 0)
      ? ['Grounding against reference facts: unavailable (no scored reference).', '']
      : SCORED_TIERS.flatMap((tier) => groundingSection(report, tier))),
    ...visualEvidenceSection(report),
    ...occasionSection(report),
    '## 10. End to end and application',
    '',
    ...(styleDna.mixed ? ['**Pooled:** the first four lines combine cases with and without Style DNA. The Shopping Advisor lines are each about one condition only, by definition.', ''] : []),
    `- Verdict band agreement: ${show(metrics.verdict_band.agreement_rate)} (${metrics.verdict_band.graded_runs} graded runs)`,
    `- Abstention precision / recall: ${show(metrics.abstention.precision)} / ${show(metrics.abstention.recall)}; false abstention rate: ${show(metrics.abstention.false_abstention_rate)}`,
    `- Adversarial runs outside acceptable bands: ${metrics.adversarial.runs_outside_acceptable_bands} of ${metrics.adversarial.graded_runs}; outcome differs from the clean twin: ${show(metrics.adversarial.twin_outcome_change_rate)} (${metrics.adversarial.twin_pairs} pairs)`,
    `- Verdict recomputation matches: ${metrics.application.verdict_recomputation_matches}`,
    `- Shopping Advisor with Style DNA (advisory only, never part of the verdict): usable block ${showMetric(quality.shopping_advisor.availability_rate)}; recommendations that address only dimensions rated Excellent ${showMetric(quality.shopping_advisor.mistargeted_recommendation_rate)}`,
    `- Shopping Advisor without Style DNA: recommendations returned although none were asked for ${showMetric(quality.shopping_advisor.unrequested_recommendation_rate)}`,
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
