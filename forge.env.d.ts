/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

// Declare the vellum API exposed via preload
interface VellumAPI {
  getScreenshots: () => Promise<Array<{ name: string; path: string; time: number }>>;
  captureScreenshot: () => Promise<Array<{ name: string; path: string; time: number }>>;
  openScreenshot: (filepath: string) => Promise<boolean>;
  deleteScreenshot: (filepath: string) => Promise<Array<{ name: string; path: string; time: number }>>;
  showScreenshotsFolder: () => Promise<void>;
  onScreenshotAdded: (callback: (screenshots: Array<{ name: string; path: string; time: number }>) => void) => () => void;
}

declare global {
  interface Window {
    vellum: VellumAPI;
  }
}
