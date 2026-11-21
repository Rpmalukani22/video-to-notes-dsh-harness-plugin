import { describe, expect, it } from 'vitest';
import { NoteSynthesizer } from '../../../src/application/services/NoteSynthesizer.js';
import { ConsoleLogger } from '../../../src/infrastructure/adapters/ConsoleLogger.js';
import type { ILLMProvider, LLMConfig, NoteValidationResult } from '../../../src/application/ports/Interfaces.js';
import { frameAt, segment, transcript, video } from '../../helpers/fixtures.js';
import type { NoteSection } from '../../../src/domain/entities/Note.js';
import { Timestamp } from '../../../src/domain/value-objects/Timestamp.js';

const config: LLMConfig = { provider: 'deepseek', temperature: 0.2, maxTokens: 2048, topP: 0.9 };
const findings: NoteValidationResult = {
  missingTranscript: [], missingOcr: [], corrections: [], incomplete: [], degraded: false,
};
const sections: NoteSection[] = [{
  id: 's1', title: 'Notes', level: 2, timestamp: Timestamp.fromMilliseconds(5000),
  content: '![Key slide](frames/a.jpg)\n\noriginal notes',
  subsections: [], citations: [], metadata: {},
}];
const input = {
  video: video(), transcript: transcript([segment('s1', 0, 'hello')]),
  frames: [frameAt('f1', 5000, 'slide')], scenes: [], alignedBlocks: [],
  keyFramePaths: new Map([['f1', 'frames/a.jpg']]), sections,
};

function provider(content: string): ILLMProvider {
  return {
    complete: async () => ({
      content, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      model: 'test', finishReason: 'stop' as const,
    }),
    getModelInfo: () => ({
      provider: 'test', model: 'test', maxContextTokens: 8192,
      supportsStreaming: false, supportsStructuredOutput: true, supportsCitations: false,
    }),
  } as unknown as ILLMProvider;
}

describe('Validation repair (plan path)', () => {
  it('preserves screenshot embeds through a successful repair', async () => {
    const result = await new NoteSynthesizer(provider('revised prose'), config, new ConsoleLogger('error'))
      .revise(sections, findings, input, { privacy: 'cloud-opt-in' });
    expect(result[0]!.content).toContain('![Key slide](frames/a.jpg)');
    expect(result[0]!.content).toContain('revised prose');
  });

  it('returns sections unchanged when validation is degraded', async () => {
    const result = await new NoteSynthesizer(provider('revised'), config, new ConsoleLogger('error'))
      .revise(sections, { ...findings, degraded: true }, input, { privacy: 'cloud-opt-in' });
    expect(result).toBe(sections);
  });

  it('rethrows on abort', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new NoteSynthesizer(provider('revised'), config, new ConsoleLogger('error'))
        .revise(sections, findings, input, { privacy: 'cloud-opt-in', signal: controller.signal })
    ).rejects.toThrow();
  });
});
