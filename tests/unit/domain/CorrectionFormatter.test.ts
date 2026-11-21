import { describe, expect, it } from 'vitest';
import { formatCorrection, parseCorrection, dedupeCorrections } from '../../../src/domain/services/CorrectionFormatter.js';

describe('CorrectionFormatter (plan path)', () => {
  const c = { instructorSaid: 'Python 2', actually: '**Python 3**\nline', basisQuote: 'Python 3', basisSource: 'ocr' as const, timestamp: '00:00:05.000' };
  it('round-trips strictly including bold and newlines', () => {
    expect(parseCorrection(formatCorrection(c))).toEqual(c);
  });
  it('deduplicates repeated instructor quotes', () => {
    expect(dedupeCorrections([c, c])).toHaveLength(1);
  });
});
