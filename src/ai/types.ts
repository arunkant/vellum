/** A single image+text request to a vision-capable LLM. */
export interface VisionRequest {
  /** Absolute path to the image file. */
  imagePath: string;
  /** The user/system prompt to send alongside the image. */
  prompt: string;
}

export interface VisionResponse {
  /** Raw text content returned by the model. */
  content: string;
  /** The model identifier the provider actually used (post-routing). */
  model: string;
}

/**
 * Abstract provider for image-conditioned LLM calls.
 * OpenRouter is one implementation; future providers (local llama.cpp,
 * Anthropic direct, etc.) implement the same shape.
 */
export interface VisionProvider {
  readonly name: string;
  isConfigured(): boolean;
  complete(req: VisionRequest): Promise<VisionResponse | null>;
}
