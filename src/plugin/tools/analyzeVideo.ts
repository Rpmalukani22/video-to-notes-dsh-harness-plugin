import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { PluginRuntime } from '../runtime.js';
import { assertAbsoluteDir, assertReadableVideo } from './paths.js';

const PRESETS: readonly string[] = ['lecture', 'tutorial', 'meeting', 'documentary'];

/**
 * Analysis takes minutes, so the tool returns a job id immediately and
 * `video_note_status` reports progress. A synchronous tool would block the
 * model loop and risk the harness call timeout.
 */
export function registerAnalyzeVideoTool(ctx: Context, runtime: PluginRuntime): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'analyze_video',
      description:
        'Convert a local video file into structured Markdown notes with timestamps, ' +
        'on-screen text (OCR) and a transcript. Returns immediately with a job id; ' +
        'poll video_note_status for progress and the note path.',
      parameters: {
        videoPath: {
          type: 'string',
          required: true,
          description: 'Absolute path to a local video file (.mp4, .mkv, .mov, .webm, ...).',
        },
        preset: {
          type: 'string',
          enum: PRESETS,
          description: 'Tuning preset: lecture (default focus), tutorial, meeting, documentary.',
        },
        outputDir: {
          type: 'string',
          description: 'Absolute directory for the generated note. Defaults to the plugin outputDir.',
        },
        formats: {
          type: 'string',
          description: 'Comma-separated output formats: md, json, html. Defaults to md.',
        },
        vadEnabled: {
          type: 'boolean',
          description: 'Enable Voice Activity Detection (VAD). Defaults to true. Set to false if background noise or fans are cutting off speech.',
        },
        enhanceAudio: {
          type: 'boolean',
          description: 'Apply FFmpeg noise reduction and dynamic normalization before speech recognition. Useful when background fan/noise is audible.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            jobId: { type: 'string', required: true },
            status: { type: 'string', enum: ['accepted'], required: true },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `Started job ${field(value, 'jobId')}. Poll video_note_status with that id for progress.`,
          },
        ],
      },
      async execute(args) {
        const videoPath = await assertReadableVideo(args.videoPath);
        const outputDir =
          args.outputDir !== undefined && args.outputDir.trim().length > 0
            ? assertAbsoluteDir(args.outputDir, 'outputDir')
            : undefined;
        const formats = parseFormats(args.formats);
        const vadEnabled = args.vadEnabled !== undefined ? Boolean(args.vadEnabled) : undefined;
        const enhanceAudio = args.enhanceAudio !== undefined ? Boolean(args.enhanceAudio) : undefined;

        const jobId = runtime.jobs.start({
          videoPath,
          preset: args.preset ?? 'lecture',
          ...(outputDir !== undefined ? { outputDir } : {}),
          ...(formats !== undefined ? { formats } : {}),
          ...(vadEnabled !== undefined ? { vadEnabled } : {}),
          ...(enhanceAudio !== undefined ? { enhanceAudio } : {}),
        });

        return { jobId, status: 'accepted' as const };
      },
    })
  );
}

function parseFormats(raw: string | undefined): ('md' | 'json' | 'html')[] | undefined {
  if (raw === undefined || raw.trim().length === 0) return undefined;

  const parsed: ('md' | 'json' | 'html')[] = [];
  for (const part of raw.split(',')) {
    const value = part.trim().toLowerCase();
    if (value === 'md' || value === 'json' || value === 'html') {
      if (!parsed.includes(value)) parsed.push(value);
      continue;
    }
    throw new Error(`Unknown format "${value}". Use md, json, or html.`);
  }
  return parsed.length > 0 ? parsed : undefined;
}

function field(value: unknown, key: string): string {
  if (typeof value === 'object' && value !== null) {
    const entry = (value as Record<string, unknown>)[key];
    if (typeof entry === 'string') return entry;
  }
  return '';
}
