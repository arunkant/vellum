/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

interface ScreenshotEntry {
  name: string;
  path: string;
  time: number;
  aiText: string | null;
  aiDescription: string | null;
  aiModel: string | null;
  hasChat: boolean;
  chatPreview: string | null;
}

interface AIResult {
  extractedText: string;
  description: string;
  model: string;
}

type AIProvider = 'openrouter' | 'local';

interface AppConfig {
  aiProvider: AIProvider;
  openrouterApiKey: string;
  aiModel: string;
  localServerPort: number;
}

interface LocalLlmStatus {
  state: 'idle' | 'missing-binary' | 'missing-model' | 'downloading' | 'starting' | 'ready' | 'error';
  message?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  modelPresent: boolean;
  binaryPresent: boolean;
}

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  time: number;
}

interface SavedPrompt {
  id: string;
  name: string;
  command: string;
  description: string;
  prompt: string;
}

interface VellumWorkspaceAPI {
  sendChat: (filepath: string, message: string) => Promise<string | null>;
  runSavedPrompt: (filepath: string, promptId: string) => Promise<string | null>;
  addTag: (filepath: string, tag: string) => Promise<string[]>;
  removeTag: (filepath: string, tag: string) => Promise<string[]>;
  listTags: (filepath: string) => Promise<string[]>;
  getHistory: (filepath: string) => Promise<ChatMessage[]>;
  copyImage: (filepath: string) => Promise<boolean>;
  copyAs: (filepath: string, format: 'slack' | 'jira') => Promise<boolean>;
  listSavedPrompts: () => Promise<SavedPrompt[]>;
}

interface VellumAPI {
  getScreenshots: () => Promise<ScreenshotEntry[]>;
  captureRegion: () => Promise<ScreenshotEntry[]>;
  captureFullScreen: () => Promise<ScreenshotEntry[]>;
  openScreenshot: (filepath: string) => Promise<boolean>;
  deleteScreenshot: (filepath: string) => Promise<ScreenshotEntry[]>;
  showScreenshotsFolder: () => Promise<void>;
  getConfig: () => Promise<AppConfig>;
  saveConfig: (config: Partial<AppConfig>) => Promise<AppConfig>;
  getAIResult: (filename: string) => Promise<AIResult | null>;
  openChatWindow: (filepath: string) => Promise<void>;
  workspace: VellumWorkspaceAPI;
  openExternal: (url: string) => Promise<void>;
  getAppVersion: () => Promise<string>;
  getLocalLlmStatus: () => Promise<LocalLlmStatus>;
  downloadLocalModel: () => Promise<boolean>;
  cancelLocalModelDownload: () => Promise<boolean>;
  stopLocalServer: () => Promise<boolean>;
  onLocalLlmStatus: (callback: (status: LocalLlmStatus) => void) => () => void;
  onScreenshotAdded: (callback: (screenshots: ScreenshotEntry[]) => void) => () => void;
  onAIResultReady: (callback: (data: { filename: string; text: string; description: string; model: string }) => void) => () => void;
}

declare global {
  interface Window {
    vellum: VellumAPI;
  }
}

export {};
