import { net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from './config';
import { aiCache, AIResult } from './storage';

const ANALYZE_PROMPT = `Please analyze this screenshot and provide TWO things:

1. **Extracted Text**: Extract ALL visible text from the image verbatim. Include every word, label, heading, button text, code snippet, menu item, error message, or any other text you can see. Format it cleanly and preserve the structure as much as possible. If there's no text, say "No text detected."

2. **Description**: Provide a concise but detailed description of what this screenshot shows. Include the context — what app or website is shown, what the user is looking at, and the key visual elements.

Format your response exactly like this:
[TEXT_START]
(extracted text here)
[TEXT_END]

[DESC_START]
(description here)
[DESC_END]`;

function imageToBase64(filepath: string): string {
  const buffer = fs.readFileSync(filepath);
  const ext = path.extname(filepath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function callOpenRouter(prompt: string, imageDataUrl: string): Promise<{ content: string; model: string } | null> {
  const config = getConfig();
  if (!config.openrouterApiKey) return null;

  const response = await net.fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.openrouterApiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'vellum-app',
      'X-Title': 'Vellum AI Helper',
    },
    body: JSON.stringify({
      model: config.aiModel,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      }],
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`OpenRouter ${response.status}: ${body}`);
    throw new Error(`OpenRouter ${response.status}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    model: data.model || config.aiModel,
  };
}

export async function analyzeScreenshot(filepath: string): Promise<AIResult | null> {
  const filename = path.basename(filepath);
  const cached = aiCache.get(filename);
  if (cached) return cached;

  if (!getConfig().openrouterApiKey) return null;

  try {
    const res = await callOpenRouter(ANALYZE_PROMPT, imageToBase64(filepath));
    if (!res) return null;

    const textMatch = res.content.match(/\[TEXT_START\]([\s\S]*?)\[TEXT_END\]/);
    const descMatch = res.content.match(/\[DESC_START\]([\s\S]*?)\[DESC_END\]/);

    const result: AIResult = {
      extractedText: textMatch ? textMatch[1].trim() : res.content,
      description: descMatch ? descMatch[1].trim() : '',
      model: res.model,
      processedAt: Date.now(),
    };

    aiCache.set(filename, result);
    return result;
  } catch (err) {
    console.error('AI analysis failed:', err);
    return null;
  }
}

export async function chatAboutScreenshot(filepath: string, userMessage: string): Promise<string | null> {
  if (!getConfig().openrouterApiKey) {
    return '⚠️ No OpenRouter API key configured. Open Vellum settings to add your key.';
  }

  try {
    const prompt = `You are a helpful AI assistant. The user has captured a screenshot and has a question about it. Answer concisely and helpfully.\n\nUser question: ${userMessage}`;
    const res = await callOpenRouter(prompt, imageToBase64(filepath));
    return res?.content || 'No response from AI.';
  } catch (err) {
    console.error('Chat failed:', err);
    return '❌ Failed to reach OpenRouter. Check your connection.';
  }
}
