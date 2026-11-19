#!/usr/bin/env node
import { Command } from 'commander';
import { resolve, dirname, extname, join } from 'path';

import { createServices } from './infrastructure/composition/createServices.js';
import { ConsoleLogger } from './infrastructure/adapters/ConsoleLogger.js';
import { BatchProgressUpdate } from './application/use-cases/BatchProcess.js';
import { ProgressUpdate } from './application/use-cases/AnalyzeVideo.js';
import { ProcessingConfig } from './application/ports/Interfaces.js';

/**
 * `vtn` - command line front end.
 *
 * The CLI and the harness plugin share the same composition root, so a bug
 * reproduced here reproduces inside the harness as well.
 */

const FORMATS = ['md', 'json', 'html'] as const;
type Format = (typeof FORMATS)[number];

interface GlobalOptions {
  output: string;
  logLevel: string;
  config?: string | undefined;
  ffmpeg?: string | undefined;
}

const program = new Command();

program
  .name('vtn')
  .description('Turn videos into structured Markdown notes (ffmpeg + Whisper + Tesseract).')
  .version('0.1.0')
  .option('-o, --output <dir>', 'directory for generated notes', './notes')
  .option('--log-level <level>', 'debug | info | warn | error', 'info')
  .option('--config <file>', 'YAML config layered over the defaults')
  .option('--ffmpeg <path>', 'ffmpeg/ffprobe executable path');

program
  .command('analyze')
  .description('Analyse one video and write notes')
  .argument('<video>', 'path to a video file')
  .option('-p, --preset <name>', 'lecture | tutorial | meeting | documentary', 'lecture')
  .option('-f, --format <list>', 'comma separated: md, json, html', 'md')
  .option('--json', 'print the result as JSON')
  .action(async (video: string, options: { preset: string; format: string; json?: boolean }) => {
    const global = program.opts<GlobalOptions>();
    const formats = parseFormats(options.format);

    const services = createServices({
      outputDir: global.output,
      configPath: global.config,
      ffmpegPath: global.ffmpeg,
      ffprobePath: global.ffmpeg === undefined ? undefined : deriveFfprobe(global.ffmpeg),
      logLevel: asLogLevel(global.logLevel),
    });

    try {
      await services.init();
      const context = services.createContext();
      const result = await services.analyzeVideo.execute(
        {
          videoPath: resolve(video),
          outputDir: resolve(global.output),
          config: resolvePreset(services, options.preset),
          formats,
          progressCallback: (progress: ProgressUpdate) => {
            process.stderr.write(
              `\r${progress.stage} ${progress.percent.toFixed(0).padStart(3)}% ${progress.current}`.slice(0, 120)
            );
          },
        },
        context
      );
      process.stderr.write('\r'.padEnd(121) + '\r');

      if (options.json === true) {
        process.stdout.write(
          `${JSON.stringify(
            {
              videoPath: result.video.sourcePath,
              outputFiles: result.outputFiles,
              processingTimeMs: result.processingTimeMs,
              warnings: result.warnings,
            },
            null,
            2
          )}\n`
        );
      } else {
        console.log(`Wrote ${result.outputFiles.length} file(s):`);
        for (const file of result.outputFiles) console.log(`  ${file}`);
        for (const warning of result.warnings) console.warn(`warning: ${warning}`);
      }
    } catch (error) {
      fail(error);
    } finally {
      services.dispose();
    }
  });

