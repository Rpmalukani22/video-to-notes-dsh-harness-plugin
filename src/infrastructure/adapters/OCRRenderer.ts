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

    // Identify recurring branding/watermarks (e.g. "SCALER", channel logos)
    const watermarks = identifyWatermarks(deduplicated);
    const watermarkNotice = watermarks.size > 0
      ? `*Note: Recurring branding/watermark detected and cleaned: ${[...watermarks].join(', ')}*\n\n`
      : '';

    const body = deduplicated
      .map((f, index) => {
        const timeStr = f.timestamp.toISO();
        const conf = Math.round(f.getOCRConfidence() * 100);
        let text = cleanWatermarks(f.getText().trim(), watermarks);
        if (!text) return null;

        const typeStr = f.type !== 'unknown' ? ` (${f.type})` : '';
        const langCode = isCodeSnippet(text) ? 'python' : 'text';

        return [
          `## Slide / Screen #${index + 1} @ ${timeStr}${typeStr}`,
          '',
          `*Confidence: ${conf}%*`,
          '',
          `\`\`\`${langCode}`,
          text,
          '```',
          '',
        ].join('\n');
      })
      .filter((block): block is string => block !== null)
      .join('\n');

    return header + watermarkNotice + body;
  }
}

function identifyWatermarks(frames: Frame[]): Set<string> {
  if (frames.length < 5) return new Set();

  const phraseCounts = new Map<string, number>();
  for (const frame of frames) {
    const lines = frame.getText().split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && l.length < 30);
    const seenInFrame = new Set<string>();
    for (const line of lines) {
      const clean = line.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (clean.length >= 3 && !seenInFrame.has(clean)) {
        seenInFrame.add(clean);
        phraseCounts.set(clean, (phraseCounts.get(clean) ?? 0) + 1);
      }
    }
  }

  const threshold = Math.max(3, Math.floor(frames.length * 0.40));
  const watermarks = new Set<string>();
  for (const [phrase, count] of phraseCounts.entries()) {
    if (count >= threshold) {
      watermarks.add(phrase);
    }
  }
  return watermarks;
}

function cleanWatermarks(text: string, watermarks: Set<string>): string {
  if (watermarks.size === 0) return text;

  const lines = text.split(/\r?\n/);
  const filtered = lines.filter((line) => {
    const clean = line.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return !watermarks.has(clean);
  });
  return filtered.join('\n').trim();
}

function isCodeSnippet(text: string): boolean {
  const codePatterns = [
    /\b(def|class|import|from|return|elif|if|for|while|try|except)\b/,
    /\b(array|print|len|range|lambda|np|pd|plt)\(/,
    /[{}();=]\s*$/,
    /^\s{2,4}[a-zA-Z0-9_]+/,
  ];
  let matches = 0;
  for (const pattern of codePatterns) {
    if (pattern.test(text)) matches++;
  }
  return matches >= 2;
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
