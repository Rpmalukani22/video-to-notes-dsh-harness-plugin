import { describe, expect, it } from 'vitest';
import { NoteSynthesizer } from '../../src/application/services/NoteSynthesizer.js';
import { ConsoleLogger } from '../../src/infrastructure/adapters/ConsoleLogger.js';
import type { ILLMProvider, LLMConfig, SynthesisInput } from '../../src/application/ports/Interfaces.js';
import { frameAt, segment, transcript, video } from '../helpers/fixtures.js';

const config: LLMConfig = { provider: 'deepseek', temperature: 0.2, maxTokens: 2048, topP: 0.9 };
const provider = {
  complete: async () => ({
    content: '**notes**', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'stub', finishReason: 'stop' as const,
  }),
  getModelInfo: () => ({
    provider: 'stub', model: 'stub', maxContextTokens: 8192,
    supportsStreaming: false, supportsStructuredOutput: true, supportsCitations: false,
  }),
} as unknown as ILLMProvider;

describe('Embedded screenshots E2E (plan path)', () => {
  it('writes distinct first and last screenshot links into the final notes', async () => {
    const frames = Array.from({ length: 20 }, (_, i) => frameAt(`f${i}`, i * 180000, `slide ${i}`));
    const input: SynthesisInput = {
      video: video(), transcript: transcript([segment('s1', 0, 'welcome')]),
      frames, scenes: [], alignedBlocks: [],
      keyFramePaths: new Map(frames.map(frame => [frame.id, `vtn_frames/${frame.id}.jpg`])),
      sections: [{ id: 's1', title: 'Notes', level: 2, timestamp: null, content: 'old', subsections: [], citations: [], metadata: {} }],
    };
    const result = await new NoteSynthesizer(provider, config, new ConsoleLogger('error'))
      .synthesize(input, { privacy: 'cloud-opt-in' });
    const embeds = [...result.sections[0]!.content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]!);
    expect(new Set(embeds).size).toBe(embeds.length);
    expect(embeds[0]).toContain('f0.jpg');
    expect(embeds.at(-1)).toContain('f19.jpg');
  });
});
