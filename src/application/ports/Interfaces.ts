import type { Video } from '../../domain/entities/Video.js';
import type { Frame } from '../../domain/entities/Frame.js';
import type { Transcript, TranscriptSegment } from '../../domain/entities/Transcript.js';
import type { Scene } from '../../domain/entities/Scene.js';
import type { Note, NoteSection, Citation } from '../../domain/entities/Note.js';
import type { OCRResult } from '../../domain/value-objects/OCRResult.js';
import type { AlignedContentBlock } from '../../domain/services/TimestampAligner.js';
import type { AggregatedSection } from '../../domain/services/ContentAggregator.js';
import type { ZodTypeAny, infer as ZodInfer } from 'zod';
import type {
  CoverageCounts,
  CoverageGap,
  NoteValidationResult,
} from '../../domain/entities/ValidationFinding.js';

/**
 * Application Layer Ports (Interfaces)
 * These define the contracts that infrastructure adapters must implement.
 * Following Clean Architecture - domain depends on abstractions, not concretions.
 */

// Re-export domain-owned types so existing importers keep working, but there is
// exactly one declaration of each in the codebase (inside the domain).
export type { NoteSection, Citation };
export type {
  Correction,
  CoverageGap,
  CoverageCounts,
  NoteValidationResult,
} from '../../domain/entities/ValidationFinding.js';

export interface ValidationModel {
  provider: string;
  model: string;
}

export interface ValidationConfig {
  enabled: boolean;
  model?: ValidationModel | undefined;
  maxCorrections: number;
  abstainOnUnverifiedBasis: boolean;
}

/**
 * Video metadata extraction port.
 * `extract` mutates the supplied `Video` via `setMetadata` / `setContentHash`.
 */
export interface IVideoMetadataExtractor {
  extract(video: Video): Promise<void>;
  getSupportedFormats(): string[];
}

/**
 * Frame extraction port
 */
export interface IFrameExtractor {
  extractFrames(
    video: Video,
    config: FrameExtractionConfig,
    signal: AbortSignal
  ): AsyncIterable<Frame>;

  getEstimatedFrameCount(video: Video, config: FrameExtractionConfig): number;
}

export interface FrameExtractionConfig {
  preset: 'lecture' | 'tutorial' | 'meeting' | 'documentary' | 'custom';
  strategy: string;
  sceneThreshold: number; // 0.2-0.4
  minIntervalSec: number; // Max frames when static
  maxIntervalSec: number; // Min frames during action
  screenshotCount: number; // Cap on saved screenshots (maxFrames caps extraction)
  intervalSec: number;
  enableTransientDetection: boolean;
  maxFrames: number; // Hard cap
  fastExtract: boolean; // Use direct PTS seeking
  fastIntervalSec?: number | undefined;
  enableRegionDetection: boolean;
  regionOfInterest?: 'screen-share' | 'participants' | 'all' | undefined;
}

/**
 * OCR processing port
 */
export interface IOCRProcessor {
  process(frame: Frame, config: OCRConfig): Promise<OCRResult>;
  getSupportedLanguages(): string[];
  warmup(): Promise<void>;
}

export interface OCRConfig {
  psm: 'auto' | '3' | '4' | '6' | '11';
  languages: string[];
  confidenceThreshold: number;
  superResolution: boolean;
  codeDetection: boolean;
  regionAware: boolean;
}

/**
 * Audio extraction port
 */
export interface IAudioExtractor {
  extract(video: Video, outputDir: string, signal: AbortSignal): Promise<AudioFile>;
  getSupportedFormats(): string[];
}

export interface AudioFile {
  /** Video that produced this audio track. */
  videoId: string;
  path: string;
  duration: number; // seconds
  sampleRate: number; // e.g., 16000
  channels: number; // 1 = mono, 2 = stereo
  format: string; // wav, mp3, etc.
}

/**
 * Transcription engine port
 */
export interface ITranscriptionEngine {
  transcribe(audio: AudioFile, config: TranscriptionConfig): Promise<Transcript>;
  getSupportedModels(): string[];
  getSupportedLanguages(): string[];
  warmup(): Promise<void>;
}

export interface TranscriptionConfig {
  model: 'tiny.int8' | 'base.int8' | 'small.int8' | 'large-v3.int8';
  language?: string | undefined;
  enableVAD: boolean;
  vocabularyBoost?: string | undefined;
  wordTimestamps: boolean;
  enableEscalation: boolean;
  escalationThreshold: number;
  maxEscalations: number;
  enhanceAudio?: boolean | undefined;
  multilingual?: boolean | undefined;
}

/**
 * Audio enhancer port for noise reduction and loudness normalization
 */
export interface IAudioEnhancer {
  enhance(audio: AudioFile, outputDir: string, signal?: AbortSignal): Promise<AudioFile>;
}

/**
 * Scene analysis port
 */
export interface ISceneAnalyzer {
  analyze(video: Video, frames: Frame[]): Promise<Scene[]>;
  getSupportedSceneTypes(): string[];
}

/**
 * Timestamp alignment port (implemented by the domain service)
 */
