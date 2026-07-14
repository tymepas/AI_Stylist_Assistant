import { MongoClient } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { NextResponse } from 'next/server'
import { getMockAnalysis, parseStyleProfile, validateImageFile } from '@/lib/services/analysisService'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { buildShoppingAdvisor } from '@/lib/services/shoppingAdvisorService'
import { analyzeWithOpenAI, OpenAIAnalysisError } from '@/lib/services/openai/openAIAnalysisService'
// Phase 3 — AI Style Profile
import { parseAIStyleProfile } from '@/lib/services/aiStyleProfileService'
import { generateProfileWithOpenAI } from '@/lib/services/openai/openAIProfileService'
import { getMockProfile } from '@/lib/constants/mockProfile'

// MongoDB connection (lazy - only used by the /status template endpoints below)
let client
let db

async function connectToMongo() {
  if (!client) {
    client = new MongoClient(process.env.MONGO_URL)
    await client.connect()
    db = client.db(process.env.DB_NAME)
  }
  return db
}

// Helper function to handle CORS
function handleCORS(response) {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  return response
}

// OPTIONS handler for CORS
export async function OPTIONS() {
  return handleCORS(new NextResponse(null, { status: 200 }))
}

// Route handler function
async function handleRoute(request, { params }) {
  const { path = [] } = await params
  const route = `/${path.join('/')}`
  const method = request.method

  try {
    // ------------------------------------------------------------------
    // Fashion Decision Assistant analysis endpoint.
    // No database is used for this route. ANALYSIS_MODE selects mock or OpenAI.
    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // Phase 3 — AI Style Profile generation endpoint.
    // Spec: specs/phase3/06_API_SPECIFICATION.md § "POST /api/generate-profile"
    // Error states: specs/phase3/10_ERROR_HANDLING.md § FG-01 through FG-14
    // ------------------------------------------------------------------
    if (route === '/generate-profile' && method === 'POST') {
      const formData = await request.formData().catch(() => null)
      const photo = formData?.get('photo')

      // FG-01 — no photo provided
      if (!formData || !isUploadedFile(photo)) {
        return handleCORS(NextResponse.json(
          { error: 'missing_image', message: 'Please upload a photo to generate your profile.' },
          { status: 400 }
        ))
      }

      // FG-02, FG-03, FG-04, FG-05 — image validation (type, size, format, dimensions)
      const photoCheck = await validateImageFile(photo)
      if (!photoCheck.valid) {
        return handleCORS(NextResponse.json(
          { error: 'invalid_upload', message: photoCheck.message },
          { status: 400 }
        ))
      }

      const profileMode = process.env.ANALYSIS_MODE?.trim().toLowerCase() || 'mock'

      // FG-14 — misconfigured ANALYSIS_MODE
      if (profileMode !== 'mock' && profileMode !== 'openai') {
        return handleCORS(NextResponse.json(
          { error: 'server_error', message: 'The profile generation service is not configured correctly.' },
          { status: 500 }
        ))
      }

      if (profileMode === 'mock') {
        // Return a canned profile after a simulated delay.
        const mockProfile = await getMockProfile()
        // Application sets generated_at_utc (spec: 06_API_SPECIFICATION.md)
        mockProfile.generated_at_utc = new Date().toISOString()
        return handleCORS(NextResponse.json(mockProfile))
      }

      // openai mode — call the AI, validate response, set generated_at_utc
      try {
        const profileResult = await generateProfileWithOpenAI({ photo })

        if (profileResult.status === 'complete') {
          // Application sets generated_at_utc — AI always returns ""
          profileResult.generated_at_utc = new Date().toISOString()
        }

        return handleCORS(NextResponse.json(profileResult))
      } catch (error) {
        if (error instanceof OpenAIAnalysisError) {
          return handleCORS(createProfileErrorResponse(error))
        }
        throw error
      }
    }

    // ------------------------------------------------------------------
    // Fashion Decision Assistant analysis endpoint.
    // No database is used for this route. ANALYSIS_MODE selects mock or OpenAI.
    // ------------------------------------------------------------------
    if (route === '/analyze' && method === 'POST') {
      const formData = await request.formData().catch(() => null)
      const occasion = formData?.get('occasion')
      const photo = formData?.get('photo')
      const garment = formData?.get('garment')
      const styleProfile = formData?.get('styleProfile')
      // Phase 3 — optional AI Style Profile (graceful degradation on invalid)
      const aiStyleProfileRaw = formData?.get('aiStyleProfile')

      if (!formData || typeof occasion !== 'string' || !occasion || !isUploadedFile(photo) || !isUploadedFile(garment)) {
        return handleCORS(NextResponse.json(
          {
            error: 'missing_image',
            message: 'Please upload a personal photo, a garment image, and select an occasion before analyzing.',
          },
          { status: 400 }
        ))
      }

      const photoCheck = await validateImageFile(photo)
      if (!photoCheck.valid) {
        return handleCORS(NextResponse.json(
          { error: 'invalid_upload', message: `Personal photo: ${photoCheck.message}` },
          { status: 400 }
        ))
      }

      const garmentCheck = await validateImageFile(garment)
      if (!garmentCheck.valid) {
        return handleCORS(NextResponse.json(
          { error: 'invalid_upload', message: `Garment photo: ${garmentCheck.message}` },
          { status: 400 }
        ))
      }

      const styleProfileCheck = parseStyleProfile(styleProfile)
      if (!styleProfileCheck.valid) {
        return handleCORS(NextResponse.json(
          { error: 'invalid_upload', message: styleProfileCheck.message },
          { status: 400 }
        ))
      }

      // FA-01 — AI profile: graceful degradation (never blocks analysis)
      const aiStyleProfileCheck = parseAIStyleProfile(aiStyleProfileRaw)
      // aiStyleProfileCheck.valid is always true (see parseAIStyleProfile spec)

      const analysisMode = process.env.ANALYSIS_MODE?.trim().toLowerCase() || 'mock'

      if (analysisMode === 'mock') {
        // Preserve the existing mock-mode behavior and latency.
        await new Promise((resolve) => setTimeout(resolve, 1400 + Math.random() * 1000))
        return handleCORS(NextResponse.json(getMockAnalysis()))
      }

      if (analysisMode !== 'openai') {
        return handleCORS(NextResponse.json(
          { error: 'server_error', message: 'The analysis service is not configured correctly.' },
          { status: 500 }
        ))
      }

      try {
        const rawAnalysis = await analyzeWithOpenAI({
          photo,
          garment,
          occasion,
          styleProfile: styleProfileCheck.profile,
          // Phase 3: pass AI profile as optional context; undefined when absent
          aiStyleProfile: aiStyleProfileCheck.profile ?? undefined,
        })

        const result = rawAnalysis.status === 'complete'
          ? buildCompleteAnalysisResult(
            rawAnalysis.dimensions,
            buildShoppingAdvisor(rawAnalysis.shopping_advisor, Boolean(aiStyleProfileCheck.profile))
          )
          : rawAnalysis

        return handleCORS(NextResponse.json(result))
      } catch (error) {
        if (error instanceof OpenAIAnalysisError) {
          return handleCORS(createOpenAIErrorResponse(error))
        }
        throw error
      }
    }

    // Root endpoint - GET /api/root (since /api/ is not accessible with catch-all)
    if (route === '/root' && method === 'GET') {
      return handleCORS(NextResponse.json({ message: "Hello World" }))
    }
    // Root endpoint - GET /api/
    if (route === '/' && method === 'GET') {
      return handleCORS(NextResponse.json({ message: "Hello World" }))
    }

    // Status endpoints - POST /api/status
    if (route === '/status' && method === 'POST') {
      const db = await connectToMongo()
      const body = await request.json()

      if (!body.client_name) {
        return handleCORS(NextResponse.json(
          { error: "client_name is required" },
          { status: 400 }
        ))
      }

      const statusObj = {
        id: uuidv4(),
        client_name: body.client_name,
        timestamp: new Date()
      }

      await db.collection('status_checks').insertOne(statusObj)
      return handleCORS(NextResponse.json(statusObj))
    }

    // Status endpoints - GET /api/status
    if (route === '/status' && method === 'GET') {
      const db = await connectToMongo()
      const statusChecks = await db.collection('status_checks')
        .find({})
        .limit(1000)
        .toArray()

      // Remove MongoDB's _id field from response
      const cleanedStatusChecks = statusChecks.map(({ _id, ...rest }) => rest)

      return handleCORS(NextResponse.json(cleanedStatusChecks))
    }

    // Route not found
    return handleCORS(NextResponse.json(
      { error: `Route ${route} not found` },
      { status: 404 }
    ))

  } catch (error) {
    console.error('API Error:', error)
    return handleCORS(NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    ))
  }
}

