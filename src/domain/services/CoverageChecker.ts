import type { Transcript } from '../entities/Transcript.js';
import type { Frame } from '../entities/Frame.js';
import { contentTokens, normalizeText } from './TextTokens.js';
import type { CoverageCounts, CoverageGap } from '../entities/ValidationFinding.js';

export interface CoverageReport {
  gaps: CoverageGap[];
  counts: CoverageCounts;
}

/**
 * Two deterministic tiers: full normalised substring, or all content tokens
 * present (a paraphrase). Counts are measured BEFORE any verbatim gap appendix
 * is added, so appended gap text cannot reclassify a gap as covered.
 */
export function checkCoverage(
  notes: string,
  transcript: Transcript,
  frames: Frame[]
): CoverageReport {
  const haystack = normalizeText(notes);
  const haystackTokens = new Set(contentTokens(notes));
  const gaps: CoverageGap[] = [];
  let transcriptCovered = 0;
  let ocrCovered = 0;

  for (const segment of transcript.segments) {
    if (segment.text.trim().length === 0) continue;
    if (isCovered(segment.text, haystack, haystackTokens)) transcriptCovered++;
    else {
      gaps.push({
        source: 'transcript',
        id: segment.id,
        timestamp: segment.start.toISO(),
        text: segment.text,
      });
    }
  }

  for (const frame of frames) {
    if (!frame.hasOCR()) continue;
    const text = frame.getText().trim();
    if (text.length === 0) continue;
    if (isCovered(text, haystack, haystackTokens)) ocrCovered++;
    else {
      gaps.push({
        source: 'ocr',
        id: frame.id,
        timestamp: frame.timestamp.toISO(),
        text,
      });
    }
  }

  return {
    gaps,
    counts: {
      transcriptTotal: transcript.segments.length,
      transcriptCovered,
      ocrTotal: frames.filter(frame => frame.hasOCR() && frame.getText().trim().length > 0).length,
      ocrCovered,
      gapTotal: gaps.length,
      gapAppended: gaps.length,
    },
  };
}

function isCovered(text: string, haystack: string, haystackTokens: Set<string>): boolean {
  const normalized = normalizeText(text);
  if (normalized.length === 0) return true;
  if (haystack.includes(normalized)) return true;
  const tokens = contentTokens(text);
  if (tokens.length === 0) return false; // guard against vacuous stopword-only coverage
  return tokens.every(token => haystackTokens.has(token));
}
