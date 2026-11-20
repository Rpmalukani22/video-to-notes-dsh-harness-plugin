import { mkdir, writeFile, copyFile } from 'fs/promises';
import { join } from 'path';
import { Frame } from '../../domain/entities/Frame.js';
import { IFrameCopier, ILogger } from '../../application/ports/Interfaces.js';

/**
 * Selects representative key frames and copies/writes them to the output frames directory.
 */
export class FrameCopier implements IFrameCopier {
  constructor(private readonly _logger?: ILogger) {}

  async copyKeyFrames(
    frames: Frame[],
    outputDir: string,
    baseName: string,
    maxFrames: number = 20
  ): Promise<Map<string, string>> {
    const frameMap = new Map<string, string>(); // frameId -> relativePath
    if (frames.length === 0) return frameMap;

    const framesDirName = `${baseName}_frames`;
    const targetDir = join(outputDir, framesDirName);
    await mkdir(targetDir, { recursive: true });

    // Select candidate key frames
    const candidates = selectKeyFrames(frames, maxFrames);

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

/**
 * Filter and prioritize key frames:
 * 1. Frames with detected scenes or OCR text
 * 2. Spread across the timeline (min interval ~20-30s)
 * 3. Up to maxFrames
 */
function selectKeyFrames(frames: Frame[], maxFrames: number): Frame[] {
  // Prefer frames that have OCR content
  const sortedByTime = [...frames].sort((a, b) => a.timestamp.milliseconds - b.timestamp.milliseconds);
  if (sortedByTime.length <= maxFrames) {
    return sortedByTime;
  }

  const selected: Frame[] = [];
  const minIntervalMs = 20000; // 20s
  let lastTimeMs = -minIntervalMs;

  // First pass: frames with OCR text
  for (const frame of sortedByTime) {
    if (selected.length >= maxFrames) break;
    if (frame.hasOCR() && frame.getText().trim().length > 20) {
      if (frame.timestamp.milliseconds - lastTimeMs >= minIntervalMs) {
        selected.push(frame);
        lastTimeMs = frame.timestamp.milliseconds;
      }
    }
  }

  // Second pass: if we still have room, add regular frames evenly spaced
  if (selected.length < Math.min(5, maxFrames)) {
    lastTimeMs = -minIntervalMs;
    const step = Math.max(1, Math.floor(sortedByTime.length / maxFrames));
    for (let i = 0; i < sortedByTime.length && selected.length < maxFrames; i += step) {
      const f = sortedByTime[i]!;
      if (!selected.includes(f)) {
        selected.push(f);
      }
    }
    selected.sort((a, b) => a.timestamp.milliseconds - b.timestamp.milliseconds);
  }

  return selected.slice(0, maxFrames);
}
