import { describe, expect, it } from 'vitest';
import { LLMNoteValidator } from '../../src/application/services/NoteValidator.js';
import { parseCorrection } from '../../src/domain/services/CorrectionFormatter.js';
import { checkCoverage } from '../../src/domain/services/CoverageChecker.js';
import { ConsoleLogger } from '../../src/infrastructure/adapters/ConsoleLogger.js';
import type { ILLMProvider, LLMConfig } from '../../src/application/ports/Interfaces.js';
import { frameAt, segment, transcript } from '../helpers/fixtures.js';

const LLM_CONFIG: LLMConfig = { provider: 'deepseek', temperature: 0.1, maxTokens: 2048, topP: 0.9 };
const frame = frameAt('f1', 5000, 'Python 3 indexing');
const tr = transcript([segment('s1', 0, 'we use Python 2 for indexing')]);

/** Scripted provider: the model returns a correction with a basis that really
 * exists in the OCR fixture. Accuracy numbers come from the validator's output,
 * not from a hand-built correction object. */
function scriptedProvider(): ILLMProvider {
  return {
    completeStructured: async () => ({
      missingTranscript: [],
      missingOcr: [],
      corrections: [{
        instructorSaid: 'we use Python 2',
        actually: 'Python 3',
        basisQuote: 'Python 3',
        basisSource: 'ocr',
        timestamp: frame.timestamp.toISO(),
      }],
      incomplete: [],
      degraded: false,
    }),
    getModelInfo: () => ({
      provider: 'test', model: 'seeded-v1', maxContextTokens: 8192,
      supportsStreaming: false, supportsStructuredOutput: true, supportsCitations: false,
    }),
  } as unknown as ILLMProvider;
}

describe('seeded accuracy eval', () => {
  it('measures precision and recall from the validator output, not a hand-built fixture', async () => {
    const validator = new LLMNoteValidator(scriptedProvider(), LLM_CONFIG, new ConsoleLogger('error'), 'cloud-opt-in');
    const result = await validator.validate({
      notes: 'we use Python 2 for indexing',
      transcript: tr,
      frames: [frame],
      screenshots: new Map(),
      language: 'en',
    });

    const parsed = result.corrections.map(correction => parseCorrection(
      `> ⚠️ **Instructor said "${correction.instructorSaid}" — actually ${correction.actually}** ` +
      `(basis: "${correction.basisQuote}" @ ${correction.timestamp} [${correction.basisSource}])`
    ));
    const tp = parsed.filter(entry => entry !== null && entry.actually === 'Python 3').length;
    const fp = parsed.filter(entry => entry !== null && entry.actually !== 'Python 3').length;
    const fn = tp > 0 ? 0 : 1;

    expect(result.degraded).toBe(false);
    expect({ tp, fp, fn, precision: tp / (tp + fp), recall: tp / (tp + fn) }).toEqual({
      tp: 1, fp: 0, fn: 0, precision: 1, recall: 1,
    });
  });

  it('rejects a fabricated basis through the validator', async () => {
    const bad = {
      completeStructured: async () => ({
        missingTranscript: [], missingOcr: [],
        corrections: [{
          instructorSaid: 'we use Python 2', actually: 'Python 3', basisQuote: 'FABRICATED',
          basisSource: 'ocr', timestamp: frame.timestamp.toISO(),
        }],
        incomplete: [], degraded: false,
      }),
    } as unknown as ILLMProvider;
    const validator = new LLMNoteValidator(bad, LLM_CONFIG, new ConsoleLogger('error'), 'cloud-opt-in');
    const result = await validator.validate({
      notes: 'notes', transcript: tr, frames: [frame], screenshots: new Map(), language: 'en',
    });
    expect(result.corrections).toHaveLength(0);
    expect(result.incomplete.some(item => item.detail.includes('unverified basis'))).toBe(true);
  });

  it('checks coverage of the fixture without circular notes', () => {
    const report = checkCoverage('we use python 2 for indexing; python 3 indexing', tr, [frame]);
    expect(report.gaps).toHaveLength(0);
  });

});
