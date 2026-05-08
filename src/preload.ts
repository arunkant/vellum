import { contextBridge, ipcRenderer } from 'electron';

export interface ScreenshotEntry {
  name: string;
  path: string;
  time: number;
}

const api = {
  getScreenshots: (): Promise<ScreenshotEntry[]> =>
    ipcRenderer.invoke('get-screenshots'),

  captureScreenshot: (): Promise<ScreenshotEntry[]> =>
    ipcRenderer.invoke('capture-screenshot'),

  openScreenshot: (filepath: string): Promise<boolean> =>
    ipcRenderer.invoke('open-screenshot', filepath),

  deleteScreenshot: (filepath: string): Promise<ScreenshotEntry[]> =>
    ipcRenderer.invoke('delete-screenshot', filepath),

  showScreenshotsFolder: (): Promise<void> =>
    ipcRenderer.invoke('show-screenshots-folder'),

  onScreenshotAdded: (callback: (screenshots: ScreenshotEntry[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, screenshots: ScreenshotEntry[]) =>
      callback(screenshots);
    ipcRenderer.on('screenshot-added', handler);
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener('screenshot-added', handler);
    };
  },
};

contextBridge.exposeInMainWorld('vellum', api);