program
  .command('batch')
  .description('Analyse every video under the given files and directories')
  .argument('<paths...>', 'files or directories to scan')
  .option('-p, --preset <name>', 'lecture | tutorial | meeting | documentary', 'lecture')
  .option('-f, --format <list>', 'comma separated: md, json, html', 'md')
  .option('-c, --concurrency <n>', 'parallel videos', '2')
  .option('--no-resume', 'ignore existing checkpoints and reprocess everything')
  .action(
    async (
      paths: string[],
      options: { preset: string; format: string; concurrency: string; resume: boolean }
    ) => {
      const global = program.opts<GlobalOptions>();
      const services = createServices({
        outputDir: global.output,
        configPath: global.config,
        ffmpegPath: global.ffmpeg,
      ffprobePath: global.ffmpeg === undefined ? undefined : deriveFfprobe(global.ffmpeg),
        logLevel: asLogLevel(global.logLevel),
      });

      try {
        await services.init();
        const context = services.createContext();
        const result = await services.batchProcess.execute(
          {
            inputPaths: paths.map((entry) => resolve(entry)),
            outputDir: resolve(global.output),
            config: resolvePreset(services, options.preset),
            formats: parseFormats(options.format),
            maxConcurrent: Math.max(1, Number.parseInt(options.concurrency, 10) || 2),
            resume: options.resume,
            progressCallback: (update: BatchProgressUpdate) => {
              const current = update.currentVideo ?? '';
              process.stderr.write(
                `\r${update.phase} ${update.completedVideos}/${update.totalVideos} ${current}`.slice(0, 120)
              );
            },
          },
          context
        );

        process.stderr.write('\r'.padEnd(121) + '\r');
        const summary = result.summary;
        console.log(
          `${summary.successful} succeeded, ${summary.failed} failed, ${summary.skipped} skipped ` +
            `(${summary.totalVideos} total)`
        );
        for (const item of result.results) {
          if (!item.success) console.error(`  FAILED ${item.videoPath}: ${item.error ?? 'unknown error'}`);
        }
        process.exitCode = summary.failed > 0 ? 1 : 0;
      } catch (error) {
        fail(error);
      } finally {
        services.dispose();
      }
    }
  );

program
  .command('doctor')
  .description('Report which external tools and LLM provider are available')
  .option('--verbose', 'print the detected version line for each tool')
  .action(async (options: { verbose?: boolean }) => {
    const global = program.opts<GlobalOptions>();
    const services = createServices({
      outputDir: global.output,
      configPath: global.config,
      ffmpegPath: global.ffmpeg,
      ffprobePath: global.ffmpeg === undefined ? undefined : deriveFfprobe(global.ffmpeg),
      logLevel: asLogLevel(global.logLevel),
    });

    try {
      await services.init().catch(() => undefined);
      const report = await services.doctor();
      console.log(`ffmpeg/ffprobe: ${report.ok ? 'ok' : 'MISSING (required)'}`);
      console.log(`node: ${report.node}`);
      console.log(`llm: ${report.llmProvider} (${report.llmDetail})`);
      console.log('tools:');
      for (const tool of report.tools) {
        const state = tool.available ? 'ok' : 'missing';
        const version = options.verbose === true && tool.version !== null ? ` - ${tool.version}` : '';
        const error = !tool.available && tool.error !== null ? ` (${tool.error})` : '';
        console.log(`  ${tool.name.padEnd(12)} ${state}${version}${error}`);
      }
      process.exitCode = report.ok ? 0 : 1;
    } finally {
      services.dispose();
    }
  });

program.parseAsync(process.argv).catch(fail);

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const logger = new ConsoleLogger('error');
  logger.error(message);
  process.exitCode = 1;
  process.exit(1);
}

function asLogLevel(value: string): 'debug' | 'info' | 'warn' | 'error' {
  return value === 'debug' || value === 'warn' || value === 'error' || value === 'info' ? value : 'info';
}

/**
 * `--ffmpeg` is documented as "ffmpeg/ffprobe executable path". ffprobe ships
 * next to ffmpeg, so derive it from the same directory instead of silently
 * falling back to `ffprobe` on `PATH`.
 */
function deriveFfprobe(ffmpegPath: string): string {
  const directory = dirname(ffmpegPath);
  const suffix = extname(ffmpegPath).toLowerCase() === '.exe' ? '.exe' : '';
  return join(directory, `ffprobe${suffix}`);
}

function parseFormats(raw: string): Format[] {
  const parsed: Format[] = [];
  for (const part of raw.split(',')) {
    const value = part.trim().toLowerCase();
    if ((FORMATS as readonly string[]).includes(value)) {
      if (!parsed.includes(value as Format)) parsed.push(value as Format);
      continue;
    }
    throw new Error(`Unknown format "${value}". Use md, json, or html.`);
  }
  return parsed.length > 0 ? parsed : ['md'];
}

function resolvePreset(
  services: ReturnType<typeof createServices>,
  preset: string
): Partial<ProcessingConfig> {
  const resolved = services.config.getPresetConfig(preset);
  return {
    frameExtraction: resolved.frameExtraction,
    ocr: resolved.ocr,
    transcription: resolved.transcription,
    note: resolved.note,
  };
}
