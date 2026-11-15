/**
 * Redis Lua scripts for atomic spend reservation and settlement.
 *
 * Each script runs atomically on the Redis server, so concurrent serverless
 * invocations cannot both pass a limit check. All amounts are integer micro-USD.
 *
 * Accounting model (conservative):
 * - A reservation adds its full worst-case amount to the daily and cumulative
 *   counters immediately, before the OpenAI call.
 * - Settlement with a known actual cost adjusts the counters to that cost.
 * - Settlement with an unknown outcome, or a lease that expires unsettled, keeps
 *   the full reservation charged. Unknown outcomes are never refunded.
 * Counters therefore never under-count application spend, provided every
 * reservation is at least the real cost of its call.
 */

/**
 * KEYS: 1 day_spent, 2 total_spent, 3 leases (zset: id -> expiry ms), 4 lease_amounts (hash),
 *       5 client_leases (zset), 6 rate_window, 7 rate_day, 8 warn_flag
 * ARGV: 1 now_ms, 2 lease_id, 3 amount, 4 day_limit, 5 total_limit, 6 max_concurrent,
 *       7 max_concurrent_per_client, 8 rate_window_limit, 9 rate_window_ttl_s,
 *       10 rate_day_limit, 11 lease_expiry_ms, 12 warn_threshold, 13 day_ttl_s
 * Returns {1, 'reserved', warn(0|1)} or {0, reason}.
 */
export const RESERVE_SCRIPT = `
local now = tonumber(ARGV[1])
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now)
for _, id in ipairs(expired) do redis.call('HDEL', KEYS[4], id) end
if #expired > 0 then redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', now) end
redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', now)

if tonumber(redis.call('GET', KEYS[6]) or '0') >= tonumber(ARGV[8]) then return {0, 'rate_limited'} end
if tonumber(redis.call('GET', KEYS[7]) or '0') >= tonumber(ARGV[10]) then return {0, 'daily_rate_limited'} end
if redis.call('ZCARD', KEYS[5]) >= tonumber(ARGV[7]) then return {0, 'client_busy'} end
if redis.call('ZCARD', KEYS[3]) >= tonumber(ARGV[6]) then return {0, 'busy'} end

local amount = tonumber(ARGV[3])
if tonumber(redis.call('GET', KEYS[2]) or '0') + amount > tonumber(ARGV[5]) then return {0, 'total_budget_exhausted'} end
if tonumber(redis.call('GET', KEYS[1]) or '0') + amount > tonumber(ARGV[4]) then return {0, 'daily_budget_exhausted'} end

local dayTtl = tonumber(ARGV[13])
if redis.call('INCR', KEYS[6]) == 1 then redis.call('EXPIRE', KEYS[6], tonumber(ARGV[9])) end
if redis.call('INCR', KEYS[7]) == 1 then redis.call('EXPIRE', KEYS[7], dayTtl) end

local expiry = tonumber(ARGV[11])
redis.call('ZADD', KEYS[3], expiry, ARGV[2])
redis.call('ZADD', KEYS[5], expiry, ARGV[2])
redis.call('PEXPIREAT', KEYS[5], expiry + 60000)
redis.call('HSET', KEYS[4], ARGV[2], amount)

local day = redis.call('INCRBY', KEYS[1], amount)
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], dayTtl) end
redis.call('INCRBY', KEYS[2], amount)

local warn = 0
if day >= tonumber(ARGV[12]) and redis.call('SET', KEYS[8], '1', 'NX', 'EX', dayTtl) then warn = 1 end
return {1, 'reserved', warn}
`

/**
 * KEYS: 1 day_spent, 2 total_spent, 3 leases, 4 lease_amounts, 5 client_leases
 * ARGV: 1 lease_id, 2 actual (micro-USD, or -1 when unknown), 3 reserved amount
 * Returns 'settled' | 'kept' | 'expired'.
 */
export const SETTLE_SCRIPT = `
local actual = tonumber(ARGV[2])
local stored = redis.call('HGET', KEYS[4], ARGV[1])
if not stored then
  -- Already swept and charged at the full reservation. Only an overrun is added.
  local excess = actual - tonumber(ARGV[3])
  if actual >= 0 and excess > 0 then
    redis.call('INCRBY', KEYS[1], excess)
    redis.call('INCRBY', KEYS[2], excess)
  end
  return 'expired'
end
redis.call('HDEL', KEYS[4], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('ZREM', KEYS[5], ARGV[1])
if actual < 0 then return 'kept' end
local delta = actual - tonumber(stored)
if delta ~= 0 then
  redis.call('INCRBY', KEYS[1], delta)
  redis.call('INCRBY', KEYS[2], delta)
end
return 'settled'
`
