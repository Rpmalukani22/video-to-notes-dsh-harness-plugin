import type { Context } from '@deepseek-ai/cordis';
import { registerGetNoteTool } from '../../src/plugin/tools/getNote.js';

export function captureStatus(): any {
  let tool: any;
  const ctx = {
    tools: {
      register: (definition: any) => {
        tool = definition;
        return () => undefined;
      },
    },
  } as unknown as Context;
  registerGetNoteTool(ctx, {
    jobs: {
      get: () => ({
        jobId: 'j1',
        status: 'completed',
        percent: 100,
        stage: 'done',
        videoPath: 'v.mp4',
        elapsedMs: 10,
        notePath: 'out/sample_notes.md',
        transcriptPath: 'out/sample_transcript.md',
        ocrPath: 'out/sample_ocr.md',
        note: '# Notes',
        warnings: 'VAD_EMPTY_TRANSCRIPT: audio present but no speech',
      }),
    },
  });
  return tool;
}
