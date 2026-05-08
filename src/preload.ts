import { contextBridge, ipcRenderer } from 'electron';

export interface ScreenshotEntry {
  name: string;
  path: string;
  time: number;
  aiText: string | null;
  aiDescription: string | null;
  aiModel: string | null;
  hasChat: boolean;
  chatPreview: string | null;
}

export interface AIResult {
  extractedText: string;
  description: string;
  model: string;
}

export interface AppConfig {
  openrouterApiKey: string;
  aiModel: string;
}

const api = {
  getScreenshots: (): Promise<ScreenshotEntry[]> =>
    ipcRenderer.invoke('get-screenshots'),

  captureRegion: (): Promise<ScreenshotEntry[]> =>
    ipcRenderer.invoke('capture-region'),

  captureFullScreen: (): Promise<ScreenshotEntry[]> =>
    ipcRenderer.invoke('capture-fullscreen'),

  openScreenshot: (filepath: string): Promise<boolean> =>
    ipcRenderer.invoke('open-screenshot', filepath),

  deleteScreenshot: (filepath: string): Promise<ScreenshotEntry[]> =>
    ipcRenderer.invoke('delete-screenshot', filepath),

  showScreenshotsFolder: (): Promise<void> =>
    ipcRenderer.invoke('show-screenshots-folder'),

  // Settings
  getConfig: (): Promise<AppConfig> =>
    ipcRenderer.invoke('get-config'),

  saveConfig: (config: Partial<AppConfig>): Promise<AppConfig> =>
    ipcRenderer.invoke('save-config', config),

  // AI
  getAIResult: (filename: string): Promise<AIResult | null> =>
    ipcRenderer.invoke('get-ai-result', filename),

  openChatWindow: (filepath: string, filename: string): Promise<void> =>
    ipcRenderer.invoke('open-chat-window', filepath, filename),

  clearAICache: (): Promise<boolean> =>
    ipcRenderer.invoke('clear-ai-cache'),

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-external', url),

  // Events
  onScreenshotAdded: (callback: (screenshots: ScreenshotEntry[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, screenshots: ScreenshotEntry[]) =>
      callback(screenshots);
    ipcRenderer.on('screenshot-added', handler);
    return () => {
      ipcRenderer.removeListener('screenshot-added', handler);
    };
  },

  onAIResultReady: (
    callback: (data: { filename: string; text: string; description: string; model: string }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { filename: string; text: string; description: string; model: string },
    ) => callback(data);
    ipcRenderer.on('ai-result-ready', handler);
    return () => {
      ipcRenderer.removeListener('ai-result-ready', handler);
    };
  },
};

contextBridge.exposeInMainWorld('vellum', api);
