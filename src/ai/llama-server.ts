import { app, net } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig } from '../config';

/**
 * Default Gemma 4 E4B-it (vision-capable, ~8B params, ~4B effective) Q4_K_M
 * weights, plus the multimodal projector needed for image input. Unsloth
 * mirrors Google's official `google/gemma-4-E4B-it` as GGUF.
 */
const MODEL_URL =
  'https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf';
const MMPROJ_URL =
  'https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/mmproj-BF16.gguf';

const MODEL_FILE = 'gemma-4-E4B-it-Q4_K_M.gguf';
const MMPROJ_FILE = 'mmproj-gemma-4-E4B-BF16.gguf';

export type LlamaState =
  | 'idle'
  | 'missing-binary'
  | 'missing-model'
  | 'downloading'
  | 'starting'
  | 'ready'
  | 'error';

export interface LlamaStatus {
  state: LlamaState;
  message?: string;
  /** Bytes downloaded so far across both model + mmproj. */
  downloadedBytes?: number;
  /** Total bytes for the current download set, if known. */
  totalBytes?: number;
  modelPresent: boolean;
  binaryPresent: boolean;
}

const events = new EventEmitter();
let current: LlamaStatus = {
  state: 'idle',
  modelPresent: false,
  binaryPresent: false,
};
let serverProc: ChildProcess | null = null;
let serverReadyPromise: Promise<void> | null = null;
let downloadAbort: AbortController | null = null;

function setStatus(patch: Partial<LlamaStatus>) {
  current = { ...current, ...patch };
  events.emit('status', current);
}

export function onStatusChange(listener: (s: LlamaStatus) => void): () => void {
  events.on('status', listener);
  return () => events.off('status', listener);
}

export function getStatus(): LlamaStatus {
  // Refresh derived fields on read so callers see filesystem truth even if
  // they never subscribed to events.
  return {
    ...current,
    binaryPresent: binaryExists(),
    modelPresent: modelExists(),
  };
}

// --- Path resolution --------------------------------------------------------

function platformDir(): string {
  return `${process.platform}-${process.arch}`;
}

function binaryDir(): string {
  // `./vendor/llama` is shipped via Forge's extraResource, which lands as
  // `<Resources>/llama/` in packaged builds.
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'llama')
    : path.join(app.getAppPath(), 'vendor', 'llama');
  return path.join(root, platformDir());
}

function binaryPath(): string {
  const name = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server';
  return path.join(binaryDir(), name);
}

export function modelDir(): string {
  return path.join(app.getPath('userData'), 'models');
}

export function modelPath(): string {
  return path.join(modelDir(), MODEL_FILE);
}

export function mmprojPath(): string {
  return path.join(modelDir(), MMPROJ_FILE);
}

function binaryExists(): boolean {
  try { return fs.statSync(binaryPath()).isFile(); } catch { return false; }
}

function modelExists(): boolean {
  try {
    return fs.statSync(modelPath()).isFile() && fs.statSync(mmprojPath()).isFile();
  } catch { return false; }
}

// --- Model download ---------------------------------------------------------

interface DownloadJob {
  url: string;
  dest: string;
  label: string;
}

async function downloadFile(job: DownloadJob, signal: AbortSignal, onChunk: (n: number) => void) {
  const tmp = `${job.dest}.part`;
  fs.mkdirSync(path.dirname(job.dest), { recursive: true });

  // Resume if we have a partial file
  let resumeFrom = 0;
  try { resumeFrom = fs.statSync(tmp).size; } catch { /* fresh */ }

  const headers: Record<string, string> = { 'User-Agent': 'vellum-app' };
  if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;

  const res = await net.fetch(job.url, { headers, signal });
  if (!res.ok && res.status !== 206) {
    throw new Error(`Download ${job.label}: HTTP ${res.status}`);
  }

  const writer = fs.createWriteStream(tmp, { flags: resumeFrom > 0 ? 'a' : 'w' });
  if (resumeFrom > 0) onChunk(resumeFrom);

  const reader = res.body!.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(value.byteLength);
    if (!writer.write(Buffer.from(value))) {
      await new Promise((resolve) => writer.once('drain', resolve));
    }
  }
  await new Promise<void>((resolve, reject) => writer.end((err: Error | null | undefined) => err ? reject(err) : resolve()));
  fs.renameSync(tmp, job.dest);
}

