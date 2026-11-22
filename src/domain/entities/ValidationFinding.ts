/** Data shapes shared by note validation, coverage checking and correction rendering. */

export interface Correction {
  instructorSaid: string;
  actually: string;
  basisQuote: string;
  basisSource: 'ocr' | 'transcript';
  /** Timestamp in HH:MM:SS.mmm form, matching the source span. */
  timestamp: string;
}

export interface CoverageGap {
  source: 'ocr' | 'transcript';
  id: string;
  timestamp: string;
  text: string;
}

export interface CoverageCounts {
  transcriptTotal: number;
  transcriptCovered: number;
  ocrTotal: number;
  ocrCovered: number;
  gapTotal: number;
  gapAppended: number;
}

export interface NoteValidationResult {
  missingTranscript: CoverageGap[];
  missingOcr: CoverageGap[];
  corrections: Correction[];
  incomplete: { topic: string; detail: string }[];
  degraded: boolean;
}

export function emptyCoverageCounts(): CoverageCounts {
  return {
    transcriptTotal: 0,
    transcriptCovered: 0,
    ocrTotal: 0,
    ocrCovered: 0,
    gapTotal: 0,
    gapAppended: 0,
  };
}
