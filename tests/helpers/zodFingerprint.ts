/**
 * Canonical structural description of a Zod schema, for version-guard tests.
 *
 * Covers field names, enum values, literals, string and array bounds, nullability,
 * strictness and union structure. Custom refinement functions cannot be described;
 * only their presence is recorded. An unknown schema type throws, so a new kind of
 * field can never be silently left out of a fingerprint.
 *
 * Test-only: it reads Zod internals (`_def`), which production code must not depend on.
 */

import { fingerprint } from '@/lib/services/openai/promptVersion'

interface ZodLike {
  _def: Record<string, unknown> & { typeName?: string }
}

function checks(def: Record<string, unknown>): unknown {
  const list = (def.checks as Array<Record<string, unknown>> | undefined) ?? []
  return list.map((check) => ({ kind: check.kind, value: check.value ?? null }))
}

export function describeSchema(schema: unknown): unknown {
  const def = (schema as ZodLike)?._def
  const type = def?.typeName
  switch (type) {
    case 'ZodObject': {
      const shape = (def.shape as () => Record<string, unknown>)()
      return {
        type,
        unknownKeys: def.unknownKeys,
        shape: Object.fromEntries(Object.keys(shape).sort().map((key) => [key, describeSchema(shape[key])])),
      }
    }
    case 'ZodEnum':
      return { type, values: [...(def.values as string[])] }
    case 'ZodLiteral':
      return { type, value: def.value }
    case 'ZodString':
    case 'ZodNumber':
      return { type, checks: checks(def) }
    case 'ZodBoolean':
    case 'ZodUnknown':
      return { type }
    case 'ZodArray':
      return {
        type,
        element: describeSchema(def.type),
        min: (def.minLength as { value: number } | null)?.value ?? null,
        max: (def.maxLength as { value: number } | null)?.value ?? null,
        exact: (def.exactLength as { value: number } | null)?.value ?? null,
      }
    case 'ZodNullable':
    case 'ZodOptional':
      return { type, inner: describeSchema(def.innerType) }
    case 'ZodDiscriminatedUnion':
      return { type, discriminator: def.discriminator, options: [...(def.options as Iterable<unknown>)].map(describeSchema) }
    case 'ZodUnion':
      return { type, options: (def.options as unknown[]).map(describeSchema) }
    case 'ZodEffects':
      return { type, effect: (def.effect as { type: string }).type, inner: describeSchema(def.schema) }
    default:
      throw new Error(`describeSchema: unhandled schema type ${String(type)}. Add it before fingerprinting.`)
  }
}

export function schemaFingerprint(...schemas: unknown[]): string {
  return fingerprint(schemas.map((schema) => JSON.stringify(describeSchema(schema))))
}
