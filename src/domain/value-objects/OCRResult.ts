import { Confidence } from './Confidence.js';
import { BoundingBox } from './BoundingBox.js';

/**
 * Word-level OCR result with timestamp alignment
 */
export interface WordTimestamp {
  text: string;
  confidence: Confidence;
  boundingBox: BoundingBox;
  startTimestamp: number; // milliseconds from video start
  endTimestamp: number;   // milliseconds from video start
}

/**
 * Line-level OCR result
 */
export interface LineOCRResult {
  text: string;
  confidence: Confidence;
  boundingBox: BoundingBox;
  words: WordTimestamp[];
}

/**
 * Complete OCR result for a frame
 */
export class OCRResult {
  private readonly _lines: LineOCRResult[];
  private readonly _fullText: string;
  private readonly _averageConfidence: Confidence;
  private readonly _language: string;
  private readonly _processingTimeMs: number;

  constructor(
    lines: LineOCRResult[],
    language: string,
    processingTimeMs: number
  ) {
    this._lines = lines;
    this._language = language;
    this._processingTimeMs = processingTimeMs;

    // Build full text
    this._fullText = lines.map(l => l.text).join('\n');

    // Calculate average confidence
    if (lines.length > 0) {
      const sum = lines.reduce((acc, l) => acc + l.confidence.value, 0);
      this._averageConfidence = new Confidence(sum / lines.length);
    } else {
      this._averageConfidence = Confidence.zero();
    }
  }

  get lines(): LineOCRResult[] {
    return this._lines;
  }

  get fullText(): string {
    return this._fullText;
  }

  get averageConfidence(): Confidence {
    return this._averageConfidence;
  }

  get language(): string {
    return this._language;
  }

  get processingTimeMs(): number {
    return this._processingTimeMs;
  }

  get lineCount(): number {
    return this._lines.length;
  }

  get wordCount(): number {
    return this._lines.reduce((acc, l) => acc + l.words.length, 0);
  }

  getAllWords(): WordTimestamp[] {
    return this._lines.flatMap(l => l.words);
  }

  filterByConfidence(threshold: Confidence): OCRResult {
    const filteredLines = this._lines
      .map(line => ({
        ...line,
        words: line.words.filter(w => w.confidence.greaterThanOrEqual(threshold))
      }))
      .filter(line => line.words.length > 0);

    return new OCRResult(filteredLines, this._language, this._processingTimeMs);
  }

  toJSON(): object {
    return {
      lines: this._lines.map(l => ({
        text: l.text,
        confidence: l.confidence.toJSON(),
        boundingBox: l.boundingBox.toJSON(),
        words: l.words.map(w => ({
          text: w.text,
          confidence: w.confidence.toJSON(),
          boundingBox: w.boundingBox.toJSON(),
          startTimestamp: w.startTimestamp,
          endTimestamp: w.endTimestamp
        }))
      })),
      fullText: this._fullText,
      averageConfidence: this._averageConfidence.toJSON(),
      language: this._language,
      processingTimeMs: this._processingTimeMs
    };
  }
}