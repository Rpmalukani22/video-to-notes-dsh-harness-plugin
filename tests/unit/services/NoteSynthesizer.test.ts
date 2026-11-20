import { describe, it, expect } from 'vitest';
import { NoteSynthesizer } from '../../../src/application/services/NoteSynthesizer.js';
import { NoteSection } from '../../../src/domain/entities/Note.js';
import { Timestamp } from '../../../src/domain/value-objects/Timestamp.js';
import { Frame } from '../../../src/domain/entities/Frame.js';
import { Video } from '../../../src/domain/entities/Video.js';
import { Transcript } from '../../../src/domain/entities/Transcript.js';
import { ConsoleLogger } from '../../../src/infrastructure/adapters/ConsoleLogger.js';
import { ILLMProvider, LLMRequest, LLMResponse } from '../../../src/application/ports/Interfaces.js';

describe('NoteSynthesizer', () => {
  const logger = new ConsoleLogger('error');

  const emptyVideo = new Video(
    'v1',
    '/videos/lecture.mp4',
    {
      duration: Timestamp.fromSeconds(60),
      width: 1920,
      height: 1080,
      fps: { num: 30, den: 1 },
      codec: 'h264',
      bitrate: 2000,
      format: 'mp4',
      size: 10000,
      chapters: [],
      subtitleTracks: [],
      audioTracks: [],
      isVFR: false,
    },
    'completed'
  );

  const sampleSection: NoteSection = {
    id: 'sec-1',
    title: 'Introduction to Architecture',
    level: 2,
    timestamp: Timestamp.fromSeconds(10),
    content: '**Visual Content:**\nHexagonal Architecture\nDomain Driven Design\n\n**Transcript:**\nWelcome everyone. Today we are talking about clean boundaries.',
    subsections: [],
    citations: [],
    metadata: {},
  };

  it('synthesizes extractively when provider is none, embedding screenshots', async () => {
    const synthesizer = new NoteSynthesizer(null, { provider: 'none', temperature: 0.2, maxTokens: 1000, topP: 0.9 }, logger);

    const frame = new Frame('f1', 'v1', Timestamp.fromSeconds(10), 10000);
    const keyFramePaths = new Map<string, string>([['f1', 'lecture_frames/frame_01.jpg']]);

    const result = await synthesizer.synthesize({
      video: emptyVideo,
      transcript: new Transcript('v1', [], 'en', 'base', 0),
      frames: [frame],
      scenes: [],
      alignedBlocks: [],
      keyFramePaths,
      sections: [sampleSection],
    });

    expect(result.sections).toHaveLength(1);
    const content = result.sections[0]!.content;
    expect(content).toContain('![Key Slide / Scene](lecture_frames/frame_01.jpg)');
    expect(content).toContain('### Key Visual Points (On-Screen)');
    expect(content).toContain('Hexagonal Architecture');
    expect(content).toContain('### Explanation & Discussion');
  });

  it('performs LLM synthesis and extracts concept validation callouts', async () => {
    const mockLlm: ILLMProvider = {
      async complete(_req: LLMRequest): Promise<LLMResponse> {
        return {
          content:
            '# Clean Boundaries in Software\n\n' +
            '- Hexagonal architecture decouples core business logic from infrastructure.\n' +
            '- Domain-driven design establishes ubiquitous language.\n\n' +
            '> ⚠️ **Clarification / Correction:** Instructor said "hexagonal architecture was invented in 1995", however Alistair Cockburn created it in 2005.\n\n' +
            'This separation ensures long-term maintainability.',
          usage: { promptTokens: 50, completionTokens: 60, totalTokens: 110 },
          model: 'mock-llm',
          finishReason: 'stop',
        };
      },
      completeStream: () => { throw new Error(); },
      completeStructured: () => { throw new Error(); },
      completeWithContextStream: () => { throw new Error(); },
      getModelInfo: () => ({ provider: 'mock', model: 'mock', maxContextTokens: 4096, supportsStreaming: false, supportsStructuredOutput: false, supportsCitations: false }),
      listAvailableModels: async () => ['mock'],
      healthCheck: async () => ({ healthy: true, checkedAt: new Date() }),
      getCapabilities: () => ({} as any),
    };

    const synthesizer = new NoteSynthesizer(mockLlm, { provider: 'deepseek', temperature: 0.2, maxTokens: 1000, topP: 0.9 }, logger);

    const frame = new Frame('f1', 'v1', Timestamp.fromSeconds(10), 10000);
    const keyFramePaths = new Map<string, string>([['f1', 'lecture_frames/frame_01.jpg']]);

    const result = await synthesizer.synthesize({
      video: emptyVideo,
      transcript: new Transcript('v1', [], 'en', 'base', 0),
      frames: [frame],
      scenes: [],
      alignedBlocks: [],
      keyFramePaths,
      sections: [sampleSection],
    });

    expect(result.sections).toHaveLength(1);
    const sec = result.sections[0]!;
    expect(sec.content).toContain('![Key Slide / Scene](lecture_frames/frame_01.jpg)');
    expect(sec.content).toContain('> ⚠️ **Clarification / Correction:**');
    expect(result.validations).toHaveLength(1);
    expect(result.validations[0]!.instructorSaid).toContain('hexagonal architecture was invented in 1995');
    expect(result.validations[0]!.actualFact).toContain('Alistair Cockburn created it in 2005');
  });
});
