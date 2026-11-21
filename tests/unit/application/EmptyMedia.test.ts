import { describe, expect, it } from 'vitest';
import { checkCoverage } from '../../../src/domain/services/CoverageChecker.js';
import { transcript } from '../../helpers/fixtures.js';

describe('Empty media (plan path)', () => {
  it('reports zero totals when there is no transcript or OCR', () => {
    const report = checkCoverage('no content available', transcript([]), []);
    expect(report.gaps).toHaveLength(0);
    expect(report.counts.transcriptTotal).toBe(0);
    expect(report.counts.ocrTotal).toBe(0);
  });
});
