import 'server-only'

/**
 * Spend guard used by the API route around every billable OpenAI call.
 *
 * Order: resolve model → parse limits → reserve the worst-case cost atomically
 * (rate limits, concurrency, daily and cumulative budgets) → call OpenAI →
 * settle with the actual cost, or keep the full reservation when the outcome is
 * unknown. Any failure of the store or its configuration fails closed.
 *
 * There is deliberately no endpoint to read or reset budgets. Counters can only
 * be inspected or changed in the Upstash console.
 */

import { randomUUID } from 'node:crypto'
import { logEvent, type ConfigIssue } from '@/lib/observability/safeLogger'
import { OpenAIAnalysisError } from '@/lib/services/openai/openAIErrors'
import {
  computeCostMicroUsd,
  estimateMaxCostMicroUsd,
  resolveModelConfig,
  type ModelConfig,
  type NormalizedUsage,
  type OpenAIOperation,
} from '@/lib/services/openai/modelConfig'
import { clientAddressFromHeaders, clientKey } from './clientIdentity'
import { parseSpendConfig, SpendConfigError } from './spendConfig'
import { createRedisSpendStore, type Lease, type RejectReason, type SpendStore } from './spendStore'
import { createUpstashEval, upstashConfigFromEnv } from './upstashRest'

export interface SpendRejection {
  status: 429 | 503
  body: { error: string; message: string }
  retryAfterS: number | null
}

export interface SpendTicket {
  /** Pass to the OpenAI service; records the provider-reported cost. */
  onUsage: (usage: NormalizedUsage) => void
  /** Settles the reservation. Safe to call more than once; never throws. */
  settle: (error?: unknown) => Promise<void>
}

export type SpendDecision = { allowed: true; ticket: SpendTicket } | { allowed: false; rejection: SpendRejection }

interface StoreHandle {
  store: SpendStore
  hashSecret: string
}

let testStore: StoreHandle | null | undefined
let warnedDisabled = false

/** Tests only: install a store (or null to simulate "not configured"); undefined restores env-based behaviour. */
export function setSpendStoreForTesting(handle: StoreHandle | null | undefined): void {
  testStore = handle
  warnedDisabled = false
}

const NOOP_TICKET: SpendTicket = { onUsage: () => undefined, settle: async () => undefined }

const UNAVAILABLE: SpendRejection = {
  status: 503,
  body: { error: 'service_unavailable', message: 'The analysis service is temporarily unavailable. Please try again later.' },
  retryAfterS: 60,
}

function rejectionFor(reason: RejectReason, retryAfterS: number | null): SpendRejection {
  switch (reason) {
    case 'rate_limited':
    case 'daily_rate_limited':
      return { status: 429, body: { error: 'rate_limit', message: 'You have reached the analysis limit for now. Please try again later.' }, retryAfterS }
    case 'client_busy':
      return { status: 429, body: { error: 'rate_limit', message: 'Your previous analysis is still running. Please wait for it to finish.' }, retryAfterS }
    case 'busy':
      return { status: 429, body: { error: 'rate_limit', message: 'The analysis service is busy. Please wait a moment and try again.' }, retryAfterS }
    case 'daily_budget_exhausted':
      return { status: 503, body: { error: 'service_unavailable', message: 'Verdict has reached its analysis limit for today. Please try again tomorrow.' }, retryAfterS }
    case 'total_budget_exhausted':
      return { status: 503, body: { error: 'service_unavailable', message: 'Verdict analysis is temporarily unavailable.' }, retryAfterS: null }
  }
}

function logConfigIssue(requestId: string | undefined, operation: OpenAIOperation, configIssue: ConfigIssue): void {
  logEvent('error', 'spend_guard_config_invalid', { request_id: requestId, operation, config_issue: configIssue })
}

/** Exact value required to allow unprotected billable calls in local `next dev`. */
export const UNPROTECTED_DEV_OPT_IN = 'I_ACCEPT_UNPROTECTED_SPEND'

/**
 * Billable calls without a spend store are allowed only in Jest (which mocks
 * every network call) or in local `next dev` with an explicit opt-in. Never in a
 * production build, whatever the opt-in says.
 */
function unprotectedCallsAllowed(): boolean {
  if (process.env.NODE_ENV === 'test') return true
  return process.env.NODE_ENV === 'development' && process.env.SPEND_GUARD_ALLOW_UNPROTECTED_DEV === UNPROTECTED_DEV_OPT_IN
}

function namespace(): string {
  return process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'
}

function resolveStore(): StoreHandle | 'missing' | 'invalid' {
  if (testStore !== undefined) return testStore ?? 'missing'
  const upstash = upstashConfigFromEnv()
  if (upstash.status !== 'configured') return upstash.status
  return {
    store: createRedisSpendStore(createUpstashEval(upstash.config), parseSpendConfig(), namespace()),
    hashSecret: upstash.config.token,
  }
}

/**
 * Decides whether a billable call may proceed. On `allowed`, the caller MUST call
 * `ticket.settle(error)` in a finally block after the OpenAI call.
 */
