import { mkdir, readFile, writeFile, rename, unlink, readdir } from 'fs/promises';
import { dirname, join } from 'path';
import { ICheckpointStore, CheckpointData } from '../../application/ports/Interfaces.js';
import { ILogger } from '../../application/ports/Interfaces.js';

/**
 * File-backed checkpoint store. One JSON file per key, written atomically
 * (temp file + rename) so a crash cannot leave a half-written checkpoint.
 */
export class JsonCheckpointStore implements ICheckpointStore {
  private readonly _dir: string;
  private readonly _logger: ILogger;

  constructor(dir: string, logger: ILogger) {
    this._dir = dir;
    this._logger = logger;
  }

  async save(key: string, data: CheckpointData): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmp, path);
  }

  async load(key: string): Promise<CheckpointData | null> {
    try {
      const raw = await readFile(this.pathFor(key), 'utf8');
      return JSON.parse(raw) as CheckpointData;
    } catch (error) {
      if (isNotFound(error)) return null;
      this._logger.warn('Failed to load checkpoint', { key, error: String(error) });
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async list(prefix: string): Promise<string[]> {
    try {
      const entries = await readdir(this._dir);
      return entries
        .filter(name => name.endsWith('.json'))
        .map(name => name.slice(0, -'.json'.length))
        .filter(name => name.startsWith(prefix));
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  private pathFor(key: string): string {
    return join(this._dir, `${sanitizeKey(key)}.json`);
  }
}

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ENOENT';
}
