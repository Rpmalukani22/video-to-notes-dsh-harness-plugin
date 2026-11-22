import { describe, expect, it } from 'vitest';
import { checkCoverage } from '../../../src/domain/services/CoverageChecker.js';
import { frameAt, segment, transcript } from '../../helpers/fixtures.js';

describe('CoverageChecker (plan path)', () => {
  it('reports every uncovered item with exact verbatim text', () => {
    const tr = transcript([segment('s1', 0, 'alpha beta gamma'), segment('s2', 1000, 'delta epsilon')]);
    const report = checkCoverage('nothing relevant', tr, [frameAt('f1', 2000, 'zeta eta')]);
    expect(report.gaps).toHaveLength(3);
    expect(report.counts.gapTotal).toBe(3);
    expect(report.counts.gapAppended).toBe(3);
  });
});
