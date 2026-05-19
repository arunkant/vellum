import { contextBridge, ipcRenderer } from 'electron';

const api = {
  send: (filepath: string, message: string): Promise<string | null> =>
    ipcRenderer.invoke('chat-message', filepath, message),
  runPrompt: (filepath: string, promptId: string): Promise<string | null> =>
    ipcRenderer.invoke('chat-run-prompt', filepath, promptId),
  addTag: (filepath: string, tag: string): Promise<string[]> =>
    ipcRenderer.invoke('chat-add-tag', filepath, tag),
  removeTag: (filepath: string, tag: string): Promise<string[]> =>
    ipcRenderer.invoke('chat-remove-tag', filepath, tag),
  copyImage: (filepath: string): Promise<boolean> =>
    ipcRenderer.invoke('chat-copy-image', filepath),
  copyAs: (filepath: string, format: 'slack' | 'jira'): Promise<boolean> =>
    ipcRenderer.invoke('chat-copy-as', filepath, format),
  close: () => ipcRenderer.send('chat-window-close'),
};

contextBridge.exposeInMainWorld('chat', api);

export type ChatAPI = typeof api;
