import { describe, expect, it } from 'vitest';
import { LLMNoteValidator } from '../../../src/application/services/NoteValidator.js';
import { ConsoleLogger } from '../../../src/infrastructure/adapters/ConsoleLogger.js';
import type { ILLMProvider, LLMConfig } from '../../../src/application/ports/Interfaces.js';
import { frameAt, segment, transcript } from '../../helpers/fixtures.js';

const config: LLMConfig = { provider: 'deepseek', temperature: 0.1, maxTokens: 1024, topP: 0.9 };

describe('NoteValidator (plan path)', () => {
  const base = { notes: 'n', transcript: transcript([segment('s1', 0, 'we use Python 2')]), frames: [frameAt('f1', 5000, 'Python 3')], screenshots: new Map(), language: 'en' };

  it('returns degraded on a non-abort failure and rethrows on abort', async () => {
    const failing = { completeStructured: async () => { throw new Error('offline'); } } as unknown as ILLMProvider;
    const validator = new LLMNoteValidator(failing, config, new ConsoleLogger('error'), 'cloud-opt-in');
    expect((await validator.validate(base)).degraded).toBe(true);
    const controller = new AbortController();
    controller.abort();
    await expect(validator.validate(base, { signal: controller.signal })).rejects.toThrow();
  });

  it('makes zero calls when privacy is local-only', async () => {
    let calls = 0;
    const stub = { completeStructured: async () => { calls++; return { missingTranscript: [], missingOcr: [], corrections: [], incomplete: [], degraded: false }; } } as unknown as ILLMProvider;
    await new LLMNoteValidator(stub, config, new ConsoleLogger('error'), 'local-only').validate(base);
    expect(calls).toBe(0);
  });
});
