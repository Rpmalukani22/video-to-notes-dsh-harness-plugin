import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { Transcript, TranscriptSegment } from '../../domain/entities/Transcript.js';
import { Video } from '../../domain/entities/Video.js';
import { IRawTranscriptRenderer } from '../../application/ports/Interfaces.js';

/**
 * Renders raw transcript segments into clean, readable, time-chunked Markdown.
 */
export class TranscriptRenderer implements IRawTranscriptRenderer {
  async render(transcript: Transcript, outputPath: string, video?: Video): Promise<void> {
    await mkdir(dirname(outputPath), { recursive: true });
    const content = this.renderToString(transcript, video);
    await writeFile(outputPath, content, 'utf8');
  }

  renderToString(transcript: Transcript, video?: Video): string {
    const videoTitle = video ? video.sourcePath.split(/[\\/]/).pop() ?? video.id : transcript.videoId;
    const duration = video ? video.duration.toISO() : 'N/A';
    const lang = transcript.language || 'en';
    const model = transcript.model || 'whisper';

    const header = [
      `# Transcript — ${videoTitle}`,
      '',
      `**Duration:** ${duration} | **Language:** ${lang} | **Model:** ${model}`,
      '',
      '---',
      '',
    ].join('\n');

    if (transcript.segments.length === 0) {
      return header + '*No speech/transcript detected for this video.*\n';
    }

    // Group segments into readable paragraphs (~30-60 second windows or natural pauses)
    const paragraphs = groupSegmentsIntoParagraphs(transcript.segments, 45000);

    const body = paragraphs
      .map((p) => {
        const timeHeader = `## [${p.startTime}] – [${p.endTime}]`;
        return `${timeHeader}\n\n${p.text}\n`;
      })
      .join('\n');

    return header + body;
  }
}

interface SegmentGroup {
  startTime: string;
  endTime: string;
  text: string;
}

function groupSegmentsIntoParagraphs(segments: TranscriptSegment[], maxWindowMs: number): SegmentGroup[] {
  const groups: SegmentGroup[] = [];
  if (segments.length === 0) return groups;

  let currentGroupStart = segments[0]!.start.milliseconds;
  let currentGroupEnd = segments[0]!.end.milliseconds;
  let currentGroupStartTime = segments[0]!.start.toISO();
  let currentGroupEndTime = segments[0]!.end.toISO();
  let accumulatedSentences: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    const text = seg.text.trim();
    if (!text) continue;

    const span = seg.end.milliseconds - currentGroupStart;
    const hasPause = i > 0 && (seg.start.milliseconds - segments[i - 1]!.end.milliseconds > 3000);

    if ((span > maxWindowMs || hasPause) && accumulatedSentences.length > 0) {
      groups.push({
        startTime: currentGroupStartTime,
        endTime: currentGroupEndTime,
        text: formatParagraph(accumulatedSentences),
      });
      currentGroupStart = seg.start.milliseconds;
      currentGroupStartTime = seg.start.toISO();
      accumulatedSentences = [];
    }

    accumulatedSentences.push(text);
    currentGroupEnd = seg.end.milliseconds;
    currentGroupEndTime = seg.end.toISO();
  }

  if (accumulatedSentences.length > 0) {
    groups.push({
      startTime: currentGroupStartTime,
      endTime: currentGroupEndTime,
      text: formatParagraph(accumulatedSentences),
    });
  }

  return groups;
}

function formatParagraph(sentences: string[]): string {
  // Join segments cleanly, stitching broken words/lines
  return sentences
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}
