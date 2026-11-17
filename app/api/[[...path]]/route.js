import { NextResponse } from 'next/server'
import { getMockAnalysis, parseStyleProfile } from '@/lib/services/analysisService'
import { buildCompleteAnalysisResult } from '@/lib/services/analysisResultService'
import { buildShoppingAdvisor } from '@/lib/services/shoppingAdvisorService'
import { buildOutfitComponents } from '@/lib/services/outfitComponentsService'
import {
  aggregateSizeProblem,
  declaredSizeProblem,
  findDuplicateGarment,
  garmentLabel,
  intakeImage,
  isUploadedFile,
  mockOutfitComponents,
  readGarmentUploads,
} from '@/lib/services/uploadIntake'
import { analyzeWithOpenAI, OpenAIAnalysisError } from '@/lib/services/openai/openAIAnalysisService'
// Phase 3 — AI Style Profile
import { parseAIStyleProfile } from '@/lib/services/aiStyleProfileService'
import { generateProfileWithOpenAI } from '@/lib/services/openai/openAIProfileService'
import { getMockProfile } from '@/lib/constants/mockProfile'
import { createRequestId, logEvent } from '@/lib/observability/safeLogger'
import { MAX_OCCASION_LENGTH } from '@/lib/services/requestLimits'
import { applySpendRejectionHeaders, reserveSpend } from '@/lib/spend/spendGuard'
import { ALLOWED_METHODS, applyCorsHeaders, evaluateOrigin, isStateChanging } from '@/lib/security/originPolicy'

// Vercel function limit. Must stay above every OpenAI timeout (lib/services/openai/modelConfig.ts)
// and equal ROUTE_MAX_DURATION_S (lib/spend/spendConfig.ts), which sizes spend reservations.
export const maxDuration = 60

// OPTIONS: CORS preflight. Only origins listed in CORS_ORIGINS get an answer they can use.
export async function OPTIONS(request) {
  const origin = evaluateOrigin(request.headers)
  if (!origin.allowed) {
    const rejected = new NextResponse(null, { status: 403 })
    applyCorsHeaders(rejected.headers, origin)
    return rejected
  }
  const response = new NextResponse(null, { status: 204, headers: { Allow: ALLOWED_METHODS } })
  applyCorsHeaders(response.headers, origin, { preflight: true })
  return response
}

