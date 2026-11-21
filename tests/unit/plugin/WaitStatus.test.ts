import { describe, expect, it } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { registerGetNoteTool } from '../../../src/plugin/tools/getNote.js';
import type { JobView } from '../../../src/plugin/service/VideoNotesService.js';

const running: JobView = {
  jobId: 'j1', status: 'running', percent: 34, stage: 'transcription',
  videoPath: 'v.mp4', elapsedMs: 1000, warnings: '',
};
const completed: JobView = {
  ...running, status: 'completed', percent: 100, stage: 'done',
  notePath: 'out/a_notes.md', note: '# Notes',
};

function capture(wait: (id: string, ms: number) => Promise<JobView | null>) {
  let tool: any;
  const ctx = {
    tools: {
      register: (definition: any) => {
        tool = definition;
        return () => undefined;
      },
    },
  } as unknown as Context;
  registerGetNoteTool(ctx, { jobs: { get: () => running, wait } });
  return tool;
}

describe('video_note_status wait support', () => {
  it('blocks until the registry reports completion', async () => {
    const calls: number[] = [];
    const tool = capture(async (_id, ms) => { calls.push(ms); return completed; });
    const result = await tool.execute({ jobId: 'j1', wait: 'true', timeout_ms: '5000000' });
    expect(calls).toEqual([3600000]); // clamped to the maximum
    expect(result.status).toBe('completed');
    expect(result.notePath).toBe('out/a_notes.md');
  });

  it('reports a timed-out wait without claiming success', async () => {
    const tool = capture(async () => null);
    const result = await tool.execute({ jobId: 'j1', wait: 'true', timeout_ms: '1000' });
    expect(result.status).toBe('running');
    expect(result.timedOut).toBe(true);
    expect(result.note).toBeUndefined();
  });
});
