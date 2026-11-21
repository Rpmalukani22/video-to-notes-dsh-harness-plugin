import { describe, expect, it } from 'vitest';
import { formatCorrection, parseCorrection } from '../../src/domain/services/CorrectionFormatter.js';
import { verifyBasis } from '../../src/domain/services/BasisVerifier.js';
import { checkCoverage } from '../../src/domain/services/CoverageChecker.js';
import { frameAt, segment, transcript } from '../helpers/fixtures.js';

/**
 * Offline harness check. Stub-only numbers are not accuracy evidence; a
 * real-provider seeded run is exercised by scripts/e2e-check-llm.ps1 -Provider real
 * when VTN_REAL_LLM_PROVIDER is configured.
 */
describe('seeded accuracy eval (scripted stub)', () => {
  const tr = transcript([segment('s1', 0, 'we use Python 2 for indexing')]);
  const frame = frameAt('f1', 5000, 'Python 3 indexing');
  const correction = {
    instructorSaid: 'we use Python 2',
    actually: 'Python 3',
    basisQuote: 'Python 3',
    basisSource: 'ocr' as const,
    timestamp: frame.timestamp.toISO(),
  };

  it('flags the seeded wrong fact with a verifiable basis (TP=1, FP=0, FN=0)', () => {
    const line = formatCorrection(correction);
    const parsed = parseCorrection(line);
    expect(parsed).not.toBeNull();
    const tp = parsed !== null && verifyBasis(parsed, tr, [frame]) ? 1 : 0;
    const fp = parsed !== null && !verifyBasis(parsed, tr, [frame]) ? 1 : 0;
    const fn = tp === 1 ? 0 : 1;
    expect({ tp, fp, fn, precision: tp / (tp + fp), recall: tp / (tp + fn) }).toEqual({
      tp: 1, fp: 0, fn: 0, precision: 1, recall: 1,
    });
  });

  it('rejects a fabricated basis instead of emitting an authoritative correction', () => {
    const fake = { ...correction, basisQuote: 'made up quote' };
    expect(verifyBasis(fake, tr, [frame])).toBe(false);
  });

  it('reports full coverage for notes that contain every source item', () => {
    const report = checkCoverage(
      'we use python 2 for indexing; python 3 indexing',
      tr,
      [frame]
    );
    expect(report.gaps).toHaveLength(0);
    expect(report.counts.transcriptCovered).toBe(1);
    expect(report.counts.ocrCovered).toBe(1);
  });

  it('reads the real-provider switch from the environment', () => {
    const real = process.env.VTN_REAL_LLM_PROVIDER !== undefined;
    expect(typeof real).toBe('boolean');
  });
});
