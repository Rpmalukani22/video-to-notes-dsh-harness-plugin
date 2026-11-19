import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { PluginRuntime } from '../runtime.js';

/**
 * Reports progress for an `analyze_video` job. When the job has finished the
 * note itself is returned so the model can reason over it without another
 * filesystem round-trip.
 */
export function registerGetNoteTool(ctx: Context, runtime: PluginRuntime): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'video_note_status',
      description:
        'Report progress for an analyze_video job. When the job is completed it returns ' +
        'the Markdown note plus the path on disk; when it failed it returns the error.',
      parameters: {
        jobId: {
          type: 'string',
          required: true,
          description: 'Job id returned by analyze_video.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            jobId: { type: 'string', required: true },
            status: {
              type: 'string',
              enum: ['queued', 'running', 'completed', 'failed'],
              required: true,
            },
            percent: { type: 'integer' },
            stage: { type: 'string' },
            videoPath: { type: 'string' },
            elapsedMs: { type: 'integer' },
            notePath: { type: 'string' },
            note: { type: 'string' },
            warnings: { type: 'string' },
            error: { type: 'string' },
          },
        },
        render: (_args, value) => {
          const status = field(value, 'status');
          if (status === 'completed') {
            const note = field(value, 'note');
            const path = field(value, 'notePath');
            return [{ type: 'text', text: note.length > 0 ? note : `Note written to ${path}` }];
          }
          if (status === 'failed') {
            return [{ type: 'text', text: `Job failed: ${field(value, 'error')}` }];
          }
          const percent = field(value, 'percent');
          const stage = field(value, 'stage');
          return [
            {
              type: 'text',
              text: `${field(value, 'jobId')}: ${status}${percent.length > 0 ? ` (${percent}%)` : ''}` +
                `${stage.length > 0 ? ` - ${stage}` : ''}`,
            },
          ];
        },
      },
      async execute(args) {
        const job = runtime.jobs.get(args.jobId);
        if (job === null) {
          throw new Error(
            `Unknown job id "${args.jobId}". Call analyze_video first and use the returned job id.`
          );
        }

        return {
          jobId: job.jobId,
          status: job.status,
          percent: Math.round(job.percent),
          stage: job.stage,
          videoPath: job.videoPath,
          elapsedMs: job.elapsedMs,
          ...(job.notePath !== undefined ? { notePath: job.notePath } : {}),
          ...(job.note !== undefined ? { note: job.note } : {}),
          warnings: job.warnings,
          ...(job.error !== undefined ? { error: job.error } : {}),
        };
      },
    })
  );
}

function field(value: unknown, key: string): string {
  if (typeof value === 'object' && value !== null) {
    const entry = (value as Record<string, unknown>)[key];
    if (typeof entry === 'string') return entry;
    if (typeof entry === 'number') return String(entry);
  }
  return '';
}
