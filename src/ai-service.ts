import { net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

// Config path for API key
const configPath = path.join(app.getPath('userData'), 'config.json');

interface AppConfig {
  openrouterApiKey: string;
  aiModel: string;
}

const defaultConfig: AppConfig = {
  openrouterApiKey: '',
  aiModel: 'google/gemini-2.5-flash-lite',
};

export function getConfig(): AppConfig {
  try {
    if (fs.existsSync(configPath)) {
      return { ...defaultConfig, ...JSON.parse(fs.readFileSync(configPath, 'utf-8')) };
    }
  } catch { /* ignore */ }
  return { ...defaultConfig };
}

export function saveConfig(config: Partial<AppConfig>): AppConfig {
  const current = getConfig();
  const updated = { ...current, ...config };
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

interface AICacheEntry {
  extractedText: string;
  description: string;
  model: string;
  processedAt: number;
}

// Cache file for AI results
const cachePath = path.join(app.getPath('userData'), 'ai-cache.json');

function getCache(): Record<string, AICacheEntry> {
  try {
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

function saveCache(cache: Record<string, AICacheEntry>) {
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
}

function getCachedResult(filename: string): AICacheEntry | null {
  const cache = getCache();
  return cache[filename] || null;
}

function setCachedResult(filename: string, entry: AICacheEntry) {
  const cache = getCache();
  cache[filename] = entry;
  saveCache(cache);
}

/**
 * Convert an image file to a base64 data URL
 */
function imageToBase64(filepath: string): string {
  const buffer = fs.readFileSync(filepath);
  const ext = path.extname(filepath).toLowerCase().replace('.', '');
  const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export interface AIResult {
  extractedText: string;
  description: string;
  model: string;
}

/**
 * Send a screenshot to OpenRouter for text extraction and description.
 * Falls back gracefully if no API key is configured.
 */
export async function analyzeScreenshot(filepath: string): Promise<AIResult | null> {
  const config = getConfig();

  if (!config.openrouterApiKey) {
    console.log('No OpenRouter API key configured — skipping AI analysis');
    return null;
  }

  const filename = path.basename(filepath);

  // Check cache first
  const cached = getCachedResult(filename);
  if (cached) {
    console.log(`Using cached AI result for ${filename}`);
    return {
      extractedText: cached.extractedText,
      description: cached.description,
      model: cached.model,
    };
  }

  try {
    const imageDataUrl = imageToBase64(filepath);

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
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Please analyze this screenshot and provide TWO things:

1. **Extracted Text**: Extract ALL visible text from the image verbatim. Include every word, label, heading, button text, code snippet, menu item, error message, or any other text you can see. Format it cleanly and preserve the structure as much as possible. If there's no text, say "No text detected."

2. **Description**: Provide a concise but detailed description of what this screenshot shows. Include the context — what app or website is shown, what the user is looking at, and the key visual elements.

Format your response exactly like this:
[TEXT_START]
(extracted text here)
[TEXT_END]

[DESC_START]
(description here)
[DESC_END]`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageDataUrl,
                },
              },
            ],
          },
        ],
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`OpenRouter API error ${response.status}: ${errorBody}`);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Parse the formatted response
    const textMatch = content.match(/\[TEXT_START\]([\s\S]*?)\[TEXT_END\]/);
    const descMatch = content.match(/\[DESC_START\]([\s\S]*?)\[DESC_END\]/);

    const extractedText = textMatch ? textMatch[1].trim() : content;
    const description = descMatch ? descMatch[1].trim() : '';

    const result: AIResult = {
      extractedText,
      description,
      model: data.model || config.aiModel,
    };

    // Cache the result
    setCachedResult(filename, {
      ...result,
      processedAt: Date.now(),
    });

    return result;
  } catch (err) {
    console.error('AI analysis failed:', err);
    return null;
  }
}

/**
 * Chat with AI about a specific screenshot.
 */
export async function chatAboutScreenshot(
  filepath: string,
  userMessage: string,
): Promise<string | null> {
  const config = getConfig();

  if (!config.openrouterApiKey) {
    return '⚠️ No OpenRouter API key configured. Open Vellum settings to add your key.';
  }

  try {
    const imageDataUrl = imageToBase64(filepath);

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
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are a helpful AI assistant. The user has captured a screenshot and has a question about it. Answer concisely and helpfully.\n\nUser question: ${userMessage}`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageDataUrl,
                },
              },
            ],
          },
        ],
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`OpenRouter chat error ${response.status}: ${errorBody}`);
      return `❌ API error (${response.status}). Check your API key in settings.`;
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'No response from AI.';
  } catch (err) {
    console.error('Chat failed:', err);
    return '❌ Failed to reach OpenRouter. Check your connection.';
  }
}

/**
 * Get AI result for a screenshot (from cache only — no API call)
 */
export function getAIResult(filename: string): AICacheEntry | null {
  return getCachedResult(filename);
}

/**
 * Clear the AI cache
 */
export function clearAICache() {
  try {
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  } catch { /* ignore */ }
}

// --- Chat history ---

const chatsPath = path.join(app.getPath('userData'), 'chats.json');

export interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  time: number;
}

function getChats(): Record<string, ChatMessage[]> {
  try {
    if (fs.existsSync(chatsPath)) {
      return JSON.parse(fs.readFileSync(chatsPath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

function saveChats(chats: Record<string, ChatMessage[]>) {
  fs.writeFileSync(chatsPath, JSON.stringify(chats, null, 2), 'utf-8');
}

export function getChatHistory(filename: string): ChatMessage[] {
  const chats = getChats();
  return chats[filename] || [];
}

export function addChatMessage(filename: string, message: ChatMessage) {
  const chats = getChats();
  if (!chats[filename]) chats[filename] = [];
  chats[filename].push(message);
  saveChats(chats);
}

export function hasChatHistory(filename: string): boolean {
  const chats = getChats();
  return !!(chats[filename] && chats[filename].length > 0);
}

export function deleteChatHistory(filename: string) {
  const chats = getChats();
  delete chats[filename];
  saveChats(chats);
}
