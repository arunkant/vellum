import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface AppConfig {
  openrouterApiKey: string;
  aiModel: string;
}

const DEFAULT_MODEL = 'google/gemini-2.5-flash-lite';
const configPath = path.join(app.getPath('userData'), 'config.json');

interface StoredConfig {
  openrouterApiKeyEnc?: string;
  openrouterApiKey?: string;
  aiModel?: string;
}

function readStored(): StoredConfig {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {};
}

export function getConfig(): AppConfig {
  const stored = readStored();
  let key = '';
  if (stored.openrouterApiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try {
      key = safeStorage.decryptString(Buffer.from(stored.openrouterApiKeyEnc, 'base64'));
    } catch { /* ignore */ }
  }
  if (!key && stored.openrouterApiKey) {
    key = stored.openrouterApiKey;
  }
  return { openrouterApiKey: key, aiModel: stored.aiModel || DEFAULT_MODEL };
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const merged: AppConfig = { ...getConfig(), ...patch };
  const onDisk: StoredConfig = { aiModel: merged.aiModel };
  if (merged.openrouterApiKey) {
    let encrypted = false;
    if (safeStorage.isEncryptionAvailable()) {
      try {
        onDisk.openrouterApiKeyEnc = safeStorage
          .encryptString(merged.openrouterApiKey)
          .toString('base64');
        encrypted = true;
      } catch (err) {
        console.warn('safeStorage.encryptString failed; falling back to plaintext:', err);
      }
    }
    if (!encrypted) {
      console.warn('Storing OpenRouter key in plaintext at', configPath);
      onDisk.openrouterApiKey = merged.openrouterApiKey;
    }
  }
  try {
    fs.writeFileSync(configPath, JSON.stringify(onDisk, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save config:', err);
  }
  return merged;
}
