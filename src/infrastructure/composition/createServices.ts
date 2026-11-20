import { join, resolve } from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

import { AnalyzeVideo } from '../../application/use-cases/AnalyzeVideo.js';
import { BatchProcess } from '../../application/use-cases/BatchProcess.js';
import {
  ExtractiveSummarizer,
  ISummarizer,
  LLMSummarizer,
  SummarizeOptions,
} from '../../application/services/Summarizer.js';
import { ContentAggregator } from '../../domain/services/ContentAggregator.js';
import { TimestampAligner } from '../../domain/services/TimestampAligner.js';
import { NoteSection } from '../../domain/entities/Note.js';
import {
  ICheckpointStore,
  IConfigurationProvider,
  ILLMProvider,
  ILogger,
  IMetricsCollector,
  ISecretProvider,
  LLMConfig,
  PipelineContext,
} from '../../application/ports/Interfaces.js';

import { ConsoleLogger, LogLevel } from '../adapters/ConsoleLogger.js';
import { InMemoryMetricsCollector } from '../adapters/InMemoryMetricsCollector.js';
import { JsonCheckpointStore } from '../adapters/JsonCheckpointStore.js';
import { YamlConfigProvider } from '../adapters/YamlConfigProvider.js';
import { EnvSecretProvider } from '../adapters/EnvSecretProvider.js';
import { MarkdownNoteRenderer } from '../adapters/MarkdownNoteRenderer.js';
import { FfmpegVideoMetadataExtractor } from '../adapters/FfmpegVideoMetadataExtractor.js';
import { FfmpegFrameExtractor } from '../adapters/FfmpegFrameExtractor.js';
import { FfmpegAudioExtractor } from '../adapters/FfmpegAudioExtractor.js';
import { TesseractOCRProcessor } from '../adapters/TesseractOCRProcessor.js';
import { WhisperTranscriptionEngine } from '../adapters/WhisperTranscriptionEngine.js';
import { PySceneDetectSceneAnalyzer } from '../adapters/PySceneDetectSceneAnalyzer.js';
import {
  HarnessLLMProvider,
  HarnessLlmBridge,
} from '../adapters/HarnessLLMProvider.js';
import {
  AnthropicLLMProvider,
  DeepSeekLLMProvider,
  GoogleLLMProvider,
  OpenAILLMProvider,
} from '../adapters/CloudLLMProviders.js';
import { CustomLLMProvider, OllamaLLMProvider } from '../adapters/LocalLLMProviders.js';
import { TranscriptRenderer } from '../adapters/TranscriptRenderer.js';
import { OCRRenderer } from '../adapters/OCRRenderer.js';
import { FrameCopier } from '../adapters/FrameCopier.js';
import { AudioEnhancer } from '../adapters/AudioEnhancer.js';
import { NoteSynthesizer } from '../../application/services/NoteSynthesizer.js';
import {
  INoteSynthesizer,
  SynthesisInput,
  SynthesisOptions,
  SynthesizedResult,
} from '../../application/ports/Interfaces.js';

/**
 * Composition root.
 *
 * Every adapter is constructed here and injected into the use cases. Nothing
 * below the plugin layer reaches for a singleton, so a host can create several
 * independent service graphs (tests, CLI runs, plugin instances).
 */

export interface VideoToNotesServiceConfig {
  /** Directory where notes are written when a call does not specify one. */
  outputDir?: string | undefined;
  /** Directory holding batch checkpoint files. */
  checkpointDir?: string | undefined;
  /** Optional YAML configuration file layered over the built-in defaults. */
  configPath?: string | undefined;

  ffmpegPath?: string | undefined;
  ffprobePath?: string | undefined;
  tesseractPath?: string | undefined;
  tessdataDir?: string | undefined;
  whisperPath?: string | undefined;
  whisperModelDir?: string | undefined;
  scenedetectPath?: string | undefined;

  logLevel?: LogLevel | undefined;

  /** Harness LLM bridge; present only when running inside DeepSeek Harness. */
  harnessBridge?: HarnessLlmBridge | null | undefined;
  /** Extra LLM overrides applied on top of the YAML file and defaults. */
  llm?: Partial<LLMConfig> | undefined;
}

export interface ToolStatus {
  name: string;
  command: string;
  available: boolean;
  version: string | null;
  error: string | null;
}

export interface DoctorReport {
  ok: boolean;
  node: string;
  llmProvider: string;
  llmAvailable: boolean;
  llmDetail: string;
  tools: ToolStatus[];
}

/**
 * Summariser that forwards to whichever implementation `init()` selected.
 * This lets the whole graph be built synchronously while still allowing the
 * LLM provider (which needs an async secret lookup) to be resolved later.
 */
