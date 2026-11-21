import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { registerGetNoteTool } from '../../../src/plugin/tools/getNote.js';
import { registerAnalyzeVideoTool } from '../../../src/plugin/tools/analyzeVideo.js';

function capture(register: (ctx: Context, runtime: unknown) => () => void, runtime: unknown): any {
  let captured: any;
  const ctx = { tools: { register: (tool: any) => { captured = tool; return () => undefined; } } } as unknown as Context;
  register(ctx, runtime);
  return captured;
}

describe('VAD and multilingual tool surface (behavioural)', () => {
  it('renders all three artifact paths and the VAD/ffmpeg highlight on completion', async () => {
    const tool = capture(registerGetNoteTool, {
      jobs: {
        get: () => ({
          jobId: 'j1', status: 'completed', percent: 100, stage: 'done',
          videoPath: 'v.mp4', elapsedMs: 10,
          notePath: 'out/sample_notes.md', transcriptPath: 'out/sample_transcript.md',
          ocrPath: 'out/sample_ocr.md', note: '# Notes',
          warnings: 'VAD_EMPTY_TRANSCRIPT: audio present but no speech',
        }),
      },
    });
    const value = await tool.execute({ jobId: 'j1' });
    const rendered = tool.output.render({}, value);
    const text = rendered.map((part: { text: string }) => part.text).join('\n');
    expect(text).toContain('sample_notes.md');
    expect(text).toContain('sample_transcript.md');
    expect(text).toContain('sample_ocr.md');
    expect(text).toContain('vad off');
    expect(text).toContain('afftdn=nf=-20');
  });

  it('passes vad and language options to the job registry', async () => {
    const started: any[] = [];
    const tool = capture(registerAnalyzeVideoTool, { jobs: { start: (input: any) => { started.push(input); return 'j1'; } } });
    expect(tool.name).toBe('analyze_video');
    expect(tool.description).toContain('vad off');
    expect(tool.description).toContain('Hinglish');
    await tool.execute({
      videoPath: 'C:\\Users\\ruchi\\AppData\\Local\\Temp\\opencode\\vtn-e2e2\\sample.mp4',
      vadEnabled: false, language: 'hinglish', multilingual: true,
    });
    expect(started[0].vadEnabled).toBe(false);
    expect(started[0].language).toBe('hinglish');
    expect(started[0].multilingual).toBe(true);
  });
});
