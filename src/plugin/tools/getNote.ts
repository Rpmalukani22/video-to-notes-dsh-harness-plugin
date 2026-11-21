import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { PluginRuntime } from '../runtime.js';
import type { JobView } from '../service/VideoNotesService.js';

/**
 * Reports progress for an `analyze_video` job. With `wait: "true"` it blocks
 * until the job settles (or the timeout expires), so the harness does not have
 * to poll in a loop. When completed, the note itself is returned.
 */
export function registerGetNoteTool(ctx: Context, runtime: PluginRuntime): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'video_note_status',
      description:
        'Report progress for an analyze_video job. Pass wait: "true" and a timeout_ms to block ' +
        'until the job is completed or failed. When completed it returns the Markdown note and ' +
        'the paths to all three generated files. Without wait it returns the current status only.',
      parameters: {
        jobId: {
          type: 'string',
          required: true,
          description: 'Job id returned by analyze_video.',
        },
        wait: {
          type: 'string',
          description: 'Use "true" to wait for the job to finish before returning. Defaults to "false".',
        },
        timeout_ms: {
          type: 'string',
          description: 'Maximum time to wait in milliseconds when wait is true (e.g. "600000").',
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
            transcriptPath: { type: 'string' },
            ocrPath: { type: 'string' },
            framesDir: { type: 'string' },
            note: { type: 'string' },
            warnings: { type: 'string' },
            error: { type: 'string' },
            timedOut: { type: 'boolean' },
          },
        },
        render: (_args, value) => {
          const status = field(value, 'status');
          if (status === 'completed') {
            const note = field(value, 'note');
            const notePath = field(value, 'notePath');
            const transcriptPath = field(value, 'transcriptPath');
            const ocrPath = field(value, 'ocrPath');
            const framesDir = field(value, 'framesDir');
            const warnings = field(value, 'warnings');

            let banner =
              `### 🎬 Video Processing Complete!\n\n` +
              `**Outputs generated:**\n` +
              `1. 📝 **Synthesized Notes (with Screenshots):** \`${notePath}\`\n` +
              `2. 📋 **Full Transcript:** \`${transcriptPath}\`\n` +
              `3. 🔍 **On-Screen OCR Text:** \`${ocrPath}\`\n${
                framesDir ? `📸 **Screenshots Directory:** \`${framesDir}\`\n\n` : '\n'
              }`;

            if (warnings.includes('VAD_EMPTY_TRANSCRIPT')) {
              banner +=
                '> ⚠️ **Speech Detection Warning:** Audio was detected, but the transcript is empty or partial.\n' +
                '> Background noise (fan/AC) may have caused VAD to strip speech.\n' +
                '> Suggested fix 1: re-run with `vadEnabled: false` (or say "vad off").\n' +
                '> Suggested fix 2: re-run with `enhanceAudio: true` — ffmpeg filter: ' +
                'highpass=f=100,lowpass=f=7500,afftdn=nf=-20,acompressor=threshold=-20dB:ratio=4:attack=5:release=50,loudnorm\n\n';
            }

            banner += `---\n\n${note}`;
            return [{ type: 'text', text: banner }];
          }
          if (status === 'failed') {
            return [{ type: 'text', text: `Job failed: ${field(value, 'error')}` }];
          }
          const percent = field(value, 'percent');
          const stage = field(value, 'stage');
          const suffix = value !== null && typeof value === 'object' && (value as { timedOut?: boolean }).timedOut
            ? ' (wait timed out; job still running)'
            : '';
          return [
            {
              type: 'text',
              text:
                `${field(value, 'jobId')}: ${status}${percent.length > 0 ? ` (${percent}%)` : ''}` +
                `${stage.length > 0 ? ` - ${stage}` : ''}${suffix}`,
            },
          ];
        },
      },
      async execute(args) {
        const jobId = args.jobId;
        const initial = runtime.jobs.get(jobId);
        if (initial === null) {
          throw new Error(
            `Unknown job id "${jobId}". Call analyze_video first and use the returned job id.`
          );
        }

        const shouldWait = String(args.wait ?? '').toLowerCase() === 'true';
        let timedOut = false;
        let job: JobView | null = initial;

        if (shouldWait) {
          const timeoutMs = parseTimeout(args.timeout_ms);
          const settled = await runtime.jobs.wait(jobId, timeoutMs);
          if (settled !== null && settled.status !== 'queued' && settled.status !== 'running') {
            return toResult(settled, false);
          }
          job = runtime.jobs.get(jobId);
          timedOut = true;
        }

        if (job === null) {
          throw new Error(`Job "${jobId}" disappeared while waiting.`);
        }
        return toResult(job, timedOut);
      },
    })
  );
}

const DEFAULT_WAIT_MS = 600000;
const MAX_WAIT_MS = 3600000;

function parseTimeout(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_WAIT_MS;
  return Math.min(value, MAX_WAIT_MS);
}

interface StatusResult {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  percent: number;
  stage: string;
  videoPath: string;
  elapsedMs: number;
  notePath?: string;
  transcriptPath?: string;
  ocrPath?: string;
  framesDir?: string;
  note?: string;
  warnings: string;
  error?: string;
  timedOut?: boolean;
}

function toResult(job: JobView, timedOut: boolean): StatusResult {
  return {
    jobId: job.jobId,
    status: job.status,
    percent: Math.round(job.percent),
    stage: job.stage,
    videoPath: job.videoPath,
    elapsedMs: job.elapsedMs,
    ...(job.notePath !== undefined ? { notePath: job.notePath } : {}),
    ...(job.transcriptPath !== undefined ? { transcriptPath: job.transcriptPath } : {}),
    ...(job.ocrPath !== undefined ? { ocrPath: job.ocrPath } : {}),
    ...(job.framesDir !== undefined ? { framesDir: job.framesDir } : {}),
    ...(job.note !== undefined ? { note: job.note } : {}),
    warnings: job.warnings,
    ...(job.error !== undefined ? { error: job.error } : {}),
    ...(timedOut ? { timedOut: true } : {}),
  };
}

function field(value: unknown, key: string): string {
  if (typeof value === 'object' && value !== null) {
    const entry = (value as Record<string, unknown>)[key];
    if (typeof entry === 'string') return entry;
    if (typeof entry === 'number') return String(entry);
  }
  return '';
}