export async function downloadModel(): Promise<void> {
  if (current.state === 'downloading') return;
  if (modelExists()) {
    setStatus({ state: 'idle', modelPresent: true });
    return;
  }

  downloadAbort = new AbortController();
  const signal = downloadAbort.signal;

  const jobs: DownloadJob[] = [];
  try { fs.statSync(modelPath()); } catch { jobs.push({ url: MODEL_URL, dest: modelPath(), label: 'model' }); }
  try { fs.statSync(mmprojPath()); } catch { jobs.push({ url: MMPROJ_URL, dest: mmprojPath(), label: 'mmproj' }); }

  setStatus({ state: 'downloading', downloadedBytes: 0, totalBytes: undefined, message: 'Downloading model…' });

  // We don't trust HEAD for HF; just stream and report bytes-so-far.
  let total = 0;
  const onChunk = (n: number) => {
    total += n;
    setStatus({ downloadedBytes: total });
  };

  try {
    for (const job of jobs) {
      setStatus({ message: `Downloading ${job.label}…` });
      await downloadFile(job, signal, onChunk);
    }
    setStatus({ state: 'idle', modelPresent: true, message: 'Model ready' });
  } catch (err) {
    if (signal.aborted) {
      setStatus({ state: 'idle', message: 'Download cancelled' });
    } else {
      console.error('Model download failed:', err);
      setStatus({ state: 'error', message: `Download failed: ${(err as Error).message}` });
    }
  } finally {
    downloadAbort = null;
  }
}

export function cancelDownload() {
  downloadAbort?.abort();
}

// --- Server lifecycle -------------------------------------------------------

async function waitForReady(port: number, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('aborted');
    try {
      const res = await net.fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        // llama-server returns {status: "ok"} once weights are loaded.
        if (!data.status || data.status === 'ok') return;
      }
    } catch { /* server not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('llama-server did not become ready within 120s');
}

export async function ensureRunning(): Promise<void> {
  if (serverProc && !serverProc.killed && current.state === 'ready') return;
  if (serverReadyPromise) return serverReadyPromise;

  if (!binaryExists()) {
    setStatus({ state: 'missing-binary', message: 'Bundled llama-server binary missing. Reinstall the app.' });
    throw new Error('llama-server binary missing');
  }
  if (!modelExists()) {
    setStatus({ state: 'missing-model', message: 'Local model not downloaded yet.' });
    throw new Error('local model not downloaded');
  }

  const port = getConfig().localServerPort;
  setStatus({ state: 'starting', message: 'Starting local model…' });

  const args = [
    '-m', modelPath(),
    '--mmproj', mmprojPath(),
    '--host', '127.0.0.1',
    '--port', String(port),
    '-c', '8192',
    '--no-webui',
  ];

  serverProc = spawn(binaryPath(), args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  serverProc.stdout?.on('data', (b) => process.stdout.write(`[llama] ${b}`));
  serverProc.stderr?.on('data', (b) => process.stderr.write(`[llama] ${b}`));
  serverProc.on('exit', (code, signal) => {
    console.warn(`llama-server exited code=${code} signal=${signal}`);
    serverProc = null;
    serverReadyPromise = null;
    if (current.state === 'ready' || current.state === 'starting') {
      setStatus({ state: 'error', message: `llama-server exited (${code ?? signal})` });
    }
  });

  const startAbort = new AbortController();
  serverReadyPromise = (async () => {
    try {
      await waitForReady(port, startAbort.signal);
      setStatus({ state: 'ready', message: 'Local model ready' });
    } catch (err) {
      setStatus({ state: 'error', message: (err as Error).message });
      stop();
      throw err;
    } finally {
      serverReadyPromise = null;
    }
  })();

  return serverReadyPromise;
}

export function stop() {
  if (serverProc && !serverProc.killed) {
    try { serverProc.kill('SIGTERM'); } catch { /* ignore */ }
  }
  serverProc = null;
  serverReadyPromise = null;
  if (current.state === 'ready' || current.state === 'starting') {
    setStatus({ state: 'idle', message: undefined });
  }
}

export function serverEndpoint(): string {
  return `http://127.0.0.1:${getConfig().localServerPort}`;
}

export function modelDisplayName(): string {
  return 'gemma-4-E4B-it (local)';
}