class DelegatingSummarizer implements ISummarizer {
  private _delegate: ISummarizer = new ExtractiveSummarizer();

  use(delegate: ISummarizer): void {
    this._delegate = delegate;
  }

  summarize(sections: NoteSection[], options?: SummarizeOptions): Promise<NoteSection[]> {
    return this._delegate.summarize(sections, options);
  }
}

class DelegatingSynthesizer implements INoteSynthesizer {
  private _delegate: INoteSynthesizer;

  constructor(logger: ILogger) {
    this._delegate = new NoteSynthesizer(
      null,
      { provider: 'none', temperature: 0.3, maxTokens: 2048, topP: 0.9 },
      logger
    );
  }

  use(delegate: INoteSynthesizer): void {
    this._delegate = delegate;
  }

  synthesize(input: SynthesisInput, options?: SynthesisOptions): Promise<SynthesizedResult> {
    return this._delegate.synthesize(input, options);
  }
}

export class Services {
  readonly logger: ILogger;
  readonly metrics: IMetricsCollector;
  readonly checkpoint: ICheckpointStore;
  readonly config: IConfigurationProvider;
  readonly secrets: ISecretProvider;
  readonly renderer: MarkdownNoteRenderer;
  readonly rawTranscriptRenderer: TranscriptRenderer;
  readonly rawOcrRenderer: OCRRenderer;
  readonly frameCopier: FrameCopier;
  readonly audioEnhancer: AudioEnhancer;
  readonly analyzeVideo: AnalyzeVideo;
  readonly batchProcess: BatchProcess;
  readonly defaultOutputDir: string;

  private readonly _options: VideoToNotesServiceConfig;
  private readonly _summarizer: DelegatingSummarizer;
  private readonly _synthesizer: DelegatingSynthesizer;
  private _llm: ILLMProvider | null = null;
  private _initPromise: Promise<void> | null = null;
  private _disposed = false;

  constructor(options: VideoToNotesServiceConfig = {}) {
    this._options = options;

    const cwd = process.cwd();
    this.defaultOutputDir = resolve(options.outputDir ?? join(cwd, 'output'));

    this.logger = new ConsoleLogger(options.logLevel ?? 'info');
    this.metrics = new InMemoryMetricsCollector();
    this.checkpoint = new JsonCheckpointStore(
      resolve(options.checkpointDir ?? join(cwd, '.vtn', 'checkpoints')),
      this.logger
    );
    this.config = new YamlConfigProvider(this.logger);
    this.secrets = new EnvSecretProvider();
    this.renderer = new MarkdownNoteRenderer();
    this.rawTranscriptRenderer = new TranscriptRenderer();
    this.rawOcrRenderer = new OCRRenderer();
    this.frameCopier = new FrameCopier(this.logger);
    this.audioEnhancer = new AudioEnhancer(options.ffmpegPath ?? 'ffmpeg', this.logger, this.metrics);
    this._summarizer = new DelegatingSummarizer();
    this._synthesizer = new DelegatingSynthesizer(this.logger);

    const ffmpeg = options.ffmpegPath ?? 'ffmpeg';
    const logger = this.logger;
    const metrics = this.metrics;

    this.analyzeVideo = new AnalyzeVideo({
      metadataExtractor: new FfmpegVideoMetadataExtractor(options.ffprobePath ?? 'ffprobe', logger, metrics),
      frameExtractor: new FfmpegFrameExtractor(ffmpeg, logger, metrics),
      ocrProcessor: new TesseractOCRProcessor(
        options.tesseractPath ?? 'tesseract',
        options.tessdataDir ?? '',
        logger,
        metrics
      ),
      audioExtractor: new FfmpegAudioExtractor(ffmpeg, logger, metrics),
      transcriptionEngine: new WhisperTranscriptionEngine(
        options.whisperPath ?? 'whisper-cli',
        resolve(options.whisperModelDir ?? join(cwd, 'models')),
        logger,
        metrics,
        ffmpeg
      ),
      sceneAnalyzer: new PySceneDetectSceneAnalyzer(options.scenedetectPath ?? 'scenedetect', logger, metrics),
      timestampAligner: new TimestampAligner(),
      createContentAggregator: () => new ContentAggregator(),
      noteRenderer: this.renderer,
      summarizer: this._summarizer,
      configProvider: this.config,
      metrics,
      logger,
      rawTranscriptRenderer: this.rawTranscriptRenderer,
      rawOcrRenderer: this.rawOcrRenderer,
      frameCopier: this.frameCopier,
      audioEnhancer: this.audioEnhancer,
      synthesizer: this._synthesizer,
    });

    this.batchProcess = new BatchProcess(this.analyzeVideo, this.config, this.checkpoint, metrics, logger);
  }

