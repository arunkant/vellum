import { app, BrowserWindow, Menu, Tray, nativeImage, screen } from 'electron';
import path from 'node:path';
import { getOverlayHTML } from './overlay-html';
import { getChatHTML } from './chat-html';
import { chatMessagesTbl } from './db';
import { listScreenshots } from './screenshots';
import {
  checkForUpdates,
  installStagedUpdate,
  getUpdaterState,
  onUpdaterStateChange,
  type UpdaterState,
} from './updater';

let mainWindow: BrowserWindow | null = null;
let overlayWindows: BrowserWindow[] = [];
let chatWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let hiddenForCapture = { main: false, chat: false };

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

export function notifyLocalLlmStatus(status: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('local-llm-status', status);
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
  if (overlayWindows.length > 0) {
    overlayWindows[0].focus();
    return;
  }

  // Hide our own windows first. On macOS, focusing the overlay activates the
  // Vellum app, which raises any visible Vellum window above other apps — and
  // since the overlay is transparent, the user would see our UI through it
  // instead of whatever they're trying to capture.
  hiddenForCapture.main = !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  hiddenForCapture.chat = !!(chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible());
  if (hiddenForCapture.main) mainWindow?.hide();
  if (hiddenForCapture.chat) chatWindow?.hide();

  // One overlay per display: a single BrowserWindow can't span multiple
  // monitors on macOS, so we mirror the native screenshot tool and put a
  // dedicated transparent window on each display.
  for (const display of screen.getAllDisplays()) {
    const { x, y, width, height } = display.bounds;
    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
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
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setAlwaysOnTop(true, 'screen-saver');

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getOverlayHTML(display.bounds))}`);

    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        win.show();
        win.focus();
      }
    });

    win.on('close', (e) => {
      if (!win.isDestroyed()) e.preventDefault();
    });

    overlayWindows.push(win);
  }
}

export function closeOverlay() {
  for (const win of overlayWindows) {
    if (!win.isDestroyed()) win.destroy();
  }
  overlayWindows = [];
}

// Restore windows we hid for the capture overlay. Separate from closeOverlay
// because on a successful region selection we keep windows hidden through the
// brief capture delay so they aren't included in the screenshot.
export function restoreWindowsHiddenForCapture() {
  if (hiddenForCapture.main && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
  if (hiddenForCapture.chat && chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.show();
  }
  hiddenForCapture = { main: false, chat: false };
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

  const html = getChatHTML(filepath, chatMessagesTbl.getByFilename(path.basename(filepath)));
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

// Loads assets/trayTemplate.png on macOS (auto-tinted by menubar) and
// assets/trayColor.png elsewhere. Electron picks up the @2x/@3x variants
// automatically based on the filename convention.
function createTrayIcon(): Electron.NativeImage {
  const assetsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(app.getAppPath(), 'assets');
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'trayColor.png';
  const img = nativeImage.createFromPath(path.join(assetsDir, file));
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

function updateMenuItem(state: UpdaterState): Electron.MenuItemConstructorOptions {
  switch (state.kind) {
    case 'checking':
      return { label: 'Checking for Updates…', enabled: false };
    case 'downloading':
      return { label: `Downloading v${state.version.replace(/^v/, '')}…`, enabled: false };
    case 'ready':
      return {
        label: `Restart to Install v${state.version.replace(/^v/, '')}`,
        click: () => { void installStagedUpdate(); },
      };
    case 'up-to-date':
      return { label: 'Check for Updates', click: () => { void checkForUpdates({ userInitiated: true }); } };
    case 'error':
    case 'idle':
    default:
      return { label: 'Check for Updates…', click: () => { void checkForUpdates({ userInitiated: true }); } };
  }
}

function rebuildTrayMenu(handlers: { onRegion(): void; onFull(): void }) {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Vellum', click: showMainWindow },
    { label: 'Capture Region (Drag)', accelerator: 'CmdOrCtrl+Shift+1', click: handlers.onRegion },
    { label: 'Capture Full Screen', accelerator: 'CmdOrCtrl+Shift+2', click: handlers.onFull },
    { type: 'separator' },
    updateMenuItem(getUpdaterState()),
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]));
}

export function createTray(handlers: { onRegion(): void; onFull(): void }) {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Vellum - AI Helper');

  rebuildTrayMenu(handlers);
  onUpdaterStateChange(() => rebuildTrayMenu(handlers));

  tray.on('double-click', showMainWindow);
}
