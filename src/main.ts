import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  desktopCapturer,
  screen,
  nativeImage,
  ipcMain,
  dialog,
  shell,
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import started from 'electron-squirrel-startup';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// Directory to store screenshots
const screenshotsDir = path.join(app.getPath('userData'), 'screenshots');

// Ensure screenshots directory exists
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

// Create a simple tray icon programmatically (16x16 colored circle)
function createTrayIcon(): nativeImage {
  // Create a 16x16 image with a simple colored icon
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const cx = x - size / 2;
      const cy = y - size / 2;
      const dist = Math.sqrt(cx * cx + cy * cy);

      if (dist <= size / 2 - 1) {
        // Purple circle with slight gradient
        const alpha = dist < size / 2 - 3 ? 255 : 128;
        buffer[idx] = 139;     // R
        buffer[idx + 1] = 92;  // G
        buffer[idx + 2] = 246; // B
        buffer[idx + 3] = alpha; // A
      } else {
        buffer[idx] = 0;
        buffer[idx + 1] = 0;
        buffer[idx + 2] = 0;
        buffer[idx + 3] = 0;
      }
    }
  }

  return nativeImage.createFromBuffer(buffer, {
    width: size,
    height: size,
  });
}

function getScreenshots(): Array<{ name: string; path: string; time: number }> {
  try {
    const files = fs.readdirSync(screenshotsDir);
    return files
      .filter((f) => f.endsWith('.png'))
      .map((f) => {
        const fullPath = path.join(screenshotsDir, f);
        const stats = fs.statSync(fullPath);
        return {
          name: f,
          path: fullPath,
          time: stats.mtimeMs,
        };
      })
      .sort((a, b) => b.time - a.time); // newest first
  } catch {
    return [];
  }
}

async function captureScreenshot(): Promise<string | null> {
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.bounds;

    // Capture all screens
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
    });

    if (sources.length === 0) return null;

    // Use the first screen source or find the primary
    const source = sources[0];
    const image = source.thumbnail;

    // Save to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot-${timestamp}.png`;
    const filepath = path.join(screenshotsDir, filename);

    // Convert to PNG and save
    const pngBuffer = image.toPNG();
    fs.writeFileSync(filepath, pngBuffer);

    return filepath;
  } catch (err) {
    console.error('Screenshot capture failed:', err);
    return null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    show: false, // Start hidden
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Vellum - AI Helper',
  });

  // Load the index.html
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Hide window instead of closing
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Vellum - AI Helper');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Vellum',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: 'Capture Screenshot',
      accelerator: 'CmdOrCtrl+Shift+1',
      click: async () => {
        const filepath = await captureScreenshot();
        if (filepath && mainWindow) {
          mainWindow.webContents.send('screenshot-added', getScreenshots());
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Double-click on tray icon shows the window
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// Register global shortcuts
function registerShortcuts() {
  const registered = globalShortcut.register('CmdOrCtrl+Shift+1', async () => {
    console.log('Global shortcut triggered: CmdOrCtrl+Shift+1');
    const filepath = await captureScreenshot();
    if (filepath && mainWindow) {
      mainWindow.webContents.send('screenshot-added', getScreenshots());
    }
  });

  if (!registered) {
    console.error('Failed to register global shortcut');
  }
}

// IPC Handlers
function setupIPC() {
  ipcMain.handle('get-screenshots', () => {
    return getScreenshots();
  });

  ipcMain.handle('open-screenshot', async (_event, filepath: string) => {
    try {
      await shell.openPath(filepath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('delete-screenshot', async (_event, filepath: string) => {
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
      return getScreenshots();
    } catch {
      return getScreenshots();
    }
  });

  ipcMain.handle('capture-screenshot', async () => {
    const filepath = await captureScreenshot();
    return filepath ? getScreenshots() : getScreenshots();
  });

  ipcMain.handle('show-screenshots-folder', async () => {
    await shell.openPath(screenshotsDir);
  });
}

// App lifecycle
app.whenReady().then(() => {
  setupIPC();
  createWindow();
  createTray();
  registerShortcuts();

  // On macOS, show window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
