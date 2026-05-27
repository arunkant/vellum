import { app } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

export interface AIResult {
  extractedText: string;
  description: string;
  model: string;
  processedAt: number;
}

export interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
  time: number;
}

export interface ScreenshotRow {
  id: number;
  filename: string;
  path: string;
  createdAt: number;
  url: string | null;
}

let _db: DatabaseSync | null = null;

function open(): DatabaseSync {
  if (_db) return _db;
  const dbPath = path.join(app.getPath('userData'), 'vellum.db');
  _db = new DatabaseSync(dbPath);
  _db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS screenshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_results (
      screenshot_id INTEGER PRIMARY KEY,
      extracted_text TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      processed_at INTEGER NOT NULL,
      FOREIGN KEY (screenshot_id) REFERENCES screenshots(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      screenshot_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','ai')),
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (screenshot_id) REFERENCES screenshots(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chat_screenshot ON chat_messages(screenshot_id, created_at);

    CREATE TABLE IF NOT EXISTS screenshot_tags (
      screenshot_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (screenshot_id, tag),
      FOREIGN KEY (screenshot_id) REFERENCES screenshots(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tags_tag ON screenshot_tags(tag);
  `);

  // Migration: add url column to screenshots if missing.
  const cols = _db.prepare("PRAGMA table_info(screenshots)").all() as { name: string }[];
  if (!cols.some((c) => c.name === 'url')) {
    _db.exec('ALTER TABLE screenshots ADD COLUMN url TEXT');
  }

  return _db;
}

/** Eagerly initialize the DB. Safe to call multiple times. */
export function initDB(): void { open(); }

export const screenshotsTbl = {
  insert(filename: string, fullPath: string, createdAt: number, url: string | null = null): number {
    const r = open()
      .prepare('INSERT INTO screenshots (filename, path, created_at, url) VALUES (?, ?, ?, ?)')
      .run(filename, fullPath, createdAt, url);
    return Number(r.lastInsertRowid);
  },
  findByFilename(filename: string): ScreenshotRow | null {
    const row = open()
      .prepare('SELECT id, filename, path, created_at as createdAt, url FROM screenshots WHERE filename = ?')
      .get(filename) as unknown as ScreenshotRow | undefined;
    return row ?? null;
  },
  deleteByFilename(filename: string): void {
    open().prepare('DELETE FROM screenshots WHERE filename = ?').run(filename);
  },
};

export interface ScreenshotListRow {
  name: string;
  path: string;
  time: number;
  url: string | null;
  aiText: string | null;
  aiDescription: string | null;
  aiModel: string | null;
  chatCount: number;
  chatPreview: string | null;
}

export const aiResultsTbl = {
  upsert(screenshotId: number, result: AIResult): void {
    open().prepare(`
      INSERT INTO ai_results (screenshot_id, extracted_text, description, model, processed_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(screenshot_id) DO UPDATE SET
        extracted_text = excluded.extracted_text,
        description = excluded.description,
        model = excluded.model,
        processed_at = excluded.processed_at
    `).run(screenshotId, result.extractedText, result.description, result.model, result.processedAt);
  },
  getByFilename(filename: string): AIResult | null {
    const row = open().prepare(`
      SELECT a.extracted_text as extractedText, a.description, a.model, a.processed_at as processedAt
      FROM ai_results a
      JOIN screenshots s ON s.id = a.screenshot_id
      WHERE s.filename = ?
    `).get(filename) as unknown as AIResult | undefined;
    return row ?? null;
  },
};

export const tagsTbl = {
  add(screenshotId: number, tag: string): void {
    open().prepare(
      'INSERT OR IGNORE INTO screenshot_tags (screenshot_id, tag, created_at) VALUES (?, ?, ?)'
    ).run(screenshotId, tag, Date.now());
  },
  remove(screenshotId: number, tag: string): void {
    open().prepare(
      'DELETE FROM screenshot_tags WHERE screenshot_id = ? AND tag = ?'
    ).run(screenshotId, tag);
  },
  listByFilename(filename: string): string[] {
    const rows = open().prepare(`
      SELECT t.tag as tag
      FROM screenshot_tags t
      JOIN screenshots s ON s.id = t.screenshot_id
      WHERE s.filename = ?
      ORDER BY t.created_at ASC
    `).all(filename) as unknown as { tag: string }[];
    return rows.map((r) => r.tag);
  },
};

export const chatMessagesTbl = {
  add(screenshotId: number, msg: ChatMessage): void {
    open().prepare(
      'INSERT INTO chat_messages (screenshot_id, role, text, created_at) VALUES (?, ?, ?, ?)'
    ).run(screenshotId, msg.role, msg.text, msg.time);
  },
  getByFilename(filename: string): ChatMessage[] {
    const rows = open().prepare(`
      SELECT c.role, c.text, c.created_at as time
      FROM chat_messages c
      JOIN screenshots s ON s.id = c.screenshot_id
      WHERE s.filename = ?
      ORDER BY c.created_at ASC
    `).all(filename) as unknown as ChatMessage[];
    return rows;
  },
};

export function listScreenshotEntries(): ScreenshotListRow[] {
  return open().prepare(`
    SELECT
      s.filename as name,
      s.path as path,
      s.created_at as time,
      s.url as url,
      a.extracted_text as aiText,
      a.description as aiDescription,
      a.model as aiModel,
      (SELECT COUNT(*) FROM chat_messages c WHERE c.screenshot_id = s.id) as chatCount,
      (SELECT GROUP_CONCAT(text, ' ')
         FROM (SELECT text FROM chat_messages c2 WHERE c2.screenshot_id = s.id ORDER BY c2.created_at)) as chatPreview
    FROM screenshots s
    LEFT JOIN ai_results a ON a.screenshot_id = s.id
    ORDER BY s.created_at DESC
  `).all() as unknown as ScreenshotListRow[];
}
