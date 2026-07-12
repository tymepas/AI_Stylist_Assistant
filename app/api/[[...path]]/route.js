import { MongoClient } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { NextResponse } from 'next/server'
import { getMockAnalysis, parseStyleProfile, validateImageFile } from '@/lib/services/analysisService'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { analyzeWithOpenAI, OpenAIAnalysisError } from '@/lib/services/openai/openAIAnalysisService'

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
    if (route === '/analyze' && method === 'POST') {
      const formData = await request.formData().catch(() => null)
      const occasion = formData?.get('occasion')
      const photo = formData?.get('photo')
      const garment = formData?.get('garment')
      const styleProfile = formData?.get('styleProfile')

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
        })

        const result = rawAnalysis.status === 'complete'
          ? buildCompleteAnalysisResult(rawAnalysis.dimensions)
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
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
