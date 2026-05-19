import { app, dialog, Notification } from 'electron';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileP = promisify(execFile);

const REPO = process.env.VELLUM_REPO || 'arunkant/vellum';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const USER_AGENT = `vellum/${app.getVersion()} (auto-updater)`;

export type UpdaterState =
  | { kind: 'idle'; lastChecked?: number }
  | { kind: 'checking' }
  | { kind: 'up-to-date'; lastChecked: number }
  | { kind: 'downloading'; version: string }
  | { kind: 'ready'; version: string; stagedAppPath: string }
  | { kind: 'error'; message: string };

let state: UpdaterState = { kind: 'idle' };
const listeners = new Set<(s: UpdaterState) => void>();

export function getUpdaterState(): UpdaterState { return state; }

export function onUpdaterStateChange(fn: (s: UpdaterState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function setState(next: UpdaterState) {
  state = next;
  for (const fn of listeners) {
    try { fn(state); } catch (err) { console.error('updater listener failed:', err); }
  }
}

/** Compare "1.2.3" vs "1.2.10". Returns -1, 0, or 1. Ignores leading "v". */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map((p) => parseInt(p, 10) || 0);
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 < b1 ? -1 : 1;
  if (a2 !== b2) return a2 < b2 ? -1 : 1;
  if (a3 !== b3) return a3 < b3 ? -1 : 1;
  return 0;
}

interface GhAsset { name: string; browser_download_url: string }
interface GhRelease { tag_name: string; name: string; assets: GhAsset[] }

function httpsGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT, ...headers } }, (res) => {
      // Follow redirects (GitHub API uses 302 for some endpoints).
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        httpsGet(res.headers.location, headers).then(resolve, reject);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
  });
}

function downloadToFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      const location = res.headers.location;
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location) {
        res.resume();
        file.close(() => fs.unlink(dest, () => downloadToFile(location, dest).then(resolve, reject)));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        file.close(() => fs.unlink(dest, () => reject(new Error(`Download failed: HTTP ${res.statusCode}`))));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });
    req.on('error', (err) => file.close(() => fs.unlink(dest, () => reject(err))));
  });
}

async function fetchLatestRelease(): Promise<GhRelease> {
  const { status, body } = await httpsGet(`https://api.github.com/repos/${REPO}/releases/latest`, {
    Accept: 'application/vnd.github+json',
  });
  if (status !== 200) throw new Error(`GitHub API returned ${status}`);
  return JSON.parse(body) as GhRelease;
}

function pickAsset(release: GhRelease): GhAsset | null {
  return release.assets.find((a) => /darwin-arm64.*\.zip$/i.test(a.name)) || null;
}

/** Returns the .app bundle path of the running app (e.g. /Applications/vellum.app). */
function getRunningAppPath(): string {
  // exe path: <.app>/Contents/MacOS/<binary>
  return path.dirname(path.dirname(path.dirname(app.getPath('exe'))));
}

/** Download + unzip + strip quarantine. Returns the staged .app path. */
async function stageUpdate(asset: GhAsset, version: string): Promise<string> {
  const stagingRoot = path.join(os.tmpdir(), `vellum-update-${version}-${Date.now()}`);
  fs.mkdirSync(stagingRoot, { recursive: true });
  const zipPath = path.join(stagingRoot, 'vellum.zip');
  const extractDir = path.join(stagingRoot, 'extracted');
  fs.mkdirSync(extractDir);

  await downloadToFile(asset.browser_download_url, zipPath);
  await execFileP('unzip', ['-q', zipPath, '-d', extractDir]);

  // Find the .app bundle inside (matches install.sh logic).
  const { stdout } = await execFileP('find', [extractDir, '-maxdepth', '3', '-name', '*.app', '-print']);
  const appPath = stdout.split('\n').filter(Boolean)[0];
  if (!appPath) throw new Error('No .app bundle found inside the downloaded archive');

  // Strip quarantine (unsigned app — Gatekeeper would otherwise refuse to open it).
  await execFileP('xattr', ['-dr', 'com.apple.quarantine', appPath]).catch(() => undefined);

  return appPath;
}