  /** Resolve configuration and the optional LLM provider. Idempotent. */
  init(): Promise<void> {
    if (this._initPromise === null) {
      this._initPromise = this.doInit().catch((error: unknown) => {
        // Allow a later retry after a transient failure (e.g. missing secret).
        this._initPromise = null;
        throw error;
      });
    }
    return this._initPromise;
  }

  private async doInit(): Promise<void> {
    const provider = this.config as YamlConfigProvider;
    await provider.load(this._options.configPath);

    let llmConfig = this.mergeLlmConfig(this.config.getLLMConfig());

    // Auto-detect harness LLM bridge if configured as none or unspecified
    if (llmConfig.provider === 'none' && this._options.harnessBridge) {
      this.logger.info('Auto-detected DeepSeek Harness LLM service; upgrading provider to harness');
      llmConfig = { ...llmConfig, provider: 'harness' };
    }

    if (llmConfig.provider === 'none') {
      this.logger.debug('LLM summarisation disabled; using offline extractive summariser & synthesizer');
      this._llm = null;
      this._summarizer.use(new ExtractiveSummarizer());
      this._synthesizer.use(new NoteSynthesizer(null, llmConfig, this.logger));
      return;
    }

    const adapter = await this.createLlmAdapter(llmConfig);
    this._llm = adapter;
    this._summarizer.use(new LLMSummarizer(adapter, llmConfig, this.logger));
    this._synthesizer.use(new NoteSynthesizer(adapter, llmConfig, this.logger));
    this.logger.info('LLM summarisation & synthesis enabled', { provider: llmConfig.provider });
  }

  private mergeLlmConfig(base: LLMConfig): LLMConfig {
    const overrides = this._options.llm;
    if (overrides === undefined) return base;
    return { ...base, ...pruneUndefined(overrides) } as LLMConfig;
  }

  private async createLlmAdapter(config: LLMConfig): Promise<ILLMProvider> {
    const logger = this.logger;
    const metrics = this.metrics;
    const model = config.model;

    switch (config.provider) {
      case 'harness': {
        const bridge = this._options.harnessBridge ?? null;
        if (bridge === null) {
          throw new Error(
            "llm.provider is 'harness' but no harness bridge was supplied. " +
              'Start the plugin inside DeepSeek Harness, or pick another provider.'
          );
        }
        const target = parseHarnessModel(config.harnessModel ?? model);
        return new HarnessLLMProvider(logger, metrics, bridge, target);
      }

      case 'deepseek': {
        const apiKey = await this.requireSecret('deepseek-api-key', 'DEEPSEEK_API_KEY');
        return new DeepSeekLLMProvider(apiKey, model ?? 'deepseek-chat', logger, metrics);
      }

      case 'openai': {
        const apiKey = await this.requireSecret('openai-api-key', 'OPENAI_API_KEY');
        return new OpenAILLMProvider(apiKey, model ?? 'gpt-4o', logger, metrics);
      }

      case 'anthropic': {
        const apiKey = await this.requireSecret('anthropic-api-key', 'ANTHROPIC_API_KEY');
        return new AnthropicLLMProvider(apiKey, model ?? 'claude-3-5-sonnet-20241022', logger, metrics);
      }

      case 'google': {
        const apiKey = await this.requireSecret('google-api-key', 'GOOGLE_API_KEY');
        return new GoogleLLMProvider(apiKey, model ?? 'gemini-1.5-pro', logger, metrics);
      }

      case 'ollama':
        return new OllamaLLMProvider(
          config.customEndpoint?.baseUrl ?? 'http://localhost:11434',
          logger,
          metrics,
          model ?? 'llama3.1:8b'
        );

      case 'custom': {
        const endpoint = config.customEndpoint;
        if (endpoint === undefined) {
          throw new Error("llm.provider is 'custom' but llm.customEndpoint is not configured");
        }
        return new CustomLLMProvider(endpoint, logger, metrics);
      }

      case 'none':
        // `none` is resolved before adapter creation; reaching here is a bug.
        throw new Error("Cannot create an LLM adapter for provider 'none'");

      default: {
        const exhaustive: never = config.provider;
        throw new Error(`Unsupported LLM provider: ${String(exhaustive)}`);
      }
    }
  }

  private async requireSecret(
    key: 'deepseek-api-key' | 'openai-api-key' | 'anthropic-api-key' | 'google-api-key',
    envName: string
  ): Promise<string> {
    const value = await this.secrets.get(key);
    if (value === null) {
      throw new Error(`Missing API key: set the ${envName} environment variable`);
    }
    return value;
  }

  get llm(): ILLMProvider | null {
    return this._llm;
  }

  get initialized(): boolean {
    return this._initPromise !== null && !this._disposed;
  }

