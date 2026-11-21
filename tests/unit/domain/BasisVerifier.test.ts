import { describe, expect, it } from 'vitest';
import { verifyBasis } from '../../../src/domain/services/BasisVerifier.js';
import { frameAt, segment, transcript } from '../../helpers/fixtures.js';

describe('BasisVerifier (plan path)', () => {
  it('accepts a real source span and rejects a fabricated one', () => {
    const tr = transcript([segment('s1', 0, 'we use Python 2')]);
    const frame = frameAt('f1', 5000, 'Python 3');
    const base = { instructorSaid: 'Python 2', actually: 'Python 3', basisQuote: 'Python 3', basisSource: 'ocr' as const, timestamp: frame.timestamp.toISO() };
    expect(verifyBasis(base, tr, [frame])).toBe(true);
    expect(verifyBasis({ ...base, basisQuote: 'fake' }, tr, [frame])).toBe(false);
  });
});
