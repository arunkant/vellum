import path from 'node:path';
import { getConfig } from '../config';
import { aiResultsTbl, screenshotsTbl, type AIResult } from '../db';
import { localLlamaProvider } from './local';
import { openRouterProvider } from './openrouter';
import { ANALYZE_PROMPT, chatPrompt, parseAnalyzeResponse } from './prompts';
import type { VisionProvider } from './types';

export { onStatusChange as onLocalLlmStatusChange, getStatus as getLocalLlmStatus,
  downloadModel as downloadLocalModel, cancelDownload as cancelLocalDownload,
  stop as stopLocalServer } from './llama-server';

function activeProvider(): VisionProvider {
  return getConfig().aiProvider === 'local' ? localLlamaProvider : openRouterProvider;
}

function unconfiguredMessage(): string {
  return getConfig().aiProvider === 'local'
    ? '⚠️ Local model not ready. Open Vellum settings and download the model.'
    : '⚠️ No OpenRouter API key configured. Open Vellum settings to add your key.';
}

export async function analyzeScreenshot(filepath: string): Promise<AIResult | null> {
  const filename = path.basename(filepath);

  const cached = aiResultsTbl.getByFilename(filename);
  if (cached) return cached;

  const provider = activeProvider();
  if (!provider.isConfigured()) return null;

  try {
    const res = await provider.complete({ imagePath: filepath, prompt: ANALYZE_PROMPT, maxTokens: 600 });
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
  return runPromptAgainstScreenshot(filepath, chatPrompt(userMessage));
}

export async function runPromptAgainstScreenshot(filepath: string, prompt: string): Promise<string | null> {
  const provider = activeProvider();
  if (!provider.isConfigured()) return unconfiguredMessage();

  try {
    const res = await provider.complete({ imagePath: filepath, prompt });
    return res?.content || 'No response from AI.';
  } catch (err) {
    console.error('AI prompt failed:', err);
    return getConfig().aiProvider === 'local'
      ? '❌ Local model error. Check llama-server logs.'
      : '❌ Failed to reach OpenRouter. Check your connection.';
  }
}
