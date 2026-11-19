import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { PluginRuntime } from '../runtime.js';

/**
 * Environment check. Missing optional tools (Tesseract, Whisper, PySceneDetect)
 * degrade the pipeline rather than break it, so this tool explains exactly what
 * a given machine will and will not produce.
 */
export function registerDoctorTool(ctx: Context, runtime: PluginRuntime): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'video_notes_doctor',
      description:
        'Check whether ffmpeg, ffprobe, Tesseract, whisper-cli and scenedetect are available, ' +
        'and report which LLM provider the plugin will use. Run this before analyzing a video.',
      parameters: {
        verbose: {
          type: 'boolean',
          description: 'Include the detected version line for each tool.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            report: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: field(value, 'report') }],
      },
      async execute(args) {
        const report = await runtime.services().doctor();
        const verbose = args.verbose === true;

        const lines: string[] = [
          `ffmpeg/ffprobe: ${report.ok ? 'ok' : 'MISSING (required)'}`,
          `node: ${report.node}`,
          `llm: ${report.llmProvider} (${report.llmDetail})`,
          '',
          'tools:',
        ];

        for (const tool of report.tools) {
          const state = tool.available ? 'ok' : 'missing';
          const version = verbose && tool.version !== null ? ` - ${tool.version}` : '';
          const error = !tool.available && tool.error !== null ? ` (${tool.error})` : '';
          lines.push(`  ${tool.name.padEnd(12)} ${state}${version}${error}`);
        }

        if (!report.ok) {
          lines.push('', 'Install ffmpeg and make sure ffmpeg/ffprobe are on PATH.');
        }

        return { ok: report.ok, report: lines.join('\n') };
      },
    })
  );
}

function field(value: unknown, key: string): string {
  if (typeof value === 'object' && value !== null) {
    const entry = (value as Record<string, unknown>)[key];
    if (typeof entry === 'string') return entry;
  }
  return '';
}
