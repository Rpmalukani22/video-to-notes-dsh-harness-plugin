import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { Frame } from '../../domain/entities/Frame.js';
import { Video } from '../../domain/entities/Video.js';
import { IRawOCRRenderer } from '../../application/ports/Interfaces.js';

/**
 * Renders raw on-screen text (OCR) detected from frames into clean Markdown.
 */
export class OCRRenderer implements IRawOCRRenderer {
  async render(frames: Frame[], outputPath: string, video?: Video): Promise<void> {
    await mkdir(dirname(outputPath), { recursive: true });
    const content = this.renderToString(frames, video);
    await writeFile(outputPath, content, 'utf8');
  }

  renderToString(frames: Frame[], video?: Video): string {
    const videoTitle = video ? video.sourcePath.split(/[\\/]/).pop() ?? video.id : 'Video';
    const ocrFrames = frames.filter((f) => f.hasOCR() && f.getText().trim().length > 0);

    const header = [
      `# On-Screen Text (OCR) — ${videoTitle}`,
      '',
      `**Total frames scanned:** ${frames.length} | **Frames with text:** ${ocrFrames.length}`,
      '',
      '---',
      '',
    ].join('\n');

    if (ocrFrames.length === 0) {
      return header + '*No on-screen text was detected in any frame.*\n';
    }

    // Deduplicate consecutive frames with nearly identical text
    const deduplicated = deduplicateOcrFrames(ocrFrames);

    const body = deduplicated
      .map((f, index) => {
        const timeStr = f.timestamp.toISO();
        const conf = Math.round(f.getOCRConfidence() * 100);
        const text = f.getText().trim();
        const typeStr = f.type !== 'unknown' ? ` (${f.type})` : '';

        return [
          `## Slide / Screen #${index + 1} @ ${timeStr}${typeStr}`,
          '',
          `*Confidence: ${conf}%*`,
          '',
          '```text',
          text,
          '```',
          '',
        ].join('\n');
      })
      .join('\n');

    return header + body;
  }
}

function deduplicateOcrFrames(frames: Frame[]): Frame[] {
  const result: Frame[] = [];
  let prevText = '';

  for (const frame of frames) {
    const text = frame.getText().trim().toLowerCase().replace(/\s+/g, ' ');
    if (!text) continue;

    if (prevText && computeSimilarity(prevText, text) > 0.85) {
      // Very similar to previous frame; skip duplicate
      continue;
    }

    result.push(frame);
    prevText = text;
  }

  return result;
}

function computeSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;

  // Simple token jaccard similarity
  const setA = new Set(a.split(' '));
  const setB = new Set(b.split(' '));
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}
