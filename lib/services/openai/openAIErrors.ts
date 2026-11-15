export type OpenAIAnalysisErrorCode =
  | 'configuration_error'
  | 'timeout'
  | 'rate_limit'
  | 'api_error'
  | 'invalid_response'
  /** The provider stopped before finishing (e.g. max_output_tokens). Tokens were still billed. */
  | 'incomplete'

export class OpenAIAnalysisError extends Error {
  constructor(
    public readonly code: OpenAIAnalysisErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'OpenAIAnalysisError'
  }
}
