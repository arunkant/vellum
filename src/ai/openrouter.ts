import { net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config';
import type { VisionProvider, VisionRequest, VisionResponse } from './types';

function imageToDataUrl(filepath: string): string {
  const buffer = fs.readFileSync(filepath);
  const ext = path.extname(filepath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export const openRouterProvider: VisionProvider = {
  name: 'openrouter',

  isConfigured() {
    return Boolean(getConfig().openrouterApiKey);
  },

  async complete(req: VisionRequest): Promise<VisionResponse | null> {
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
            { type: 'text', text: req.prompt },
            { type: 'image_url', image_url: { url: imageToDataUrl(req.imagePath) } },
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
  },
};
