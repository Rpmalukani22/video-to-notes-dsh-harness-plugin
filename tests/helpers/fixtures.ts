import { Frame } from '../../src/domain/entities/Frame.js';
import { Video, VideoMetadata } from '../../src/domain/entities/Video.js';
import { Transcript, TranscriptSegment } from '../../src/domain/entities/Transcript.js';
import { Timestamp } from '../../src/domain/value-objects/Timestamp.js';
import { Confidence } from '../../src/domain/value-objects/Confidence.js';
import { OCRResult } from '../../src/domain/value-objects/OCRResult.js';
import { BoundingBox } from '../../src/domain/value-objects/BoundingBox.js';

export function ocrResult(text: string): OCRResult {
  const box = new BoundingBox(0, 0, 10, 10);
  return new OCRResult(
    [{ text, confidence: new Confidence(0.9), boundingBox: box, words: [] }],
    'eng',
    1
  );
}

export function frameAt(id: string, ms: number, text?: string): Frame {
  const frame = new Frame(id, 'v1', Timestamp.fromMilliseconds(ms), ms);
  if (text !== undefined) frame.setOCRResult(ocrResult(text));
  return frame;
}

export function segment(id: string, startMs: number, text: string): TranscriptSegment {
  return new TranscriptSegment(
    id,
    Timestamp.fromMilliseconds(startMs),
    Timestamp.fromMilliseconds(startMs + 2000),
    text,
    new Confidence(0.9),
    [],
    'en',
    null
  );
}

export function transcript(segments: TranscriptSegment[], language = 'en'): Transcript {
  return new Transcript('v1', segments, language, 'base.int8', 100);
}

const METADATA: VideoMetadata = {
  duration: Timestamp.fromMilliseconds(3600000),
  width: 1920,
  height: 1080,
  fps: { num: 30, den: 1 },
  codec: 'h264',
  bitrate: 1000,
  format: 'mp4',
  size: 1000,
  chapters: [],
  subtitleTracks: [],
  audioTracks: [],
  isVFR: false,
};

export function video(path = 'C:\\videos\\lecture.mp4'): Video {
  return new Video('v1', path, METADATA, 'hash');
}
