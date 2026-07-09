import { MongoClient } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { NextResponse } from 'next/server'
import { getMockAnalysis, validateImageMeta } from '@/lib/services/analysisService'

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
    // Fashion Decision Assistant - Phase 1 mock analysis endpoint.
    // No real AI model is called here. No database is used for this route.
    // See /app/lib/services/analysisService.ts and AI_OUTPUT_SCHEMA.md / PRD.md
    // ------------------------------------------------------------------
    if (route === '/analyze' && method === 'POST') {
      const body = await request.json().catch(() => null)

      if (!body || !body.occasion || !body.photo || !body.garment) {
        return handleCORS(NextResponse.json(
          {
            error: 'missing_image',
            message: 'Please upload a personal photo, a garment image, and select an occasion before analyzing.',
          },
          { status: 400 }
        ))
      }

      const photoCheck = validateImageMeta(body.photo)
      if (!photoCheck.valid) {
        return handleCORS(NextResponse.json(
          { error: 'invalid_upload', message: `Personal photo: ${photoCheck.message}` },
          { status: 400 }
        ))
      }

      const garmentCheck = validateImageMeta(body.garment)
      if (!garmentCheck.valid) {
        return handleCORS(NextResponse.json(
          { error: 'invalid_upload', message: `Garment photo: ${garmentCheck.message}` },
          { status: 400 }
        ))
      }

      // Simulate realistic multimodal AI latency (PRD target: under 5 seconds).
      await new Promise((resolve) => setTimeout(resolve, 1400 + Math.random() * 1000))

      const result = getMockAnalysis()
      return handleCORS(NextResponse.json(result))
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
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