  /** Build the per-run pipeline context handed to the use cases. */
  createContext(videoId?: string, signal?: AbortSignal): PipelineContext {
    return {
      videoId: videoId ?? randomUUID(),
      correlationId: randomUUID(),
      metrics: this.metrics,
      logger: this.logger,
      signal: signal ?? new AbortController().signal,
    };
  }

  /** Report on external binaries and LLM configuration without running a job. */
  async doctor(): Promise<DoctorReport> {
    const ffmpeg = this._options.ffmpegPath ?? 'ffmpeg';
    const ffprobe = this._options.ffprobePath ?? 'ffprobe';
    const tesseract = this._options.tesseractPath ?? 'tesseract';
    const whisper = this._options.whisperPath ?? 'whisper-cli';
    const scenedetect = this._options.scenedetectPath ?? 'scenedetect';

    const tools = await Promise.all([
      probeBinary('ffmpeg', ffmpeg, ['-version']),
      probeBinary('ffprobe', ffprobe, ['-version']),
      probeBinary('tesseract', tesseract, ['--version']),
      probeBinary('whisper-cli', whisper, ['--version']),
      probeScenedetect(scenedetect),
    ]);

    const required = ['ffmpeg', 'ffprobe'];
    const ok = tools.filter((tool) => required.includes(tool.name)).every((tool) => tool.available);

    const llmConfig = this._options.llm ?? this.config.getLLMConfig();
    const llmProvider = llmConfig.provider ?? 'none';
    let llmAvailable = llmProvider === 'none' || llmProvider === 'harness';
    let llmDetail = llmProvider === 'none' ? 'disabled (extractive summariser)' : 'configured';

    if (this._llm !== null) {
      const health = await this._llm.healthCheck();
      llmAvailable = health.healthy;
      llmDetail = health.healthy ? 'healthy' : (health.error ?? 'unhealthy');
    }

    return {
      ok,
      node: process.version,
      llmProvider,
      llmAvailable,
      llmDetail,
      tools,
    };
  }

  dispose(): void {
    this._disposed = true;
    this._llm = null;
  }
}

/** Create the full service graph. Call `init()` before running a job. */
export function createServices(options: VideoToNotesServiceConfig = {}): Services {
  return new Services(options);
}

const HARNESS_MODEL_PATTERN = /^([a-zA-Z0-9_-]+)\/(.+)$/;

function parseHarnessModel(value: string | undefined): { provider: string; model: string } {
  if (value === undefined || value.trim().length === 0) {
    return { provider: 'deepseek', model: 'deepseek-chat' };
  }
  const match = HARNESS_MODEL_PATTERN.exec(value.trim());
  if (match !== null && match[1] !== undefined && match[2] !== undefined) {
    return { provider: match[1], model: match[2] };
  }
  return { provider: 'deepseek', model: value.trim() };
}

function pruneUndefined<T extends object>(value: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = entry;
  }
  return result as Partial<T>;
}

/**
 * PySceneDetect 0.7 replaced `--version` with the `version` subcommand, while
 * older releases only understand `--version`. Try both so a working install is
 * not reported as missing.
 *
 * Startup imports OpenCV and `av`, which regularly takes several seconds on
 * Windows, so the probe gets a much longer budget than the native binaries.
 */
async function probeScenedetect(command: string): Promise<ToolStatus> {
  const modern = await probeBinary('scenedetect', command, ['version'], 20000);
  if (modern.available) return modern;
  const legacy = await probeBinary('scenedetect', command, ['--version'], 20000);
  return legacy.available ? legacy : modern;
}

function probeBinary(name: string, command: string, args: string[], timeoutMs = 5000): Promise<ToolStatus> {
  return new Promise<ToolStatus>((resolveProbe) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (status: ToolStatus): void => {
      if (settled) return;
      settled = true;
      resolveProbe(status);
    };

    let child;
    try {
      child = spawn(command, args, { windowsHide: true });
    } catch (error) {
      finish({
        name,
        command,
        available: false,
        version: null,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    const timer = setTimeout(() => {
      child.kill();
      finish({ name, command, available: false, version: null, error: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('error', (error: Error) => {
      clearTimeout(timer);
      finish({ name, command, available: false, version: null, error: error.message });
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      const output = `${stdout}\n${stderr}`.trim();
      if (code === 0) {
        finish({ name, command, available: true, version: firstLine(output), error: null });
      } else {
        finish({
          name,
          command,
          available: false,
          version: null,
          error: output.length > 0 ? firstLine(output) : `exited with code ${String(code)}`,
        });
      }
    });
  });
}

function firstLine(text: string): string | null {
  const line = text.split(/\r?\n/).find((entry) => entry.trim().length > 0);
  return line === undefined ? null : line.trim();
}
