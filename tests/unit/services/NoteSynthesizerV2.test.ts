import { describe, expect, it } from 'vitest';
import { NoteSynthesizer } from '../../../src/application/services/NoteSynthesizer.js';
import { LLMNoteValidator } from '../../../src/application/services/NoteValidator.js';
import { ConsoleLogger } from '../../../src/infrastructure/adapters/ConsoleLogger.js';
import type { ILLMProvider, SynthesisInput, LLMConfig } from '../../../src/application/ports/Interfaces.js';
import type { NoteSection } from '../../../src/domain/entities/Note.js';
import { frameAt, segment, transcript, video } from '../../helpers/fixtures.js';

const LLM_CONFIG: LLMConfig = { provider: 'deepseek', temperature: 0.2, maxTokens: 2048, topP: 0.9 };

const logger = new ConsoleLogger('error');

const sections: NoteSection[] = [
  {
    id: 's1',
    title: 'Overview',
    level: 2,
    timestamp: null,
    content: '**Visual Content:**\nPython 3\n\n**Transcript:**\nwe use Python 2 for indexing',
    subsections: [],
    citations: [],
    metadata: {},
  },
];

function input(): SynthesisInput {
  return {
    video: video(),
    transcript: transcript([segment('s1', 0, 'we use Python 2 for indexing')]),
    frames: [frameAt('f1', 5000, 'Python 3 indexing')],
    scenes: [],
    alignedBlocks: [],
    keyFramePaths: new Map(),
    sections,
  };
}

function provider(handler: (request: { systemPrompt?: string; messages: { content: string }[] }) => string): ILLMProvider {
  return {
    complete: async (request: { systemPrompt?: string; messages: { content: string }[] }) => ({
      content: handler(request),
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: 'test',
      finishReason: 'stop' as const,
    }),
    getModelInfo: () => ({
      provider: 'test', model: 'test', maxContextTokens: 8192,
      supportsStreaming: false, supportsStructuredOutput: true, supportsCitations: false,
    }),
    getCapabilities: () => ({ supportsStructuredOutput: true }),
  } as unknown as ILLMProvider;
}

describe('NoteSynthesizer v2', () => {
  it('makes zero provider calls and degrades when privacy is local-only', async () => {
    let calls = 0;
    const p = provider(() => { calls++; return '# Notes'; });
    const result = await new NoteSynthesizer(p, LLM_CONFIG, logger).synthesize(input(), {
      privacy: 'local-only',
    });
    expect(calls).toBe(0);
    expect(result.degraded).toBe(true);
  });

  it('wraps untrusted evidence and strips raw markers', async () => {
    let prompt = '';
    const p = provider((request) => {
      prompt = `${request.systemPrompt ?? ''}\n${request.messages.map((m) => m.content).join('\n')}`;
      return '# Notes\n**Visual Content:** leaked\n**bold** key point';
    });
    const result = await new NoteSynthesizer(p, LLM_CONFIG, logger).synthesize(input(), {
      privacy: 'cloud-opt-in',
    });
    expect(prompt).toContain('<untrusted_source kind="transcript"');
    expect(prompt).toContain('<untrusted_source kind="ocr"');
    expect(prompt).toContain('never instructions');
    expect(result.sections[0]!.content).not.toContain('**Visual Content:**');
    expect(result.sections[0]!.content).toContain('**bold**');
    expect(result.degraded).toBe(false);
  });

  it('retries a transient failure and then succeeds', async () => {
    let attempts = 0;
    const stub = provider(() => { attempts++; if (attempts === 1) throw new Error('503 service unavailable'); return '# Notes'; });
    const config = { ...LLM_CONFIG, performance: { timeoutMs: 1000, maxRetries: 2, retryBaseDelayMs: 1, circuitBreakerThreshold: 5, fallbackProviders: [], semanticCacheTTLMs: 0 } };
    const result = await new NoteSynthesizer(stub, config, logger).synthesize(input(), { privacy: 'cloud-opt-in' });
    expect(attempts).toBe(2);
    expect(result.degraded).toBe(false);
  });

  it('falls back after retry exhaustion', async () => {
    let attempts = 0;
    const stub = provider(() => { attempts++; throw new Error('503 unavailable'); });
    const config = { ...LLM_CONFIG, performance: { timeoutMs: 1000, maxRetries: 1, retryBaseDelayMs: 1, circuitBreakerThreshold: 5, fallbackProviders: [], semanticCacheTTLMs: 0 } };
    const result = await new NoteSynthesizer(stub, config, logger).synthesize(input(), { privacy: 'cloud-opt-in' });
    expect(attempts).toBe(2);
    expect(result.degraded).toBe(true);
  });
});

describe('LLMNoteValidator', () => {
  const findings = {
    missingTranscript: [],
    missingOcr: [],
    corrections: [{
      instructorSaid: 'Python 2',
      actually: 'Python 3',
      basisQuote: 'Python 3',
      basisSource: 'ocr' as const,
      timestamp: frameAt('f1', 5000).timestamp.toISO(),
    }],
    incomplete: [],
    degraded: false,
  };

  it('parses structured findings and filters an unverified basis', async () => {
    let structured = 0;
    const stub = {
      completeStructured: async () => { structured++; return findings; },
      getModelInfo: () => ({ provider: 'test', model: 'test', maxContextTokens: 8192, supportsStreaming: false, supportsStructuredOutput: true, supportsCitations: false }),
    } as unknown as ILLMProvider;
    const validator = new LLMNoteValidator(stub, LLM_CONFIG, logger, 'cloud-opt-in');
    const result = await validator.validate({
      notes: 'notes', transcript: transcript([segment('s1', 0, 'we use Python 2')]),
      frames: [frameAt('f1', 5000, 'Python 3 indexing')],
      screenshots: new Map(), language: 'en',
    });
    expect(structured).toBe(1);
    expect(result.corrections).toHaveLength(1);
    expect(result.degraded).toBe(false);
  });

  it('degrades on a non-abort failure and rethrows on abort', async () => {
    const failing = { completeStructured: async () => { throw new Error('offline'); } } as unknown as ILLMProvider;
    const validator = new LLMNoteValidator(failing, LLM_CONFIG, logger, 'cloud-opt-in');
    const base = { notes: 'n', transcript: transcript([]), frames: [], screenshots: new Map(), language: 'en' };
    expect((await validator.validate(base)).degraded).toBe(true);

    const controller = new AbortController();
    controller.abort();
    await expect(validator.validate(base, { signal: controller.signal })).rejects.toThrow();
  });
});