export interface ITimestampAligner {
  align(
    transcriptSegments: TranscriptSegment[],
    frames: Frame[],
    scenes: Scene[]
  ): AlignedContentBlock[];

  alignWithSemanticMatching(
    transcriptSegments: TranscriptSegment[],
    frames: Frame[]
  ): Promise<AlignedContentBlock[]>;
}

/**
 * Content aggregation port (implemented by the domain service)
 */
export interface IContentAggregator {
  processBlock(block: AlignedContentBlock): void;
  getSections(): AggregatedSection[];
  toNoteSections(): NoteSection[];
}

/**
 * Note rendering port
 */
export interface INoteRenderer {
  render(note: Note, outputPath: string): Promise<void>;
  getSupportedFormats(): string[];
}

/**
 * Manifest of all generated files per video analysis
 */
export interface OutputFileManifest {
  transcript: string;
  ocr: string;
  notes: string;
  framesDir: string;
  all: string[];
}

/**
 * Raw transcript markdown renderer
 */
export interface IRawTranscriptRenderer {
  render(transcript: Transcript, outputPath: string, video?: Video): Promise<void>;
  renderToString(transcript: Transcript, video?: Video): string;
}

/**
 * Raw OCR markdown renderer
 */
export interface IRawOCRRenderer {
  render(frames: Frame[], outputPath: string, video?: Video): Promise<void>;
  renderToString(frames: Frame[], video?: Video): string;
}

/**
 * Key frame copier / screenshot manager
 */
export interface IFrameCopier {
  copyKeyFrames(
    frames: Frame[],
    outputDir: string,
    baseName: string,
    maxFrames?: number,
    durationMs?: number
  ): Promise<Map<string, string>>; // frameId -> relative or saved image path
}

/**
 * Concept validation model for discrepancies detected by LLM
 */
export interface ConceptValidation {
  timestamp: string;
  instructorSaid: string;
  actualFact: string;
  source: 'ocr-transcript-mismatch' | 'known-correction';
  confidence: number;
}

export interface SynthesisInput {
  video: Video;
  transcript: Transcript;
  frames: Frame[];
  scenes: Scene[];
  alignedBlocks: AlignedContentBlock[];
  keyFramePaths: Map<string, string>;
  sections: NoteSection[];
}

export interface SynthesisOptions {
  detailLevel?: 'executive' | 'standard' | 'comprehensive' | undefined;
  enableValidation?: boolean | undefined;
  signal?: AbortSignal | undefined;
  privacy?: ProcessingConfig['privacy'] | undefined;
  validation?: ValidationConfig | undefined;
}

export interface SynthesizedResult {
  sections: NoteSection[];
  gapCounts: CoverageCounts;
  gaps: CoverageGap[];
  degraded: boolean;
}

export interface ValidationInput {
  notes: string;
  transcript: Transcript;
  frames: Frame[];
  screenshots: Map<string, string>;
  language: string;
}

export interface ValidationOptions {
  signal?: AbortSignal | undefined;
  model?: ValidationModel | undefined;
}

export interface INoteValidator {
  validate(input: ValidationInput, options?: ValidationOptions): Promise<NoteValidationResult>;
}

export interface IValidationReviser {
  revise(
    sections: NoteSection[],
    findings: NoteValidationResult,
    input: SynthesisInput,
    options?: SynthesisOptions
  ): Promise<NoteSection[]>;
}

export interface INoteSynthesizer extends IValidationReviser {
  synthesize(input: SynthesisInput, options?: SynthesisOptions): Promise<SynthesizedResult>;
}

/**
 * LLM Provider port (for grounded summarization)
 */
export interface ILLMProvider {
  complete(request: LLMRequest, options?: LLMCallOptions): Promise<LLMResponse>;
  completeStream(request: LLMRequest, options?: LLMCallOptions): Promise<AsyncIterable<LLMChunk>>;
  completeStructured<T extends ZodTypeAny>(
    request: LLMRequest,
    schema: T,
    options?: LLMCallOptions
  ): Promise<ZodInfer<T>>;

  completeWithContextStream(
    request: LLMRequest,
    contextStream: AsyncIterable<string>,
    options?: LLMCallOptions
  ): Promise<LLMResponse>;

  getModelInfo(): LLMModelInfo;
  listAvailableModels(): Promise<string[]>;
  healthCheck(): Promise<HealthStatus>;
  getCapabilities(): LLMProviderCapabilities;
}

export interface LLMRequest {
  messages: LLMMessage[];
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  topP?: number | undefined;
  stop?: string[] | undefined;
  systemPrompt?: string | undefined;
  context?: string | AsyncIterable<string> | undefined;
  requireCitations?: boolean | undefined;
  citationFormat?: 'inline' | 'footnote' | 'bracket' | undefined;
  contextStrategy?: 'truncate' | 'chunk' | 'map-reduce' | undefined;
  maxContextTokens?: number | undefined;
  chunkOverlapTokens?: number | undefined;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  citations?: Citation[] | undefined;
  groundednessScore?: number | undefined;
}

export interface LLMChunk {
  delta: string;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | undefined;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
}

export interface LLMModelInfo {
  provider: string;
  model: string;
  maxContextTokens: number;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsCitations: boolean;
}

