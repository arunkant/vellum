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

interface AppConfig {
  openrouterApiKey: string;
  aiModel: string;
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
  openChatWindow: (filepath: string, filename: string) => Promise<void>;
  clearAICache: () => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;
  onScreenshotAdded: (callback: (screenshots: ScreenshotEntry[]) => void) => () => void;
  onAIResultReady: (callback: (data: { filename: string; text: string; description: string; model: string }) => void) => () => void;
}

declare global {
  interface Window {
    vellum: VellumAPI;
  }
}
