import { stat } from 'fs/promises';
import { isAbsolute, resolve } from 'path';

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.flv', '.wmv', '.mpg', '.mpeg', '.ts',
]);

/**
 * Reject bad paths with an actionable message instead of letting ffmpeg fail
 * later with an opaque exit code.
 */
export async function assertReadableVideo(videoPath: string): Promise<string> {
  if (videoPath.trim().length === 0) {
    throw new Error('videoPath is required');
  }
  if (!isAbsolute(videoPath)) {
    throw new Error(`videoPath must be an absolute path (got "${videoPath}")`);
  }

  const info = await stat(videoPath).catch(() => undefined);
  if (info === undefined) {
    throw new Error(`videoPath does not exist: ${videoPath}`);
  }
  if (!info.isFile()) {
    throw new Error(`videoPath is not a file: ${videoPath}`);
  }
  if (info.size === 0) {
    throw new Error(`videoPath is empty: ${videoPath}`);
  }

  const dot = videoPath.lastIndexOf('.');
  const extension = dot === -1 ? '' : videoPath.slice(dot).toLowerCase();
  if (!VIDEO_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported video extension "${extension || '(none)'}". ` +
        `Supported: ${[...VIDEO_EXTENSIONS].join(', ')}`
    );
  }

  return resolve(videoPath);
}

/** Directory arguments must be absolute so the job never depends on the CWD. */
export function assertAbsoluteDir(value: string, field: string): string {
  if (!isAbsolute(value)) {
    throw new Error(`${field} must be an absolute path (got "${value}")`);
  }
  return resolve(value);
}
