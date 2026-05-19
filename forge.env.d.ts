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
