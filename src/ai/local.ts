import { net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { ensureRunning, getStatus, modelDisplayName, serverEndpoint } from './llama-server';
import type { VisionProvider, VisionRequest, VisionResponse } from './types';

function imageToDataUrl(filepath: string): string {
  const buffer = fs.readFileSync(filepath);
  const ext = path.extname(filepath).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

export const localLlamaProvider: VisionProvider = {
  name: 'local-llama',

  isConfigured() {
    const s = getStatus();
    return s.binaryPresent && s.modelPresent;
  },

  async complete(req: VisionRequest): Promise<VisionResponse | null> {
    await ensureRunning();

    const response = await net.fetch(`${serverEndpoint()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // llama-server ignores `model`; it always serves the loaded weights.
        model: 'gemma-4-e4b',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: req.prompt },
            { type: 'image_url', image_url: { url: imageToDataUrl(req.imagePath) } },
          ],
        }],
        max_tokens: req.maxTokens ?? 2000,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`llama-server ${response.status}: ${body}`);
      throw new Error(`llama-server ${response.status}`);
    }

    const data = await response.json();
    return {
      content: data.choices?.[0]?.message?.content || '',
      model: modelDisplayName(),
    };
  },
};