export interface HealthStatus {
  healthy: boolean;
  latencyMs?: number | undefined;
  error?: string | undefined;
  checkedAt: Date;
}

export interface LLMCallOptions {
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
  priority?: 'low' | 'normal' | 'high' | undefined;
  idempotencyKey?: string | undefined;
  skipCache?: boolean | undefined;
}

/**
 * Configuration provider port
 */
export interface IConfigurationProvider {
  getVideoProcessingConfig(): ProcessingConfig;
  getLLMConfig(): LLMConfig;
  getPresetConfig(preset: string): PresetConfig;
  validate(config: object): ValidationResult;
}

export interface ProcessingConfig {
  frameExtraction: FrameExtractionConfig;
  ocr: OCRConfig;
  transcription: TranscriptionConfig;
  note: NoteConfig;
  privacy: 'local-only' | 'cloud-opt-in';
  batch: BatchConfig;
  validation: ValidationConfig;
}

export interface BatchConfig {
  maxConcurrent: number;
  checkpointInterval: number;
  resume: boolean;
}

export interface NoteConfig {
  template: string;
  outputFormats: ('md' | 'json' | 'html')[];
  citationFormat: 'inline' | 'footnote' | 'bracket';
  detailLevel: 'executive' | 'standard' | 'comprehensive';
}

export interface LLMConfig {
  provider:
    'none' | 'harness' | 'deepseek' | 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom';
  model?: string | undefined;
  temperature: number;
  maxTokens: number;
  topP: number;
  harnessModel?: string | undefined;
  customEndpoint?:
    | {
        baseUrl: string;
        apiKey: string;
        model: string;
        headers?: Record<string, string> | undefined;
      }
    | undefined;
  capabilities?:
    | {
        supportsJSONMode?: boolean | undefined;
        supportsToolUse?: boolean | undefined;
        maxContextTokens?: number | undefined;
        optimalTemperature?: number | undefined;
        citationComplexity?: 'simple' | 'standard' | 'rich' | undefined;
      }
    | undefined;
  contextManagement?:
    | {
        strategy: 'truncate' | 'chunk' | 'map-reduce';
        chunkOverlapTokens: number;
        maxChunkTokens: number;
        synthesisTemperature: number;
      }
    | undefined;
  performance?:
    | {
        timeoutMs: number;
        maxRetries: number;
        retryBaseDelayMs: number;
        circuitBreakerThreshold: number;
        fallbackProviders: string[];
        semanticCacheTTLMs: number;
      }
    | undefined;
  cost?:
    | {
        maxCostPerRequestUsd?: number | undefined;
        dailyBudgetUsd?: number | undefined;
        preferCheaperModel: boolean;
      }
    | undefined;
}

export interface PresetConfig {
  name: string;
  frameExtraction: FrameExtractionConfig;
  ocr: OCRConfig;
  transcription: TranscriptionConfig;
  note: NoteConfig;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Secrets provider port
 */
export interface ISecretProvider {
  get(
    key:
      | 'whisper-api-key'
      | 'videodb-api-key'
      | 'deepseek-api-key'
      | 'openai-api-key'
      | 'anthropic-api-key'
      | 'google-api-key'
      | 'custom-llm-api-key'
  ): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Resource pool port for managing external tool concurrency
 */
export interface IResourcePool<T> {
  acquire(): Promise<PooledResource<T>>;
  release(resource: PooledResource<T>): void;
  stats(): { available: number; inUse: number; waiting: number };
}

export interface PooledResource<T> {
  resource: T;
  release(): void;
}

export interface CheckpointData {
  stage: number;
  [key: string]: unknown;
}

/**
 * Checkpoint store port for resume capability
 */
export interface ICheckpointStore {
  save(key: string, data: CheckpointData): Promise<void>;
  load(key: string): Promise<CheckpointData | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

/**
 * Metrics collector port for observability
 */
export interface IMetricsCollector {
  incrementCounter(name: string, labels?: Record<string, string>): void;
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void;
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
  startTimer(name: string, labels?: Record<string, string>): Timer;
}

export interface Timer {
  stop(labels?: Record<string, string>): void;
}

/**
 * Logger port
 */
export interface ILogger {
  debug(message: string, meta?: object): void;
  info(message: string, meta?: object): void;
  warn(message: string, meta?: object): void;
  error(message: string, meta?: object): void;
}

/**
 * Correlation ID context for distributed tracing
 */
export interface PipelineContext {
  videoId: string;
  correlationId: string;
  checkpoint?: ICheckpointStore | undefined;
  metrics: IMetricsCollector;
  logger: ILogger;
  signal: AbortSignal;
}

/**
 * LLM Provider Capabilities - describes what a provider supports
 */
export interface LLMProviderCapabilities {
  provider: string;
  model: string;
  supportsJSONMode: boolean;
  supportsToolUse: boolean;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsCitations: boolean;
  maxContextTokens: number;
  optimalTemperature: number;
  citationComplexity: 'simple' | 'standard' | 'rich';
  averageLatencyMs: number;
  costPer1kTokens?: number | undefined;
}
