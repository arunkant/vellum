#!/usr/bin/env node
// Downloads the llama.cpp `llama-server` binary (plus its runtime libs) for the
// current host platform and unpacks it into `vendor/llama/<platform>-<arch>/`.
// Forge picks up `./vendor/llama` as an extra resource, so the bundled binary
// rides along in the packaged app.
//
// Usage:
//   node scripts/download-llama.mjs              # current host platform
//   node scripts/download-llama.mjs --all        # mac + linux + win (CI)
//   LLAMA_BUILD=b6789 node scripts/download-llama.mjs   # pin to a build
//
// We intentionally talk to the GitHub API anonymously; if you hit rate limits,
// set GITHUB_TOKEN.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const vendorRoot = path.join(repoRoot, 'vendor', 'llama');

// Asset name → folder we'll unpack to. macOS/Linux ship `.tar.gz`, Windows
// ships `.zip`. The exclude pattern filters out flavored builds like
// `-macos-arm64-kleidiai.tar.gz` that share the base prefix.
const TARGETS = {
  'darwin-arm64': { pattern: /-bin-macos-arm64\.tar\.gz$/, exclude: /-kleidiai/, dir: 'darwin-arm64' },
  'darwin-x64': { pattern: /-bin-macos-x64\.tar\.gz$/, dir: 'darwin-x64' },
  'linux-x64': { pattern: /-bin-ubuntu-x64\.tar\.gz$/, dir: 'linux-x64' },
  'linux-arm64': { pattern: /-bin-ubuntu-arm64\.tar\.gz$/, dir: 'linux-arm64' },
  'win32-x64': { pattern: /-bin-win-cpu-x64\.zip$/, dir: 'win32-x64' },
};

function currentTarget() {
  return `${process.platform}-${process.arch}`;
}

async function ghFetch(url) {
  const headers = { 'User-Agent': 'vellum-build' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${url}`);
  return res;
}

async function getRelease() {
  const build = process.env.LLAMA_BUILD;
  if (build) {
    const res = await ghFetch(`https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/${build}`);
    return res.json();
  }
  const res = await ghFetch('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest');
  return res.json();
}

async function downloadAsset(url, dest) {
  const res = await ghFetch(url);
  await pipeline(res.body, fs.createWriteStream(dest));
}

function runUnzip(zipPath, outDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn('unzip', ['-oq', zipPath, '-d', outDir], { stdio: 'inherit' });
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`unzip exit ${code}`))));
  });
}

function runTarGz(tarPath, outDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn('tar', ['-xzf', tarPath, '-C', outDir], { stdio: 'inherit' });
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tar exit ${code}`))));
  });
}

async function downloadOne(targetKey, release) {
  const target = TARGETS[targetKey];
  if (!target) throw new Error(`Unsupported target: ${targetKey}`);

  const asset = release.assets.find(
    (a) => target.pattern.test(a.name) && !(target.exclude && target.exclude.test(a.name)),
  );
  if (!asset) {
    throw new Error(`No asset matching ${target.pattern} in release ${release.tag_name}`);
  }

  const destDir = path.join(vendorRoot, target.dir);
  const versionFile = path.join(destDir, '.version');
  if (fs.existsSync(versionFile) && fs.readFileSync(versionFile, 'utf-8').trim() === release.tag_name) {
    console.log(`✓ ${targetKey}: already at ${release.tag_name}`);
    return;
  }

  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });

  const tmpPath = path.join(os.tmpdir(), asset.name);
  console.log(`↓ ${targetKey}: ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)`);
  await downloadAsset(asset.browser_download_url, tmpPath);
  if (asset.name.endsWith('.zip')) {
    await runUnzip(tmpPath, destDir);
  } else if (asset.name.endsWith('.tar.gz') || asset.name.endsWith('.tgz')) {
    await runTarGz(tmpPath, destDir);
  } else {
    throw new Error(`Unknown archive format for ${asset.name}`);
  }
  fs.unlinkSync(tmpPath);

  // Find llama-server somewhere inside the unpacked tree, then hoist its
  // directory contents up to `destDir` so the runtime path is predictable.
  const found = findBinary(destDir, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server');
  if (!found) throw new Error(`llama-server not found inside ${asset.name}`);
  const binDir = path.dirname(found);
  if (binDir !== destDir) {
    for (const entry of fs.readdirSync(binDir)) {
      fs.renameSync(path.join(binDir, entry), path.join(destDir, entry));
    }
  }
  if (process.platform !== 'win32') {
    fs.chmodSync(path.join(destDir, 'llama-server'), 0o755);
  }
  fs.writeFileSync(versionFile, release.tag_name);
  console.log(`✓ ${targetKey}: installed ${release.tag_name} → ${destDir}`);
}

function findBinary(root, name) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === name) return full;
    }
  }
  return null;
}

async function main() {
  fs.mkdirSync(vendorRoot, { recursive: true });
  const release = await getRelease();
  console.log(`Using llama.cpp release ${release.tag_name}`);

  const wantAll = process.argv.includes('--all');
  const targets = wantAll ? Object.keys(TARGETS) : [currentTarget()];
  for (const t of targets) {
    if (!TARGETS[t]) {
      console.warn(`Skip ${t}: no asset mapping`);
      continue;
    }
    await downloadOne(t, release);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
