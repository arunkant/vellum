import path from 'node:path';
import { aiResultsTbl, screenshotsTbl, type AIResult } from '../db';
import { openRouterProvider } from './openrouter';
import { ANALYZE_PROMPT, chatPrompt, parseAnalyzeResponse } from './prompts';
import type { VisionProvider } from './types';

/** Single active provider. Swap here to support multiple providers. */
const provider: VisionProvider = openRouterProvider;

export async function analyzeScreenshot(filepath: string): Promise<AIResult | null> {
  const filename = path.basename(filepath);

  const cached = aiResultsTbl.getByFilename(filename);
  if (cached) return cached;

  if (!provider.isConfigured()) return null;

  try {
    const res = await provider.complete({ imagePath: filepath, prompt: ANALYZE_PROMPT });
    if (!res) return null;

    const parsed = parseAnalyzeResponse(res.content);
    const result: AIResult = {
      extractedText: parsed.extractedText,
      description: parsed.description,
      model: res.model,
      processedAt: Date.now(),
    };

    const row = screenshotsTbl.findByFilename(filename);
    if (row) aiResultsTbl.upsert(row.id, result);

    return result;
  } catch (err) {
    console.error('AI analysis failed:', err);
    return null;
  }
}

export async function chatAboutScreenshot(filepath: string, userMessage: string): Promise<string | null> {
  if (!provider.isConfigured()) {
    return '⚠️ No OpenRouter API key configured. Open Vellum settings to add your key.';
  }

  try {
    const res = await provider.complete({
      imagePath: filepath,
      prompt: chatPrompt(userMessage),
    });
    return res?.content || 'No response from AI.';
  } catch (err) {
    console.error('Chat failed:', err);
    return '❌ Failed to reach OpenRouter. Check your connection.';
  }
}
