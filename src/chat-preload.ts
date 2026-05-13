import { contextBridge, ipcRenderer } from 'electron';

const api = {
  send: (filepath: string, message: string): Promise<string | null> =>
    ipcRenderer.invoke('chat-message', filepath, message),
  close: () => ipcRenderer.send('chat-window-close'),
};

contextBridge.exposeInMainWorld('chat', api);

export type ChatAPI = typeof api;