/**
 * Swap the running .app with `stagedAppPath` and relaunch. Writes a small shell
 * script that waits for our PID to exit, then performs `rm -rf` + `mv` + `open`.
 * The script runs detached so it survives `app.quit()`.
 */
async function applyAndRelaunch(stagedAppPath: string): Promise<void> {
  const currentAppPath = getRunningAppPath();
  const pid = process.pid;
  const scriptPath = path.join(os.tmpdir(), `vellum-apply-update-${Date.now()}.sh`);
  const logPath = path.join(os.tmpdir(), `vellum-apply-update-${Date.now()}.log`);

  const script = `#!/usr/bin/env bash
set -eu
exec >"${logPath}" 2>&1
echo "waiting for pid ${pid} to exit..."
for _ in $(seq 1 50); do
  if ! kill -0 ${pid} 2>/dev/null; then break; fi
  sleep 0.1
done
if kill -0 ${pid} 2>/dev/null; then
  echo "pid ${pid} still alive after 5s, force-killing"
  kill -9 ${pid} 2>/dev/null || true
  sleep 0.5
fi
echo "swapping ${currentAppPath}"
rm -rf "${currentAppPath}"
mv "${stagedAppPath}" "${currentAppPath}"
xattr -dr com.apple.quarantine "${currentAppPath}" 2>/dev/null || true
echo "launching ${currentAppPath}"
open "${currentAppPath}"
echo "done"
`;
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });

  const child = spawn('/bin/bash', [scriptPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  app.quit();
}

let checking = false;

/**
 * Look up the latest release; if newer than the running version, download +
 * stage it and transition state to `ready`. The user later triggers the swap
 * via {@link installStagedUpdate}.
 */
export async function checkForUpdates(opts: { userInitiated?: boolean } = {}): Promise<void> {
  if (!app.isPackaged) return; // dev mode: don't touch anything
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return; // only built artifact
  if (state.kind === 'downloading' || state.kind === 'ready') return;
  if (checking) return;
  checking = true;

  setState({ kind: 'checking' });
  try {
    const release = await fetchLatestRelease();
    const latest = release.tag_name || release.name;
    const current = app.getVersion();
    if (compareVersions(latest, current) <= 0) {
      setState({ kind: 'up-to-date', lastChecked: Date.now() });
      if (opts.userInitiated) {
        dialog.showMessageBox({
          type: 'info',
          message: 'Vellum is up to date',
          detail: `You're on v${current}.`,
        });
      }
      return;
    }

    const asset = pickAsset(release);
    if (!asset) throw new Error('No darwin-arm64 .zip asset in latest release');

    setState({ kind: 'downloading', version: latest });
    const stagedAppPath = await stageUpdate(asset, latest);
    setState({ kind: 'ready', version: latest, stagedAppPath });

    new Notification({
      title: 'Vellum update ready',
      body: `v${latest.replace(/^v/, '')} is ready to install. Click the tray icon to restart.`,
    }).show();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Update check failed:', message);
    setState({ kind: 'error', message });
    if (opts.userInitiated) {
      dialog.showErrorBox('Update check failed', message);
    }
  } finally {
    checking = false;
  }
}

/** Apply the staged update (no-op unless state is `ready`). */
export async function installStagedUpdate(): Promise<void> {
  if (state.kind !== 'ready') return;
  await applyAndRelaunch(state.stagedAppPath);
}

let interval: NodeJS.Timeout | null = null;

/** Kick off an initial check and schedule recurring checks every 24h. */
export function startUpdateScheduler(): void {
  if (!app.isPackaged) return;
  // Initial check ~30s after launch so we don't compete with startup work.
  setTimeout(() => { void checkForUpdates(); }, 30_000);
  if (interval) clearInterval(interval);
  interval = setInterval(() => { void checkForUpdates(); }, CHECK_INTERVAL_MS);
}

export function stopUpdateScheduler(): void {
  if (interval) { clearInterval(interval); interval = null; }
}
