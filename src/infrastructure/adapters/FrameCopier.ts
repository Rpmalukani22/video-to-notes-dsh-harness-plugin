import { mkdir, writeFile, copyFile } from 'fs/promises';
import { join } from 'path';
import type { Frame } from '../../domain/entities/Frame.js';
import type { IFrameCopier, ILogger } from '../../application/ports/Interfaces.js';
import { selectTimelineScreenshots } from '../../domain/services/ScreenshotSelector.js';

/**
 * Selects representative key frames and copies/writes them to the output frames directory.
 */
export class FrameCopier implements IFrameCopier {
  constructor(private readonly _logger?: ILogger) {}

  async copyKeyFrames(
    frames: Frame[],
    outputDir: string,
    baseName: string,
    maxFrames: number = 20,
    durationMs?: number
  ): Promise<Map<string, string>> {
    const frameMap = new Map<string, string>(); // frameId -> relativePath
    if (frames.length === 0) return frameMap;

    const framesDirName = `${baseName}_frames`;
    const targetDir = join(outputDir, framesDirName);
    await mkdir(targetDir, { recursive: true });

    // Select candidate key frames
    const candidates = selectTimelineScreenshots(frames, { maxScreenshots: maxFrames, durationMs });

    let savedIndex = 1;
    for (const frame of candidates) {
      const timeTag = frame.timestamp.toISO().replace(/[:.]/g, '-');
      const filename = `frame_${String(savedIndex).padStart(2, '0')}_${timeTag}.jpg`;
      const targetPath = join(targetDir, filename);
      const relativePath = `${framesDirName}/${filename}`;

      try {
        if (frame.imageData && frame.imageData.length > 0) {
          await writeFile(targetPath, frame.imageData);
          frame.setImagePath(targetPath);
          frameMap.set(frame.id, relativePath);
          savedIndex++;
        } else if (frame.imagePath) {
          await copyFile(frame.imagePath, targetPath);
          frame.setImagePath(targetPath);
          frameMap.set(frame.id, relativePath);
          savedIndex++;
        }
      } catch (err) {
        this._logger?.warn(`Failed to save screenshot for frame ${frame.id}: ${err}`);
      }
    }

    return frameMap;
  }
}
