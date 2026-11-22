import type { NoteSection } from '../entities/Note.js';
import type { Frame } from '../entities/Frame.js';

export const MATCH_WINDOW_MS = 15_000;

/** One rule only: nearest saved frame to the section timestamp within a single window. */
export function matchScreenshots(
  sections: NoteSection[],
  frames: Frame[],
  keyFramePaths: Map<string, string>,
  maxReuse = 2
): Map<string, string | null> {
  const result = new Map<string, string | null>();
  const reuse = new Map<string, number>();

  for (const section of sections) {
    if (section.timestamp === null) {
      result.set(section.id, null);
      continue;
    }
    const sectionMs = section.timestamp.milliseconds;
    let bestFrame: Frame | undefined;
    let bestDiff = MATCH_WINDOW_MS + 1;
    for (const frame of frames) {
      const path = keyFramePaths.get(frame.id);
      if (path === undefined || (reuse.get(path) ?? 0) >= maxReuse) continue;
      const diff = Math.abs(frame.timestamp.milliseconds - sectionMs);
      if (diff <= MATCH_WINDOW_MS && diff < bestDiff) {
        bestDiff = diff;
        bestFrame = frame;
      }
    }
    if (bestFrame === undefined) {
      result.set(section.id, null);
      continue;
    }
    const path = keyFramePaths.get(bestFrame.id)!;
    reuse.set(path, (reuse.get(path) ?? 0) + 1);
    result.set(section.id, path);
  }
  return result;
}