export async function reserveSpend(input: {
  operation: OpenAIOperation
  request: Request
  imageCount: number
  requestId?: string
}): Promise<SpendDecision> {
  const { operation, request, imageCount, requestId } = input

  // Without a supported model or a key the OpenAI service refuses before any
  // network call, so there is nothing billable to guard.
  const modelConfig = resolveModelConfig(process.env.OPENAI_MODEL)
  if (!modelConfig || !process.env.OPENAI_API_KEY) return { allowed: true, ticket: NOOP_TICKET }

  let handle: StoreHandle | 'missing' | 'invalid'
  let config
  try {
    config = parseSpendConfig()
    handle = resolveStore()
  } catch (error) {
    logConfigIssue(requestId, operation, error instanceof SpendConfigError ? 'spend_config_invalid' : 'spend_store_not_configured')
    return { allowed: false, rejection: UNAVAILABLE }
  }

  if (handle === 'invalid') {
    logConfigIssue(requestId, operation, 'spend_config_invalid')
    return { allowed: false, rejection: UNAVAILABLE }
  }
  if (handle === 'missing') {
    if (!unprotectedCallsAllowed()) {
      // Production, Preview and local development all share the same OpenAI credits,
      // so none of them make billable calls without the guard by default.
      logConfigIssue(requestId, operation, 'spend_store_not_configured')
      return { allowed: false, rejection: UNAVAILABLE }
    }
    if (!warnedDisabled) {
      warnedDisabled = true
      logEvent('warn', 'spend_guard_disabled', { request_id: requestId, operation, outcome: 'unprotected_without_store' })
    }
    return { allowed: true, ticket: NOOP_TICKET }
  }

  const nowMs = Date.now()
  const amountMicroUsd = estimateMaxCostMicroUsd(modelConfig, operation, imageCount)
  const leaseId = randomUUID()
  const key = clientKey(clientAddressFromHeaders(request.headers), handle.hashSecret)

  let result
  try {
    result = await handle.store.reserve({ operation, clientKey: key, leaseId, amountMicroUsd, nowMs })
  } catch {
    logEvent('error', 'spend_store_unavailable', { request_id: requestId, operation, outcome: 'reserve_failed' })
    return { allowed: false, rejection: UNAVAILABLE }
  }

  if (!result.ok) {
    logEvent('warn', 'spend_rejected', {
      request_id: requestId,
      operation,
      outcome: result.reason,
      reserved_micro_usd: amountMicroUsd,
      retry_after_s: result.retryAfterS ?? undefined,
    })
    return { allowed: false, rejection: rejectionFor(result.reason, result.retryAfterS) }
  }

  if (result.dailyWarning) {
    logEvent('warn', 'spend_daily_warning_threshold', {
      request_id: requestId,
      operation,
      reserved_micro_usd: config.dailyWarnMicroUsd,
    })
  }
  logEvent('debug', 'spend_reserved', { request_id: requestId, operation, model: modelConfig.id, reserved_micro_usd: amountMicroUsd })

  return { allowed: true, ticket: createTicket(handle.store, result.lease, modelConfig, operation, requestId) }
}

/**
 * Actual cost to settle with, or null when the outcome is unknown.
 * - Usage reported by the provider: its cost (covers success, schema failures and incomplete responses).
 * - Configuration errors: nothing was sent, so 0.
 * - HTTP 4xx from OpenAI (including 429): the request was rejected and not billed, so 0.
 * - Everything else (timeouts, network errors, 5xx, missing usage): unknown, keep the full reservation.
 */
export function settlementAmount(knownCostMicroUsd: number | null, error: unknown): number | null {
  if (knownCostMicroUsd !== null) return knownCostMicroUsd
  if (error instanceof OpenAIAnalysisError) {
    if (error.code === 'configuration_error') return 0
    if (error.status !== undefined && error.status >= 400 && error.status < 500) return 0
  }
  return null
}

function createTicket(store: SpendStore, lease: Lease, modelConfig: ModelConfig, operation: OpenAIOperation, requestId?: string): SpendTicket {
  let knownCost: number | null = null
  let settled = false
  return {
    onUsage: (usage) => {
      knownCost = computeCostMicroUsd(modelConfig, usage)
    },
    settle: async (error) => {
      if (settled) return
      settled = true
      const actual = settlementAmount(knownCost, error)
      try {
        const outcome = await store.settle(lease, actual)
        logEvent('info', 'spend_settled', {
          request_id: requestId,
          operation,
          model: modelConfig.id,
          outcome,
          reserved_micro_usd: lease.amountMicroUsd,
          cost_micro_usd: actual ?? undefined,
        })
      } catch {
        // The lease expires on its own and is then charged at the full reservation.
        logEvent('error', 'spend_settle_failed', { request_id: requestId, operation, reserved_micro_usd: lease.amountMicroUsd })
      }
    },
  }
}

export function applySpendRejectionHeaders(headers: Headers, rejection: SpendRejection): void {
  if (rejection.retryAfterS !== null) headers.set('Retry-After', String(rejection.retryAfterS))
}
