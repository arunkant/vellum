import { contextBridge, ipcRenderer } from 'electron';

export interface Region { x: number; y: number; width: number; height: number }

const api = {
  selected: (region: Region) => ipcRenderer.send('overlay:selected', region),
  cancelled: () => ipcRenderer.send('overlay:cancelled'),
};

contextBridge.exposeInMainWorld('overlay', api);

export type OverlayAPI = typeof api;
