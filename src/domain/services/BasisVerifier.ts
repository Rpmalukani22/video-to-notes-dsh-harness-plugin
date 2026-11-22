import type { Transcript } from '../entities/Transcript.js';
import type { Frame } from '../entities/Frame.js';
import type { Correction } from '../entities/ValidationFinding.js';
import { normalizeText } from './TextTokens.js';

/**
 * A correction is only authoritative when its quoted basis is really present
 * in the transcript or OCR at the stated timestamp. Otherwise the caller
 * downgrades it to a `Check` note.
 */
export function verifyBasis(
  correction: Correction,
  transcript: Transcript,
  frames: Frame[]
): boolean {
  if (correction.basisQuote.trim().length === 0 || correction.timestamp.trim().length === 0) {
    return false;
  }
  const quote = normalizeText(correction.basisQuote);
  if (correction.basisSource === 'transcript') {
    return transcript.segments.some(
      segment =>
        segment.start.toISO() === correction.timestamp &&
        normalizeText(segment.text).includes(quote)
    );
  }
  return frames.some(
    frame =>
      frame.hasOCR() &&
      frame.timestamp.toISO() === correction.timestamp &&
      normalizeText(frame.getText()).includes(quote)
  );
}
