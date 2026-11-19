import type { Context } from '@deepseek-ai/cordis';

import { createServices, Services } from '../infrastructure/composition/createServices.js';
import { createHarnessBridge, DshLlmLike } from '../infrastructure/adapters/HarnessLLMProvider.js';
import { JobRegistry } from './service/VideoNotesService.js';
import { PluginRuntime } from './runtime.js';
import { PluginConfig, normalizeLogLevel } from './config.js';
import { registerAnalyzeVideoTool } from './tools/analyzeVideo.js';
import { registerGetNoteTool } from './tools/getNote.js';
import { registerDoctorTool } from './tools/doctor.js';

/**
 * Video-to-Notes - a DeepSeek Harness bundle.
 *
 * The plugin is a thin adapter: all real work happens in the application and
 * infrastructure layers, which know nothing about the harness. That keeps the
 * pipeline testable without a harness process.
 */
export const name = 'video-to-notes';

/**
 * `tools` is the only hard dependency. The harness `llm` service is read
 * optionally through `ctx.reflect`, so the plugin also works in a profile that
 * has no model configured (it then falls back to offline extractive summaries).
 */
export const inject = ['tools'];

export { Config } from './config.js';
export type { PluginConfig } from './config.js';

export async function apply(ctx: Context, config: PluginConfig): Promise<void> {
  const runtime = createRuntime(ctx, config);

  const disposers = [
    registerAnalyzeVideoTool(ctx, runtime),
    registerGetNoteTool(ctx, runtime),
    registerDoctorTool(ctx, runtime),
  ];

  ctx.effect(() => () => {
    for (const dispose of disposers) dispose();
    runtime.jobs.dispose();
    runtime.dispose();
  });
}

interface MutableRuntime extends PluginRuntime {
  dispose(): void;
}

/**
 * Services are built on first use: loading a profile must not spawn ffmpeg or
 * read the filesystem. `JobRegistry` is created eagerly because it is just a
 * queue, and it is the piece the tools need synchronously.
 */
function createRuntime(ctx: Context, config: PluginConfig): MutableRuntime {
  let services: Services | undefined;

  const getServices = (): Services => {
    if (services === undefined) {
      const harnessBridge = readHarnessBridge(ctx);
      const overrides = harnessBridge === null ? undefined : { provider: 'harness' as const };

      services = createServices({
        outputDir: config.outputDir,
        configPath: config.configPath.trim().length > 0 ? config.configPath : undefined,
        ffmpegPath: config.ffmpegPath,
        ffprobePath: config.ffprobePath,
        tesseractPath: config.tesseractPath,
        whisperPath: config.whisperPath,
        whisperModelDir: config.whisperModelDir,
        logLevel: normalizeLogLevel(config.logLevel),
        harnessBridge,
        ...(overrides !== undefined ? { llm: overrides } : {}),
      });
    }
    return services;
  };

  const jobs = new JobRegistry(getServices, config.maxConcurrent);

  return {
    services: getServices,
    jobs,
    dispose(): void {
      services?.dispose();
      services = undefined;
    },
  };
}

/**
 * The harness LLM service is typed in `@deepseek-ai/dsh-llm`, which is not a
 * dependency of this package. Read it structurally and verify the shape before
 * handing it to the adapter, so a different service cannot be mistaken for it.
 */
function readHarnessBridge(ctx: Context): ReturnType<typeof createHarnessBridge> | null {
  const candidate: unknown = ctx.reflect.get('llm');
  return isLlmService(candidate) ? createHarnessBridge(candidate) : null;
}

function isLlmService(value: unknown): value is DshLlmLike {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['listProviders'] === 'function' &&
    typeof record['listModels'] === 'function' &&
    typeof record['stream'] === 'function'
  );
}