// Export all HTTP methods
export const GET = handleRoute

function isUploadedFile(value) {
  return value && typeof value !== 'string' && typeof value.arrayBuffer === 'function'
}

function createOpenAIErrorResponse(error) {
  const responses = {
    configuration_error: {
      status: 500,
      message: 'The analysis service is not configured. Please try again later.',
    },
    timeout: {
      status: 504,
      message: 'The analysis took too long. Please try again.',
    },
    rate_limit: {
      status: 429,
      message: 'The analysis service is busy. Please wait a moment and try again.',
    },
    invalid_response: {
      status: 502,
      message: 'The analysis could not be completed reliably. Please try again.',
    },
    api_error: {
      status: 502,
      message: 'The analysis service is temporarily unavailable. Please try again.',
    },
  }
  const response = responses[error.code] || responses.api_error
  return NextResponse.json(
    { error: 'server_error', message: response.message },
    { status: response.status }
  )
}

/**
 * Maps OpenAIAnalysisError codes to profile-generation-specific HTTP responses.
 * Spec: specs/phase3/06_API_SPECIFICATION.md § "Error Codes for POST /api/generate-profile"
 */
function createProfileErrorResponse(error) {
  const responses = {
    configuration_error: {
      status: 500,
      error: 'server_error',
      message: 'The service is not configured correctly. Please contact support.',
    },
    timeout: {
      status: 504,
      error: 'timeout',
      message: 'The analysis took too long. Please try again.',
    },
    rate_limit: {
      status: 429,
      error: 'rate_limit',
      message: 'The analysis service is busy right now. Please wait a moment and try again.',
    },
    invalid_response: {
      status: 502,
      error: 'api_error',
      message: 'Something went wrong during analysis. Please try again.',
    },
    api_error: {
      status: 502,
      error: 'api_error',
      message: 'The analysis service is temporarily unavailable. Please try again.',
    },
  }
  const response = responses[error.code] || responses.api_error
  return NextResponse.json(
    { error: response.error, message: response.message },
    { status: response.status }
  )
}
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
