import { describe, expect, it } from 'vitest';
import { NoteSynthesizer } from '../../../src/application/services/NoteSynthesizer.js';
import { ConsoleLogger } from '../../../src/infrastructure/adapters/ConsoleLogger.js';
import type { ILLMProvider, LLMConfig, SynthesisInput } from '../../../src/application/ports/Interfaces.js';
import { frameAt, segment, transcript, video } from '../../helpers/fixtures.js';

const config: LLMConfig = { provider: 'deepseek', temperature: 0.2, maxTokens: 2048, topP: 0.9 };
const provider = {
  complete: async () => ({
    content: '**indexed** notes', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'test', finishReason: 'stop' as const,
  }),
  getModelInfo: () => ({
    provider: 'test', model: 'test', maxContextTokens: 8192,
    supportsStreaming: false, supportsStructuredOutput: true, supportsCitations: false,
  }),
} as unknown as ILLMProvider;

describe('Embedded screenshot spread (plan path)', () => {
  it('embeds distinct screenshots from the beginning and end of the video', async () => {
    const frames = Array.from({ length: 24 }, (_, i) => frameAt(`f${i}`, i * 150000, `slide ${i}`));
    const paths = new Map(frames.map(f => [f.id, `frames/${f.id}.jpg`]));
    const input: SynthesisInput = {
      video: video(), transcript: transcript([segment('s1', 0, 'welcome')]),
      frames, scenes: [], alignedBlocks: [], keyFramePaths: paths,
      sections: [{ id: 's1', title: 'Notes', level: 2, timestamp: null, content: 'old', subsections: [], citations: [], metadata: {} }],
    };
    const result = await new NoteSynthesizer(provider, config, new ConsoleLogger('error'))
      .synthesize(input, { privacy: 'cloud-opt-in' });
    const embeds = [...result.sections[0]!.content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]!);
    expect(embeds.length).toBeGreaterThan(1);
    expect(new Set(embeds).size).toBe(embeds.length);
    expect(embeds[0]).toContain('f0.jpg');
    expect(embeds.at(-1)).toContain('f23.jpg');
  });
});
