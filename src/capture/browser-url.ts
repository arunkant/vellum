import { execFile } from 'node:child_process';

/**
 * Best-effort lookup of the URL from the frontmost browser tab.
 * macOS-only; returns null on any other platform, on non-browser frontmost
 * apps, when Automation permission is denied, or on any AppleScript failure.
 * Never throws.
 *
 * Implementation note: a single AppleScript that references every browser
 * fails to compile if any listed app is not installed, because AppleScript
 * resolves each app's scripting terminology at *parse* time (error -2741).
 * To stay portable we do this in two steps:
 *   1. Use System Events (always present) to read the frontmost process name.
 *   2. If it's a known browser, run a second AppleScript that targets only
 *      that one app — so missing browsers don't break the script.
 */
export function getFrontmostBrowserURL(timeoutMs = 800): Promise<string | null> {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return getFrontmostAppName(timeoutMs)
    .then((appName) => (appName ? getURLForApp(appName, timeoutMs) : null))
    .catch(() => null);
}

function getFrontmostAppName(timeoutMs: number): Promise<string | null> {
  const script =
    'tell application "System Events" to return name of first application process whose frontmost is true';
  return runOsa(script, timeoutMs).then((s) => (s ? s.trim() : null));
}

// Each entry is the AppleScript expression that, when wrapped in
// `tell application "<name>" to <expr>`, returns the URL of the active tab.
const BROWSER_EXPR: Record<string, string> = {
  'Safari': 'URL of front document',
  'Safari Technology Preview': 'URL of front document',
  'Google Chrome': 'URL of active tab of front window',
  'Google Chrome Canary': 'URL of active tab of front window',
  'Chromium': 'URL of active tab of front window',
  'Brave Browser': 'URL of active tab of front window',
  'Microsoft Edge': 'URL of active tab of front window',
  'Arc': 'URL of active tab of front window',
  'Vivaldi': 'URL of active tab of front window',
  'Opera': 'URL of active tab of front window',
};

function getURLForApp(appName: string, timeoutMs: number): Promise<string | null> {
  const expr = BROWSER_EXPR[appName];
  if (!expr) return Promise.resolve(null);
  // Quote-escape the app name for embedding inside the AppleScript string.
  const safeName = appName.replace(/"/g, '\\"');
  const script = `
    set theURL to ""
    try
      tell application "${safeName}" to set theURL to ${expr}
    end try
    return theURL
  `;
  return runOsa(script, timeoutMs).then((s) => {
    const url = (s ?? '').trim();
    if (!/^https?:\/\//i.test(url) && !/^file:\/\//i.test(url)) return null;
    return url;
  });
}

function runOsa(script: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      '/usr/bin/osascript',
      ['-e', script],
      { timeout: timeoutMs, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          console.warn('[browser-url] osascript failed:', stderr?.trim() || err.message);
          resolve(null);
          return;
        }
        resolve(stdout);
      },
    );
    child.on('error', (e) => {
      console.warn('[browser-url] spawn failed:', e.message);
      resolve(null);
    });
  });
}
