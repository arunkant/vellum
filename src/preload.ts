import { contextBridge, ipcRenderer } from 'electron';

export interface ScreenshotEntry {
  name: string;
  path: string;
  time: number;
  url: string | null;
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

export type AIProvider = 'openrouter' | 'local';

export interface AppConfig {
  aiProvider: AIProvider;
  openrouterApiKey: string;
  aiModel: string;
  localServerPort: number;
}

export interface LocalLlmStatus {
  state: 'idle' | 'missing-binary' | 'missing-model' | 'downloading' | 'starting' | 'ready' | 'error';
  message?: string;
  downloadedBytes?: number;
  totalBytes?: number;
  modelPresent: boolean;
  binaryPresent: boolean;
}

export interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  time: number;
}

export interface SavedPrompt {
  id: string;
  name: string;
  command: string;
  description: string;
  prompt: string;
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

  openChatWindow: (filepath: string): Promise<void> =>
    ipcRenderer.invoke('open-chat-window', filepath),

  // Workspace (shared with floating chat window)
  workspace: {
    sendChat: (filepath: string, message: string): Promise<string | null> =>
      ipcRenderer.invoke('chat-message', filepath, message),
    runSavedPrompt: (filepath: string, promptId: string): Promise<string | null> =>
      ipcRenderer.invoke('chat-run-prompt', filepath, promptId),
    addTag: (filepath: string, tag: string): Promise<string[]> =>
      ipcRenderer.invoke('chat-add-tag', filepath, tag),
    removeTag: (filepath: string, tag: string): Promise<string[]> =>
      ipcRenderer.invoke('chat-remove-tag', filepath, tag),
    listTags: (filepath: string): Promise<string[]> =>
      ipcRenderer.invoke('chat-list-tags', filepath),
    getHistory: (filepath: string): Promise<ChatMessage[]> =>
      ipcRenderer.invoke('chat-get-history', filepath),
    copyImage: (filepath: string): Promise<boolean> =>
      ipcRenderer.invoke('chat-copy-image', filepath),
    copyAs: (filepath: string, format: 'slack' | 'jira'): Promise<boolean> =>
      ipcRenderer.invoke('chat-copy-as', filepath, format),
    listSavedPrompts: (): Promise<SavedPrompt[]> =>
      ipcRenderer.invoke('chat-list-saved-prompts'),
  },

  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('open-external', url),

  getAppVersion: (): Promise<string> =>
    ipcRenderer.invoke('get-app-version'),

  // Local llama-server
  getLocalLlmStatus: (): Promise<LocalLlmStatus> =>
    ipcRenderer.invoke('local-llm:status'),

  downloadLocalModel: (): Promise<boolean> =>
    ipcRenderer.invoke('local-llm:download'),

  cancelLocalModelDownload: (): Promise<boolean> =>
    ipcRenderer.invoke('local-llm:cancel-download'),

  stopLocalServer: (): Promise<boolean> =>
    ipcRenderer.invoke('local-llm:stop-server'),

  onLocalLlmStatus: (callback: (status: LocalLlmStatus) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, status: LocalLlmStatus) => callback(status);
    ipcRenderer.on('local-llm-status', handler);
    return () => {
      ipcRenderer.removeListener('local-llm-status', handler);
    };
  },

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
