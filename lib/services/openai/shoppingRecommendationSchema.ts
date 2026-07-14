import { z } from 'zod'
import type { ShoppingRecommendation } from '@/types/schema'

const shoppingMatchLevelSchema = z.enum([
  'Excellent Match',
  'Strong Match',
  'Good Match',
  'Possible Match',
])

const shoppingGarmentCategorySchema = z.enum([
  'top',
  'bottom',
  'outerwear',
  'dress',
  'footwear',
  'accessory',
  'suiting',
  'traditional_wear',
])

const addressedDimensionSchema = z.enum([
  'occasion',
  'color',
  'formality',
  'seasonality',
  'style',
  'style_preference_match',
])

const shoppingRecommendationSchema = z.object({
  title: z.string().trim().min(2).max(80),
  garment_type: shoppingGarmentCategorySchema,
  color_direction: z.string().trim().min(2).max(60),
  style_direction: z.string().trim().min(2).max(100),
  rationale: z.string().trim().min(8).max(280),
  addresses: z.array(addressedDimensionSchema).min(1).max(2),
  match_level: shoppingMatchLevelSchema,
}).strict()

const shoppingAdvisorPayloadSchema = z.object({
  recommendations: z.array(shoppingRecommendationSchema).min(1).max(3),
}).strict()

export function validateShoppingRecommendations(value: unknown): ShoppingRecommendation[] {
  return shoppingAdvisorPayloadSchema.parse(value).recommendations
}