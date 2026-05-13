import { app, BrowserWindow, Menu, Tray, nativeImage, screen } from 'electron';
import path from 'node:path';
import { getOverlayHTML } from './overlay-html';
import { getChatHTML } from './chat-html';
import { getTotalBounds } from './capture';
import { chatHistory } from './storage';
import { listScreenshots } from './screenshots';

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

export function setQuitting(value: boolean) { isQuitting = value; }
export function getMainWindow() { return mainWindow; }

export function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }
  mainWindow?.show();
  mainWindow?.focus();
}

export function notifyScreenshotsUpdated() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('screenshot-added', listScreenshots());
  }
}

export interface AIResultNotification {
  filename: string;
  text: string;
  description: string;
  model: string;
}

export function notifyAIResult(data: AIResultNotification) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ai-result-ready', data);
  }
}

export function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Vellum - AI Helper',
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
}

export function openRegionCapture() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.focus();
    return;
  }

  const total = getTotalBounds();
  overlayWindow = new BrowserWindow({
    x: total.x,
    y: total.y,
    width: total.width,
    height: total.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    fullscreenable: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
    },
  });

  // Set BEFORE showing so it appears on fullscreen spaces (macOS).
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');

  overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getOverlayHTML(total))}`);

  // Show + focus so the custom CSS cursor takes effect immediately. With
  // showInactive() on macOS, transparent always-on-top windows often keep the
  // previous app's cursor until they receive a mouse event.
  overlayWindow.once('ready-to-show', () => {
    overlayWindow?.show();
    overlayWindow?.focus();
  });

  overlayWindow.on('close', (e) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) e.preventDefault();
  });
  overlayWindow.on('closed', () => { overlayWindow = null; });
}

export function closeOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
    overlayWindow = null;
  }
}

export function openChatWindow(filepath: string) {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.destroy();
    chatWindow = null;
  }

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const winW = 420, winH = 520;

  chatWindow = new BrowserWindow({
    x: Math.round((sw - winW) / 2),
    y: Math.round((sh - winH) / 2),
    width: winW,
    height: winH,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: true,
    show: false,
    title: 'Vellum Chat',
    webPreferences: {
      preload: path.join(__dirname, 'chat-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
    },
  });

  chatWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  chatWindow.setAlwaysOnTop(true, 'floating');

  const html = getChatHTML(filepath, chatHistory.get(path.basename(filepath)));
  chatWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  chatWindow.once('ready-to-show', () => {
    chatWindow?.show();
    chatWindow?.focus();
  });
  chatWindow.on('closed', () => { chatWindow = null; });
}

export function closeChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.destroy();
    chatWindow = null;
  }
}

// 16x16 purple circle, drawn programmatically — no asset files needed.
function createTrayIcon(): Electron.NativeImage {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dist = Math.hypot(x - size / 2, y - size / 2);
      if (dist <= size / 2 - 1) {
        buffer[idx] = 139;
        buffer[idx + 1] = 92;
        buffer[idx + 2] = 246;
        buffer[idx + 3] = dist < size / 2 - 3 ? 255 : 128;
      }
    }
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

export function createTray(handlers: { onRegion(): void; onFull(): void }) {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Vellum - AI Helper');

  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Vellum', click: showMainWindow },
    { label: 'Capture Region (Drag)', accelerator: 'CmdOrCtrl+Shift+1', click: handlers.onRegion },
    { label: 'Capture Full Screen', accelerator: 'CmdOrCtrl+Shift+2', click: handlers.onFull },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]));

  tray.on('double-click', showMainWindow);
}