// Route handler function
async function handleRoute(request, { params }) {
  // Server-generated id that correlates the log events of one request.
  const requestId = createRequestId()
  const startedAt = Date.now()
  const { path = [] } = await params
  const route = `/${path.join('/')}`
  const method = request.method

  const origin = evaluateOrigin(request.headers)
  const handleCORS = (response) => {
    applyCorsHeaders(response.headers, origin)
    // Lets a user quote the id when reporting a problem. It is random, is not
    // stored anywhere, and no endpoint looks anything up by it.
    response.headers.set('X-Request-Id', requestId)
    return response
  }

  // Mock mode never reaches the model client, so it gets its own trace event.
  const logMockCompleted = (operation, outcome) => {
    logEvent('info', 'api_request_completed', {
      request_id: requestId,
      endpoint: route,
      operation,
      analysis_mode: 'mock',
      outcome,
      http_status: 200,
      duration_ms: Date.now() - startedAt,
    })
  }

  // A browser on another site can send a multipart POST without a preflight, so
  // refusing to share the response is not enough: the request itself is refused
  // here, before validation, spend reservation or any model call.
  if (isStateChanging(method) && !origin.allowed) {
    logEvent('warn', 'api_origin_rejected', { request_id: requestId, endpoint: route, http_status: 403 })
    return handleCORS(NextResponse.json(
      { error: 'forbidden_origin', message: 'This request is not allowed from this origin.' },
      { status: 403 }
    ))
  }

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
      // Refused before the body is read: an oversized request costs nothing.
      const profileTooLarge = declaredSizeProblem(request.headers)
      if (profileTooLarge) return handleCORS(NextResponse.json(profileTooLarge.body, { status: profileTooLarge.status }))

      const formData = await request.formData().catch(() => null)
      const uploadedPhoto = formData?.get('photo')

      // FG-01 — no photo provided
      if (!formData || !isUploadedFile(uploadedPhoto)) {
        return handleCORS(NextResponse.json(
          { error: 'missing_image', message: 'Please upload a photo to generate your profile.' },
          { status: 400 }
        ))
      }

      const profileSizeProblem = aggregateSizeProblem([uploadedPhoto])
      if (profileSizeProblem) return handleCORS(NextResponse.json(profileSizeProblem.body, { status: profileSizeProblem.status }))

      // FG-02, FG-03, FG-04, FG-05 — image validation (type, size, format, dimensions),
      // then decoding and re-encoding. Only the re-encoded JPEG is used from here on.
      const profilePhoto = await intakeImage(uploadedPhoto, '', 'photo.jpg')
      if (!profilePhoto.ok) return handleCORS(NextResponse.json(profilePhoto.problem.body, { status: profilePhoto.problem.status }))
      const photo = profilePhoto.file

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
        logMockCompleted('profile', mockProfile.status)
        return handleCORS(NextResponse.json(mockProfile))
      }

      // openai mode — reserve spend, call the AI, validate response, set generated_at_utc
      const profileSpend = await reserveSpend({ operation: 'profile', request, imageCount: 1, requestId })
      if (!profileSpend.allowed) return handleCORS(createSpendRejectionResponse(profileSpend.rejection))

      let profileError
      try {
        const profileResult = await generateProfileWithOpenAI({ photo, requestId, onUsage: profileSpend.ticket.onUsage })

        if (profileResult.status === 'complete') {
          // Application sets generated_at_utc — AI always returns ""
          profileResult.generated_at_utc = new Date().toISOString()
        }

        return handleCORS(NextResponse.json(profileResult))
      } catch (error) {
        profileError = error
        if (error instanceof OpenAIAnalysisError) {
          return handleCORS(createProfileErrorResponse(error))
        }
        throw error
      } finally {
        await profileSpend.ticket.settle(profileError)
      }
    }

    // ------------------------------------------------------------------
    // Fashion Decision Assistant analysis endpoint.
    // No database is used for this route. ANALYSIS_MODE selects mock or OpenAI.
    // ------------------------------------------------------------------
    if (route === '/analyze' && method === 'POST') {
      // Refused before the body is read: an oversized request costs nothing.
      const analysisTooLarge = declaredSizeProblem(request.headers)
      if (analysisTooLarge) return handleCORS(NextResponse.json(analysisTooLarge.body, { status: analysisTooLarge.status }))

      const formData = await request.formData().catch(() => null)
      const occasion = formData?.get('occasion')
      const uploadedPhoto = formData?.get('photo')
      const uploadedGarment = formData?.get('garment')
      const styleProfile = formData?.get('styleProfile')
      // Phase 3 — optional AI Style Profile (graceful degradation on invalid)
      const aiStyleProfileRaw = formData?.get('aiStyleProfile')

      if (!formData || typeof occasion !== 'string' || !occasion || !isUploadedFile(uploadedPhoto) || !isUploadedFile(uploadedGarment)) {
        return handleCORS(NextResponse.json(
          {
            error: 'missing_image',
            message: 'Please upload a personal photo, a garment image, and select an occasion before analyzing.',
          },
          { status: 400 }
        ))
      }

      // Occasions offered by the UI are short; a cap bounds prompt tokens and reserved spend.
      if (occasion.length > MAX_OCCASION_LENGTH) {
        return handleCORS(NextResponse.json(
          { error: 'invalid_upload', message: 'Please select a valid occasion.' },
          { status: 400 }
        ))
      }

      // One to three garment images and an explicit garment mode. A request without
      // a mode is a single-garment request, as before multiple images existed.
      const garmentUploads = readGarmentUploads(formData)
      if (!garmentUploads.ok) return handleCORS(NextResponse.json(garmentUploads.problem.body, { status: garmentUploads.problem.status }))
      const garmentMode = garmentUploads.mode

      const sizeProblem = aggregateSizeProblem([uploadedPhoto, ...garmentUploads.garments])
      if (sizeProblem) return handleCORS(NextResponse.json(sizeProblem.body, { status: sizeProblem.status }))

      // Every image is validated, decoded and re-encoded before anything else uses it.
      // Only the re-encoded JPEGs are used from here on; the uploaded bytes are not.
      const photoIntake = await intakeImage(uploadedPhoto, 'Personal photo', 'photo.jpg')
      if (!photoIntake.ok) return handleCORS(NextResponse.json(photoIntake.problem.body, { status: photoIntake.problem.status }))
      const photo = photoIntake.file

      const garments = []
      for (let index = 0; index < garmentUploads.garments.length; index += 1) {
        const garmentIntake = await intakeImage(
          garmentUploads.garments[index],
          garmentLabel(index, garmentUploads.garments.length),
          garmentUploads.garments.length === 1 ? 'garment.jpg' : `garment-${index + 1}.jpg`
        )
        if (!garmentIntake.ok) return handleCORS(NextResponse.json(garmentIntake.problem.body, { status: garmentIntake.problem.status }))
        garments.push(garmentIntake.file)
      }

      const duplicate = await findDuplicateGarment(garmentUploads.garments)
      if (duplicate !== null) {
        return handleCORS(NextResponse.json(
          { error: 'invalid_upload', message: `Garment photo ${duplicate} is the same file as an earlier garment photo. Please remove it or choose a different photo.` },
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
        const mockAnalysis = getMockAnalysis()
        if (mockAnalysis.status === 'complete') {
          // The mock result is already in the application's shape ({ availability, recommendations }).
          // buildShoppingAdvisor expects what a model returns ({ recommendations }) and rejects any
          // other key, so only the recommendations are passed on. They are validated like model output.
          mockAnalysis.shopping_advisor = buildShoppingAdvisor(
            { recommendations: mockAnalysis.shopping_advisor.recommendations },
            Boolean(aiStyleProfileCheck.profile),
            requestId
          )
          // A single-garment response is exactly what it always was.
          if (garmentMode !== 'single') mockAnalysis.garment_mode = garmentMode
          if (garmentMode === 'outfit_items') mockAnalysis.outfit_components = mockOutfitComponents(garments.length)
        }
        logMockCompleted('analysis', mockAnalysis.status)
        return handleCORS(NextResponse.json(mockAnalysis))
      }

      if (analysisMode !== 'openai') {
        return handleCORS(NextResponse.json(
          { error: 'server_error', message: 'The analysis service is not configured correctly.' },
          { status: 500 }
        ))
      }

      // The reservation covers every image that will be sent: the personal photo and one to three garment images.
      const analysisSpend = await reserveSpend({ operation: 'analysis', request, imageCount: 1 + garments.length, requestId })
      if (!analysisSpend.allowed) return handleCORS(createSpendRejectionResponse(analysisSpend.rejection))

      let analysisError
      try {
        const rawAnalysis = await analyzeWithOpenAI({
          photo,
          garment: garments[0],
          extraGarments: garments.slice(1),
          garmentMode,
          occasion,
          styleProfile: styleProfileCheck.profile,
          // Phase 3: pass AI profile as optional context; undefined when absent
          aiStyleProfile: aiStyleProfileCheck.profile ?? undefined,
          requestId,
          onUsage: analysisSpend.ticket.onUsage,
        })

        // The verdict is computed by the application from the ratings. The garment mode and
        // the per-item notes are attached to the result afterwards and never reach that calculation.
        const result = rawAnalysis.status === 'complete'
          ? buildCompleteAnalysisResult(
            rawAnalysis.dimensions,
            buildShoppingAdvisor(rawAnalysis.shopping_advisor, Boolean(aiStyleProfileCheck.profile), requestId),
            garmentMode === 'single'
              ? {}
              : { garmentMode, outfitComponents: buildOutfitComponents(rawAnalysis.outfit_components, garmentMode, garments.length, requestId) }
          )
          : rawAnalysis

        return handleCORS(NextResponse.json(result))
      } catch (error) {
        analysisError = error
        if (error instanceof OpenAIAnalysisError) {
          return handleCORS(createOpenAIErrorResponse(error))
        }
        throw error
      } finally {
        await analysisSpend.ticket.settle(analysisError)
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

    // Route not found
    return handleCORS(NextResponse.json(
      { error: `Route ${route} not found` },
      { status: 404 }
    ))

  } catch (error) {
    // Error messages and stacks can contain request data (e.g. JSON parse errors
    // quote the input) or connection strings, so only the error type is logged.
    logEvent('error', 'api_unhandled_error', {
      request_id: requestId,
      endpoint: route,
      error_name: error instanceof Error ? error.name : typeof error,
    })
    return handleCORS(NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    ))
  }
}

// Export all HTTP methods
export const GET = handleRoute

/** 429 or 503 from the spend guard, with Retry-After when retrying can help. */
function createSpendRejectionResponse(rejection) {
  const response = NextResponse.json(rejection.body, { status: rejection.status })
  applySpendRejectionHeaders(response.headers, rejection)
  return response
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
    // The provider stopped early (e.g. output cap reached). Same user message as invalid output.
    incomplete: {
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
    incomplete: {
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
