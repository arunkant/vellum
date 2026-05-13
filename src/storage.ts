import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface AIResult {
  extractedText: string;
  description: string;
  model: string;
  processedAt: number;
}

export interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  time: number;
}

function makeStore<T extends Record<string, unknown>>(filename: string) {
  const filepath = path.join(app.getPath('userData'), filename);
  let cache: T | null = null;

  const load = (): T => {
    if (cache) return cache;
    try {
      if (fs.existsSync(filepath)) {
        cache = JSON.parse(fs.readFileSync(filepath, 'utf-8')) as T;
      }
    } catch (err) {
      console.error(`Failed to read ${filename}:`, err);
    }
    if (!cache) cache = {} as T;
    return cache;
  };

  const persist = () => {
    try {
      fs.writeFileSync(filepath, JSON.stringify(load(), null, 2), 'utf-8');
    } catch (err) {
      console.error(`Failed to write ${filename}:`, err);
    }
  };

  return {
    get: <K extends keyof T>(key: K): T[K] | undefined => load()[key],
    set: <K extends keyof T>(key: K, value: T[K]) => {
      load()[key] = value;
      persist();
    },
    remove: <K extends keyof T>(key: K) => {
      delete load()[key];
      persist();
    },
  };
}

const aiStore = makeStore<Record<string, AIResult>>('ai-cache.json');
const chatStore = makeStore<Record<string, ChatMessage[]>>('chats.json');

export const aiCache = {
  get: (filename: string): AIResult | null => aiStore.get(filename) ?? null,
  set: (filename: string, result: AIResult) => aiStore.set(filename, result),
};

export const chatHistory = {
  get: (filename: string): ChatMessage[] => chatStore.get(filename) ?? [],
  add: (filename: string, message: ChatMessage) => {
    const history = chatStore.get(filename) ?? [];
    history.push(message);
    chatStore.set(filename, history);
  },
  remove: (filename: string) => chatStore.remove(filename),
};
