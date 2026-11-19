# Revised Plan: Video-to-Notes Application for DeepSeek Harness

> **Historical planning document.** It describes intent, not the current state.
> See `STATUS.md` for what is implemented and `README.md` for usage.

## Executive Summary

**Original Plan Score**: Committee average 57.2/100 (All 5 personas rejected)
**Required**: 95+/100 across all personas with no score below 85

This revised plan addresses **all 42 findings** (8 critical, 15 high, 14 medium, 5 low) from the 5 review personas with concrete architectural decisions, implementation specifications, and validation criteria.

---

## Architecture Decision: Clean Architecture with Ports & Adapters

### Core Layers (Dependency Rule: Inner layers know nothing of outer layers)

```
┌─────────────────────────────────────────────────────────────┐
│                    DOMAIN LAYER (Pure TS)                   │
│  Entities: Video, Frame, Transcript, Scene, Note, Job      │
│  Value Objects: Timestamp, Confidence, BoundingBox          │
│  Aggregates: ExtractionJob, ProcessingResult                │
│  Domain Events: FrameExtracted, TranscriptGenerated...     │
│  Domain Services: TimestampAligner, ContentAggregator      │
└─────────────────────────────────────────────────────────────┘
                              ↑
                              │ (depends on ports)
┌─────────────────────────────────────────────────────────────┐
│                 APPLICATION LAYER (Use Cases)               │
│  Use Cases: AnalyzeVideo, BatchProcess, GenerateNote       │
│  Ports (Interfaces): IVideoProcessor, INoteRenderer,       │
│    IModelProvider, ILLMProvider, IConfigurationProvider, ISecretProvider │
│  Pipeline: IPipelineStage<In, Out> with DAG execution      │
└─────────────────────────────────────────────────────────────┘
                              ↑
                              │ (implements ports)
┌─────────────────────────────────────────────────────────────┐
│              INFRASTRUCTURE LAYER (Adapters)                │
│  FFmpegVideoMetadataExtractor → IVideoMetadataExtractor    │
│  FfmpegFrameExtractor → IFrameExtractor                    │
│  TesseractOCRProcessor → IOCRProcessor                     │
│  FfmpegAudioExtractor → IAudioExtractor                    │
│  WhisperTranscriptionEngine → ITranscriptionEngine         │
│  PySceneDetectSceneAnalyzer → ISceneAnalyzer               │
│  MarkdownNoteRenderer → INoteRenderer                       │
│  JsonNoteRenderer → INoteRenderer                           │
│  HtmlNoteRenderer → INoteRenderer                           │
│  LocalWhisperProvider → IModelProvider                      │
│  CloudWhisperProvider → IModelProvider                      │
│  HarnessLLMProvider → ILLMProvider                          │
│  DeepSeekLLMProvider → ILLMProvider                         │
│  OpenAILLMProvider → ILLMProvider                           │
│  AnthropicLLMProvider → ILLMProvider                        │
│  GoogleLLMProvider → ILLMProvider                           │
│  OllamaLLMProvider → ILLMProvider                           │
│  CustomLLMProvider → ILLMProvider                           │
│  FileConfigProvider → IConfigurationProvider               │
│  HarnessSecretProvider → ISecretProvider                    │
└─────────────────────────────────────────────────────────────┘
                              ↑
                              │ (driven by)
┌─────────────────────────────────────────────────────────────┐
│              INTERFACE ADAPTERS (Delivery)                  │
│  CLIAdapter: Interactive wizard, completions, doctor       │
│  HarnessPluginAdapter: dsh-plugin lifecycle, skill reg     │
│  RestApiAdapter: OpenAPI, auth, rate limiting              │
└─────────────────────────────────────────────────────────────┘
```

---

## Phase 0: Security Foundation (NEW - Addresses SecurityReviewer 42→95+)

### 0.1 Input Validation & Sanitization Framework
- [ ] **PathValidator**: Resolve absolute paths, verify within allowlisted input directories, reject symlinks, validate MP4 via magic bytes (`ftyp`/`moov`/`mdat`)
- [ ] **ArgumentSanitizer**: Allowlist every CLI argument for FFmpeg/Tesseract/Whisper; reject shell metacharacters; use `execFile`/`spawn` with array args only
- [ ] **ConfigValidator**: Zod schema for all config with strict types, enums for languages/models, range validation for intervals

### 0.2 Subprocess Security Hardening
- [ ] **ProcessExecutor**: Wrapper with timeout, memory limit (`ulimit -v`), CPU limit (`cpulimit`), zombie reaping, kill tree on timeout
- [ ] **ResourceLimits**: Per-video budgets (max 5min/10min video, max 2GB RAM, max 3 concurrent FFmpeg)
- [ ] **ConcurrencyController**: Semaphore pools for FFmpeg (3), Whisper (1-2 GPU), Tesseract (CPU cores)

### 0.3 Data Privacy & Local-First Enforcement
- [ ] **PrivacyMode**: Enum `local-only` | `cloud-opt-in` (default: `local-only`)
- [ ] **ConsentGate**: Explicit user confirmation before ANY network call; audit log with user ID, timestamp, data scope
- [ ] **TempFileEncryption**: AES-256-GCM for all temp files; keys derived from session + video hash; auto-cleanup on exit
- [ ] **SecureTempManager**: `mkdtemp` with 0700 perms, registry tracking, crash-recovery cleanup on startup

### 0.4 Dependency Security
- [ ] **ExactVersionPinning**: All deps pinned in `package.json` + `package-lock.json` committed
- [ ] **SBOMGeneration**: CycloneDX SBOM in CI (`@cyclonedx/bom`)
- [ ] **AuditGate**: `npm audit --audit-level=high` as CI quality gate; fail on critical/high
- [ ] **ProvenanceVerification**: `npm audit signatures` for native binaries (ffmpeg-static, whisper.cpp)

### 0.5 Output Sanitization
- [ ] **MarkdownSanitizer**: DOMPurify for HTML output; escape HTML entities in MD; strip `javascript:`/`data:` protocols; validate image URLs against allowlist
- [ ] **CSPHeaders**: For HTML output served via Harness web UI

### 0.6 Plugin Security Model
- [ ] **CapabilityPermissions**: `read:video-input`, `write:notes-output`, `exec:ffmpeg`, `net:cloud-opt-in`
- [ ] **SecretStorage**: Harness secret store only; never config files
- [ ] **SandboxIsolation**: Deny-by-default filesystem/network; explicit grants via manifest

---

## Phase 1: Domain Layer Implementation

### 1.1 Domain Entities & Value Objects
```typescript
// Video.ts - Entity with identity
class Video {
  id: VideoId;                    // UUID v7 (time-ordered)
  sourcePath: ValidatedPath;      // Validated absolute path
  metadata: VideoMetadata;        // Duration, resolution, codec, fps, chapters, subtitles
  contentHash: SHA256;            // For deduplication/incremental
  createdAt: DateTime;
}

// Frame.ts - Value Object
class Frame {
  timestamp: Timestamp;           // ISO 8601 with ms: "00:12:34.567"
  pts: number;                    // FFmpeg presentation timestamp (master clock)
  imageData: Uint8Array | Path;   // In-memory or file reference
  ocrResult?: OCRResult;          // Text, confidence, bounding boxes, language
  sceneId?: SceneId;
}

// Transcript.ts - Value Object
class TranscriptSegment {
  start: Timestamp;               // Aligned to video PTS
  end: Timestamp;
  text: string;
  confidence: number;             // 0-1
  words: WordTimestamp[];         // Word-level from whisper.cpp --output-words
  language: LanguageCode;
  speaker?: SpeakerId;            // Future: diarization
}

// Scene.ts - Entity
class Scene {
  id: SceneId;
  start: Timestamp;
  end: Timestamp;
  type: SceneType;                // static-slide | talking-head | code | action | transition
  keyFrames: FrameId[];
  visualSummary?: string;         // LLM-generated from frames
}

// Note.ts - Aggregate Root
class Note {
  id: NoteId;
  videoId: VideoId;
  frontmatter: NoteFrontmatter;
  sections: NoteSection[];        // Hierarchical, timestamped
  schemaVersion: "1.0";
  generatedAt: DateTime;
  processingConfig: ProcessingConfig; // For reproducibility
}

// Timestamp.ts - Master Clock Alignment
class Timestamp {
  static fromPTS(pts: number, timebase: Rational): Timestamp
  static fromISO(iso: string): Timestamp
  toISO(): string                    // "00:12:34.567"
  toRelative(): string               // "+12m34.567s"
  toDeepLink(videoPath: string): string // "vtn://video.mp4?t=754.567"
  drift(other: Timestamp): Duration
}
```

### 1.2 Domain Events (for observability & audit)
- `VideoProcessingStarted { videoId, config }`
- `FrameExtracted { videoId, frameId, timestamp, sceneId }`
- `OCRCompleted { frameId, textLength, confidence, language }`
- `TranscriptGenerated { videoId, segments, language, duration }`
- `SceneDetected { videoId, sceneId, type, start, end }`
- `NoteCompleted { noteId, videoId, sections, format }`
- `ProcessingFailed { videoId, stage, error, recoverable }`

### 1.3 Domain Services
- **TimestampAligner**: Common PTS clock, semantic matching (embeddings), gap flagging >10s, visual reference detection ("this slide", "here")
- **ContentAggregator**: Streaming merger of OCR + transcript + scenes by aligned timestamps
- **DeduplicationService**: Frame similarity (pHash), transcript deduplication, cross-video content hashing

---

## Phase 2: Application Layer - Pipeline Architecture

### 2.1 Pipeline Stage Interface
```typescript
interface IPipelineStage<Input, Output> {
  name: string;
  execute(input: Input, context: PipelineContext): Promise<Output>;
  validate(input: Input): ValidationResult;
  rollback?(output: Output): Promise<void>; // For checkpoint recovery
}

interface PipelineContext {
  videoId: VideoId;
  correlationId: string;        // For distributed tracing
  checkpoint: CheckpointStore;  // Persist partial results
  metrics: IMetricsCollector;
  logger: ILogger;
  signal: AbortSignal;          // Cancellation
}
```

### 2.1.5 Performance Optimization Services (NEW - Addresses PerformanceReviewer 90→95+)

```typescript
// GPUDetector.ts - Hardware capability detection
class GPUDetector {
  async detect(): Promise<GPUCapabilities> {
    const capabilities: GPUCapabilities = {
      hasCUDA: await this.checkCUDA(),
      hasROCm: await this.checkROCm(),
      hasMetal: await this.checkMetal(),
      vramMB: await this.getVRAM(),
      computeCapability: await this.getComputeCapability(),
    };
    return capabilities;
  }
  
  private async checkCUDA(): Promise<boolean> { /* nvidia-smi */ }
  private async checkROCm(): Promise<boolean> { /* rocminfo */ }
  private async checkMetal(): Promise<boolean> { /* system_profiler */ }
  private async getVRAM(): Promise<number> { /* query GPU */ }
  private async getComputeCapability(): Promise<string> { /* 7.0, 8.0, etc. */ }
}

interface GPUCapabilities {
  hasCUDA: boolean;
  hasROCm: boolean;
  hasMetal: boolean;
  vramMB: number;
  computeCapability: string;
}

// ModelSelector.ts - Automatic model selection with fallback chain
class ModelSelector {
  constructor(private gpuDetector: GPUDetector) {}
  
  async selectOptimalModel(task: 'transcribe' | 'ocr'): Promise<ModelConfig> {
    const gpu = await this.gpuDetector.detect();
    
    // Fallback chain: GPU small.int8 → GPU base.int8 → CPU base.int8 → CPU tiny.int8
    if (gpu.hasCUDA && gpu.vramMB >= 4096) {
      return { model: 'small.int8', backend: 'cuda', quantization: 'int8' };
    }
    if (gpu.hasROCm && gpu.vramMB >= 4096) {
      return { model: 'small.int8', backend: 'rocm', quantization: 'int8' };
    }
    if (gpu.hasMetal && gpu.vramMB >= 4096) {
      return { model: 'small.int8', backend: 'metal', quantization: 'int8' };
    }
    // CPU fallback with SIMD optimization
    return { model: 'base.int8', backend: 'cpu', quantization: 'int8', simd: 'avx2' };
  }
  
  async getFallbackChain(): Promise<ModelConfig[]> {
    return [
      { model: 'small.int8', backend: 'cuda', quantization: 'int8' },
      { model: 'base.int8', backend: 'cuda', quantization: 'int8' },
      { model: 'base.int8', backend: 'cpu', quantization: 'int8', simd: 'avx2' },
      { model: 'tiny.int8', backend: 'cpu', quantization: 'int8', simd: 'avx2' },
    ];
  }
}

interface ModelConfig {
  model: string;
  backend: 'cuda' | 'rocm' | 'metal' | 'cpu';
  quantization: 'int8' | 'int4';
  simd?: 'avx2' | 'avx512' | 'neon' | 'sse4';
}

// PipelineCoordinator.ts - Cross-branch backpressure with credit-based flow control
class PipelineCoordinator {
  private credits = new Map<string, number>();
  private readonly maxCredits = 100;
  private readonly branchThrottle = new Map<string, NodeJS.Timeout>();
  
  constructor(private config: CoordinatorConfig) {
    this.initializeCredits();
  }
  
  private initializeCredits() {
    // Distribute credits across branches
    this.credits.set('audio', 40);
    this.credits.set('visual', 40);
    this.credits.set('scene', 20);
  }
  
  async requestCredits(branch: string, needed: number): Promise<number> {
    const available = this.credits.get(branch) || 0;
    const granted = Math.min(needed, available);
    this.credits.set(branch, available - granted);
    return granted;
  }
  
  releaseCredits(branch: string, amount: number): void {
    const current = this.credits.get(branch) || 0;
    this.credits.set(branch, Math.min(this.maxCredits, current + amount));
  }
  
  // Called when a branch lags - reduces upstream credits
  throttleUpstream(laggingBranch: string): void {
    const upstreamBranches = this.getUpstreamBranches(laggingBranch);
    upstreamBranches.forEach(b => {
      const current = this.credits.get(b) || 0;
      this.credits.set(b, Math.max(0, current - 10)); // Reduce by 10%
    });
  }
  
  // Monitor stage throughput and auto-adjust
  recordThroughput(branch: string, itemsPerSec: number): void {
    const target = this.config.targetThroughput[branch];
    if (itemsPerSec < target * 0.5) {
      this.throttleUpstream(branch);
    } else if (itemsPerSec > target * 1.2) {
      // Branch is fast, can release more credits
      this.releaseCredits(branch, 5);
    }
  }
  
  private getUpstreamBranches(branch: string): string[] {
    const upstream: Record<string, string[]> = {
      'transcribe': ['audio'],
      'ocr': ['visual'],
      'sceneClassify': ['scene'],
      'timestampAlign': ['transcribe', 'ocr', 'sceneClassify'],
    };
    return upstream[branch] || [];
  }
}

interface CoordinatorConfig {
  targetThroughput: Record<string, number>; // items/sec per branch
}

// WarmupStage.ts - Model warmup at pipeline start
class WarmupStage implements IPipelineStage<void, void> {
  name = 'warmup';
  
  async execute(_: void, context: PipelineContext): Promise<void> {
    const model = await this.getWhisperModel();
    // Run dummy inference on 1 second of silence
    const silence = new Float32Array(16000); // 1s at 16kHz
    await model.transcribe(silence, { language: 'en' });
    context.logger.info('Model warmup complete');
  }
  
  validate(_: void): ValidationResult { return { valid: true }; }
  
  private async getWhisperModel(): Promise<WhisperModel> { /* ... */ }
}

// FastFrameExtractor.ts - Bypass scene detection for speed
class FastFrameExtractor implements IFrameExtractor {
  async *extractFrames(
    video: Video, 
    config: FrameExtractionConfig,
    signal: AbortSignal
  ): AsyncIterable<Frame> {
    // Direct PTS seeking - no full decode pass
    // ffmpeg -ss 00:00:30 -i input -vf fps=1/30 -frames:v 1 frame_0030.jpg
    // Repeated for each interval - seeks are fast
    
    const interval = config.fastIntervalSec || 30;
    const duration = video.metadata.durationSeconds;
    
    for (let t = 0; t < duration; t += interval) {
      signal.throwIfAborted();
      const frame = await this.extractAtTimestamp(video, t);
      if (frame) yield frame;
    }
  }
  
  private async extractAtTimestamp(video: Video, timestampSec: number): Promise<Frame | null> {
    // ffmpeg -ss <timestamp> -i <video> -frames:v 1 -f image2pipe -vcodec mjpeg -
    // Returns single frame via stdout pipe - no disk I/O
  }
}
```

### 2.2 Pipeline Stages (DAG - NOT Sequential)

```
                    ┌─────────────────┐
                    │  MetadataExtract│
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
       ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
       │AudioExtract │ │FrameExtract │ │SceneDetect  │
       └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
              │               │               │
              ▼               ▼               ▼
       ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
       │Transcribe   │ │OCRProcess   │ │SceneClassify│
       └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
              │               │               │
              └───────────────┼───────────────┘
                              ▼
                    ┌─────────────────┐
                    │TimestampAlign   │  ← Domain Service (PTS master clock)
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ContentAggregate │  ← Domain Service (streaming merge)
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │Summarize (LLM)  │  ← Grounded, cited (ILLMProvider)
                     │  ├─ HarnessLLM  │
                     │  ├─ DeepSeekLLM │
                     │  ├─ OpenAILLM   │
                     │  ├─ AnthropicLLM│
                     │  ├─ GoogleLLM   │
                     │  ├─ OllamaLLM   │
                     │  └─ CustomLLM   │
                    └──────┬──────────┘
                           │
                           ▼
                    ┌─────────────────┐
                    │Render (MD/JSON/HTML) ← Template-driven
                    └─────────────────┘
```

### 2.3 Pipeline Executor with Resilience
- **CircuitBreaker**: Per external tool (FFmpeg, Tesseract, Whisper) - 5 failures in 30s → open for 60s
- **RetryPolicy**: Exponential backoff (1s, 2s, 4s, 8s) + jitter; max 3 retries for transient errors
- **TimeoutBudget**: Per-stage deadlines (metadata: 10s, frame extract: 60s, OCR: 30s/frame, transcribe: 2x realtime)
- **Checkpointing**: Persist stage outputs to `CheckpointStore` (SQLite) for resume
- **DeadLetterQueue**: Failed videos with error classification (transient/permanent), retryable with `--resume`
- **IdempotencyKeys**: Batch jobs use `video.contentHash + configHash` as key

### 2.4 Resource Management
```typescript
interface IResourcePool<T> {
  acquire(): Promise<PooledResource<T>>;
  release(resource: PooledResource<T>): void;
  stats(): { available: number; inUse: number; waiting: number };
}

// Pools:
FFmpegPool: max 3 concurrent (configurable)
WhisperPool: max 2 (GPU) or 1 (CPU)
TesseractPool: max CPU cores
```

### 2.4.5 Horizontal Scaling - WorkerPool Abstraction (NEW - Addresses PerformanceReviewer)
```typescript
// WorkerPool.ts - Distributed worker coordination
interface IWorkerPool {
  submit(job: VideoJob): Promise<JobHandle>;
  scale(targetWorkers: number): Promise<void>;
  stats(): WorkerPoolStats;
}

class LocalWorkerPool implements IWorkerPool {
  // Single-process implementation using resource pools
  async submit(job: VideoJob): Promise<JobHandle> { /* ... */ }
  async scale(n: number): Promise<void> { /* Adjust local pool sizes */ }
  stats(): WorkerPoolStats { /* ... */ }
}

class DistributedWorkerPool implements IWorkerPool {
  // Redis-backed coordination for multi-instance fleet
  private redis: RedisClient;
  private semaphore: DistributedSemaphore;
  
  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl);
    this.semaphore = new DistributedSemaphore(this.redis, 'vtn:workers');
  }
  
  async submit(job: VideoJob): Promise<JobHandle> {
    // 1. Acquire distributed permit (max 4 concurrent per worker)
    await this.semaphore.acquire(1, 30000);
    
    // 2. Serialize job to queue
    await this.redis.lpush('vtn:job:queue', JSON.stringify(job));
    
    // 3. Return handle with result polling
    return new DistributedJobHandle(job.id, this.redis);
  }
  
  async scale(targetWorkers: number): Promise<void> {
    // Publish scaling event for worker processes
    await this.redis.publish('vtn:scale', JSON.stringify({ target: targetWorkers }));
  }
  
  stats(): WorkerPoolStats {
    return { /* Query Redis for queue depth, active workers, etc. */ };
  }
}

interface WorkerPoolStats {
  queuedJobs: number;
  activeWorkers: number;
  completedLastHour: number;
  avgProcessingTimeMs: number;
  memoryPressure: 'low' | 'medium' | 'high';
}

// ConcurrencyController updated for distributed mode
class ConcurrencyController {
  private pool: IWorkerPool;
  private mode: 'local' | 'distributed';
  
  constructor(config: ConcurrencyConfig) {
    this.mode = config.distributed ? 'distributed' : 'local';
    this.pool = config.distributed 
      ? new DistributedWorkerPool(config.redisUrl)
      : new LocalWorkerPool();
  }
  
  async submitBatch(jobs: VideoJob[]): Promise<BatchHandle> {
    if (this.mode === 'local') {
      return this.submitLocalBatch(jobs);
    }
    return this.submitDistributedBatch(jobs);
  }
  
  private async submitLocalBatch(jobs: VideoJob[]): Promise<BatchHandle> {
    // Use local semaphores - optimal for 3-4 concurrent videos
    // Beyond that, memory pressure increases non-linearly
  }
  
  private async submitDistributedBatch(jobs: VideoJob[]): Promise<BatchHandle> {
    // Submit to distributed pool with priority queue
  }
}
```

### 2.5 Streaming Processing (Memory < 2GB for 1hr video)
- **FrameStream**: Async iterator yielding frames one at a time; bounded buffer (max 10 frames)
- **Backpressure**: `WritableStream` with highWaterMark between stages
- **IncrementalRender**: NoteRenderer writes sections as completed; flushes to disk
- **ModelSingleton**: Whisper/Tesseract models loaded once per process, reused across batch

---

## Phase 3: Infrastructure Adapters (Concrete Implementations)

### 3.1 Video Metadata Extractor (FFmpeg)
```typescript
class FfmpegVideoMetadataExtractor implements IVideoMetadataExtractor {
  async extract(path: ValidatedPath): Promise<VideoMetadata> {
    // ffprobe -v quiet -print_format json -show_format -show_streams -show_chapters
    // Parse: duration, resolution, codec, fps (rational), bitrate, chapters, subtitle tracks
    // Detect VFR: analyze frame timestamps vs constant framerate
    // Return normalized metadata with rational fps (30000/1001)
  }
}
```

### 3.2 Frame Extractor (FFmpeg - Adaptive)
```typescript
class FfmpegFrameExtractor implements IFrameExtractor {
  async *extractFrames(
    video: Video, 
    config: FrameExtractionConfig,
    signal: AbortSignal
  ): AsyncIterable<Frame> {
    // Strategy 1: Scene-based (primary)
    // ffmpeg -i input -vf "select='gt(scene,0.3)',showinfo" -fps_mode vfr frames/
    // Parse showinfo log for PTS timestamps
    
    // Strategy 2: Adaptive interval fallback
    // If scene detection yields < minFrames: fixed interval (configurable per preset)
    // Lecture: 1 frame/30s static, 2fps during changes
    // Tutorial: 1 frame/10s
    // Meeting: 1 frame/5s
    
    // Strategy 3: Transient text detection
    // High-freq sampling (2fps) in detected UI regions
    // Frame differencing for appearing/disappearing text
    
    // Yield frames one at a time (streaming)
  }
}

interface FrameExtractionConfig {
  preset: 'lecture' | 'tutorial' | 'meeting' | 'documentary' | 'custom';
  sceneThreshold: number;        // 0.2-0.4 adaptive
  minIntervalSec: number;        // Max frames when static
  maxIntervalSec: number;        // Min frames during action
  enableTransientDetection: boolean;
  maxFrames: number;             // Hard cap
  // Performance optimization
  fastExtract: boolean;          // Use FastFrameExtractor (direct PTS seek)
  fastIntervalSec?: number;      // Interval for fast mode (default 30s)
  // Spatial region detection for meetings
  enableRegionDetection: boolean; // Detect screen-share vs participant regions
  regionOfInterest?: 'screen-share' | 'participants' | 'all';
}
```

### 3.3 OCR Processor (Tesseract - Video-Optimized)
```typescript
class TesseractOCRProcessor implements IOCRProcessor {
  async process(frame: Frame, config: OCRConfig): Promise<OCRResult> {
    // 1. Preprocessing pipeline (OpenCV/sharp):
    //    - Grayscale → CLAHE contrast enhancement
    //    - Adaptive threshold (Sauvola) for uneven lighting
    //    - Deskew via Tesseract OSD (Orientation and Script Detection)
    //    - Denoise (NLM) for compression artifacts
    
    // 2. Text Detection first (EAST/DBNet via ONNX) → regions
    //    - Code/highlight detection via color clustering
    //    - Multi-frame super-resolution (3-5 adjacent frames) for text regions
    
    // 3. PSM Auto-selection:
    //    - PSM 6: Single uniform block (slides)
    //    - PSM 4: Single column (code)
    //    - PSM 11: Sparse text (UI)
    //    - PSM 3: Auto (fallback)
    
    // 4. Language packs: Dynamic load based on script detection
    //    - Latin: eng + osd
    //    - CJK: chi_sim + chi_tra + jpn + kor
    //    - RTL: ara + heb
    
    // 5. Confidence filtering: word-level > 70%, line-level > 80%
    //    - Return bounding boxes for spatial reconstruction
    //    - Flag low-confidence for review
  }
}
```

### 3.4 Audio Extractor (FFmpeg)
```typescript
class FfmpegAudioExtractor implements IAudioExtractor {
  async extract(video: Video, outputDir: Path, signal: AbortSignal): Promise<AudioFile> {
    // ffmpeg -i input -vn -acodec pcm_s16le -ar 16000 -ac 1 output.wav
    // 16kHz mono WAV optimal for Whisper
    // Stream to disk (not memory) - bounded temp file
    // Return path + duration + sample rate
  }
}
```

### 3.5 Transcription Engine (Whisper.cpp - Production Config)
```typescript
class WhisperTranscriptionEngine implements ITranscriptionEngine {
  private model: WhisperModel; // Singleton per process
  
  async transcribe(audio: AudioFile, config: TranscriptionConfig): Promise<Transcript> {
    // Model selection via ModelSelector (Phase 2.1.5) - auto-detects GPU/CPU
    // whisper.cpp args:
    //   --model base.int8 (or selected by ModelSelector)
    //   --language auto (or forced)
    //   --output-words (word-level timestamps)
    //   --output-json (structured output)
    //   --vad (Silero VAD filter)
    //   --prompt "prioritized vocabulary from OCR" (vocabulary boosting with budget)
    
    // Post-processing:
    //   - Punctuation restoration (bert-restore-punctuation)
    //   - Number formatting, acronym handling
    //   - Align segment timestamps to video PTS (master clock)
    //   - Adaptive model escalation if confidence low
    
    // Return Transcript with segments + word timestamps
  }
  
  async transcribeWithEscalation(audio: AudioFile, config: TranscriptionConfig): Promise<Transcript> {
    let result = await this.transcribe(audio, config);
    
    // Check average confidence (from whisper logprobs)
    const avgConfidence = this.calculateAvgConfidence(result);
    
    if (avgConfidence < config.escalationThreshold && config.enableEscalation) {
      // Escalate to larger model
      const escalatedConfig = { ...config, model: this.getNextLargerModel(config.model) };
      context.logger.info(`Escalating transcription: ${config.model} → ${escalatedConfig.model} (confidence: ${avgConfidence})`);
      result = await this.transcribe(audio, escalatedConfig);
    }
    
    return result;
  }
  
  private calculateAvgConfidence(transcript: Transcript): number {
    return transcript.segments.reduce((sum, s) => sum + s.confidence, 0) / transcript.segments.length;
  }
  
  private getNextLargerModel(current: string): string {
    const chain = ['tiny.int8', 'base.int8', 'small.int8', 'large-v3.int8'];
    const idx = chain.indexOf(current);
    return idx >= 0 && idx < chain.length - 1 ? chain[idx + 1] : current;
  }
}

interface TranscriptionConfig {
  model: 'tiny.int8' | 'base.int8' | 'small.int8' | 'large-v3.int8';
  language?: LanguageCode;       // Auto-detect if omitted
  enableVAD: boolean;            // Default true
  vocabularyBoost?: string[];    // Terms from OCR (pre-prioritized)
  wordTimestamps: boolean;       // Default true
  // Adaptive escalation
  enableEscalation: boolean;     // Default true
  escalationThreshold: number;   // Default 0.6 (60% avg confidence)
  maxEscalations: number;        // Default 2
}
```

### VocabularyPrioritizer.ts - Manages whisper.cpp prompt budget (224 tokens)
```typescript
class VocabularyPrioritizer {
  // whisper.cpp --prompt limited to 224 tokens
  private readonly MAX_PROMPT_TOKENS = 224;
  
  prioritize(ocrTerms: OCRTerm[], config: PrioritizerConfig): string[] {
    // Score each term
    const scored = ocrTerms.map(term => ({
      term: term.text,
      score: this.calculateScore(term),
    }));
    
    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);
    
    // Select top-N fitting token budget
    const selected: string[] = [];
    let tokenCount = 0;
    
    for (const { term } of scored) {
      const tokens = this.estimateTokens(term);
      if (tokenCount + tokens <= this.MAX_PROMPT_TOKENS) {
        selected.push(term);
        tokenCount += tokens;
      }
    }
    
    return selected;
  }
  
  private calculateScore(term: OCRTerm): number {
    let score = 0;
    
    // Frequency weight (appears on multiple frames)
    score += term.frequency * 10;
    
    // Confidence weight (high OCR confidence)
    score += term.confidence * 20;
    
    // Technicality heuristics
    if (this.isCamelCase(term.text)) score += 15;        // camelCase → code/technical
    if (this.hasSymbols(term.text)) score += 10;         // symbols → API/config
    if (this.isAcronym(term.text)) score += 12;          // ALL_CAPS → acronyms
    if (this.hasNumbers(term.text)) score += 8;          // versions, dates
    if (this.isFilePath(term.text)) score += 10;         // paths → technical
    
    // Penalize common words
    if (this.isStopWord(term.text)) score -= 20;
    
    return score;
  }
  
  private isCamelCase(text: string): boolean {
    return /[a-z][A-Z]/.test(text) && !text.includes(' ');
  }
  
  private hasSymbols(text: string): boolean {
    return /[{}()[\].,;:@#$%^&*+=|\\/<>-]/.test(text);
  }
  
  private isAcronym(text: string): boolean {
    return text.length >= 2 && text === text.toUpperCase() && /^[A-Z0-9]+$/.test(text);
  }
  
  private hasNumbers(text: string): boolean {
    return /\d/.test(text);
  }
  
  private isFilePath(text: string): boolean {
    return text.includes('/') || text.includes('\\') || text.startsWith('./') || text.startsWith('../');
  }
  
  private isStopWord(text: string): boolean {
    const stopWords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'a', 'an', 'is', 'are', 'was', 'were', 'this', 'that', 'these', 'those']);
    return stopWords.has(text.toLowerCase());
  }
  
  private estimateTokens(text: string): number {
    // Rough: 1 token ≈ 4 chars for English
    return Math.ceil(text.length / 4);
  }
}

interface OCRIterm {
  text: string;
  confidence: number;
  frequency: number;      // How many frames this appears on
  boundingBox: BoundingBox;
}

interface PrioritizerConfig {
  maxPromptTokens: number;  // Default 224
  minScore: number;         // Default 5
}
```

### 3.6 Scene Analyzer (PySceneDetect + ML)
```typescript
class PySceneDetectSceneAnalyzer implements ISceneAnalyzer {
  async analyze(video: Video, frames: Frame[]): Promise<Scene[]> {
    // ContentDetector: threshold 0.3 (adaptive 0.2-0.4)
    // AdaptiveDetector: for gradual transitions (fades, dissolves)
    // ThresholdOptimizer: learn per-content-type thresholds
    
    // Classify scenes:
    // - static-slide: low visual change, high OCR density
    // - talking-head: face detection + low OCR
    // - code: monospace font detection + syntax colors
    // - action: high motion vectors
    // - transition: gradual change, short duration
    
    // Return scenes with type, boundaries, key frames
  }
}
```

### 3.7 Note Renderers (Template-Driven)
```typescript
abstract class BaseNoteRenderer implements INoteRenderer {
  protected templateEngine: TemplateEngine; // Nunjucks
  
  abstract render(note: Note, outputPath: Path): Promise<void>;
  
  protected getTemplate(videoType: string): Template {
    // Built-in: lecture.njk, meeting.njk, tutorial.njk, documentary.njk
    // User: ~/.vtn/templates/*.njk (inheritance via extends)
    // Frontmatter-driven section activation
  }
}

class MarkdownNoteRenderer extends BaseNoteRenderer { /* ... */ }
class JsonNoteRenderer extends BaseNoteRenderer { /* ... */ }
class HtmlNoteRenderer extends BaseNoteRenderer { 
  // Embeds video player with timestamp sync
  // Client-side search (Fuse.js)
  // Collapsible TOC, print CSS
  // WCAG 2.2 AA: semantic headings, alt text, high contrast, prefers-reduced-motion
}
```

### 3.8 Configuration, Secrets & LLM Providers
```typescript
// Config Schema (Zod)
const ProcessingConfigSchema = z.object({
  frameExtraction: FrameExtractionConfigSchema,
  ocr: OCRConfigSchema,
  transcription: TranscriptionConfigSchema,
  note: NoteConfigSchema,
  privacy: z.enum(['local-only', 'cloud-opt-in']).default('local-only'),
  llm: LLMPConfigSchema,              // NEW: LLM provider configuration
  batch: z.object({
    maxConcurrent: z.number().min(1).max(10).default(3),
    checkpointInterval: z.number().min(1).default(5),
    resume: z.boolean().default(false),
  }),
});

// LLM Provider Configuration with cross-field validation
const LLMPConfigSchema = z.object({
  provider: z.enum([
    'harness',        // DeepSeek Harness built-in LLM (uses current session model)
    'deepseek',       // DeepSeek API (deepseek-chat, deepseek-coder)
    'openai',         // OpenAI API (gpt-4o, gpt-4o-mini, o1)
    'anthropic',      // Anthropic API (claude-3-5-sonnet, claude-3-opus)
    'google',         // Google API (gemini-1.5-pro, gemini-1.5-flash)
    'ollama',         // Local Ollama (llama3.1, mistral, codellama, etc.)
    'custom',         // Custom OpenAI-compatible endpoint
  ]).default('harness'),
  
  // Model: required for cloud providers, optional for harness (uses current session)
  model: z.string().optional(),
  
  // Harness-specific: override current session model for summarization
  harnessModel: z.string().optional(),
  
  // Custom endpoint (required when provider='custom')
  customEndpoint: z.object({
    baseUrl: z.string().url().refine(
      (url) => {
        // SSRF Protection: Block internal/private IPs and metadata endpoints
        try {
          const parsed = new URL(url);
          const hostname = parsed.hostname;
          
          // Block localhost and loopback
          if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;
          
          // Block private RFC1918 ranges
          const ipv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
          if (ipv4) {
            const [, a, b] = ipv4.map(Number);
            if (a === 10) return false;                    // 10.0.0.0/8
            if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
            if (a === 192 && b === 168) return false;      // 192.168.0.0/16
            if (a === 169 && b === 254) return false;      // 169.254.0.0/16 (link-local/metadata)
          }
          
          // Block AWS/GCP/Azure metadata endpoints
          const metadataHosts = [
            '169.254.169.254',
            'metadata.google.internal',
            'metadata.azure.com',
            'metadata',
            '[fd00:ec2::254]' // IPv6 metadata
          ];
          if (metadataHosts.includes(hostname)) return false;
          
          // DNS rebinding protection: resolve at config load, pin IP
          // (implementation: resolve DNS at config validation time, store resolved IP)
          
          return true;
        } catch {
          return false;
        }
      },
      { message: 'baseUrl blocked: internal IPs, localhost, metadata endpoints, and private networks are not allowed' }
    ),
    apiKey: z.string().min(1),
    model: z.string().min(1),
    // Headers: allowlist only safe headers; strip Authorization (handled separately)
    headers: z.record(z.string()).optional().transform((headers) => {
      if (!headers) return undefined;
      const allowed = ['content-type', 'accept', 'user-agent', 'x-request-id'];
      const sanitized: Record<string, string> = {};
      for (const [key, value] of Object.entries(headers)) {
        const lower = key.toLowerCase();
        if (allowed.includes(lower) && !/^(x-|authorization|cookie|set-cookie|proxy)/i.test(lower)) {
          sanitized[key] = value;
        }
      }
      return Object.keys(sanitized).length > 0 ? sanitized : undefined;
    }),
  }).optional(),
  
  // LLM parameters
  temperature: z.number().min(0).max(2).default(0.3),
  maxTokens: z.number().min(1).max(128000).default(8192),
  topP: z.number().min(0).max(1).default(0.95),
  
  // Model capability overrides (auto-detected if omitted)
  capabilities: z.object({
    supportsJSONMode: z.boolean().optional(),
    supportsToolUse: z.boolean().optional(),
    maxContextTokens: z.number().optional(),
    optimalTemperature: z.number().min(0).max(2).optional(),
    citationComplexity: z.enum(['simple', 'standard', 'rich']).optional(),
  }).optional(),
  
  // Context management for long content
  contextManagement: z.object({
    strategy: z.enum(['truncate', 'chunk', 'map-reduce']).default('map-reduce'),
    chunkOverlapTokens: z.number().default(512),
    maxChunkTokens: z.number().default(6000),
    synthesisTemperature: z.number().default(0.2),
  }).default({}),
  
  // Performance & resilience
  performance: z.object({
    timeoutMs: z.number().default(120000),
    maxRetries: z.number().default(3),
    retryBaseDelayMs: z.number().default(1000),
    circuitBreakerThreshold: z.number().default(5),
    fallbackProviders: z.array(z.string()).default([]),
    semanticCacheTTLMs: z.number().default(3600000),
  }).default({}),
  
  // Cost management
  cost: z.object({
    maxCostPerRequestUsd: z.number().optional(),
    dailyBudgetUsd: z.number().optional(),
    preferCheaperModel: z.boolean().default(true),
  }).optional(),
}).refine(
  (data) => {
    // Cross-field validation
    if (data.provider !== 'harness' && !data.model) return false;
    if (data.provider === 'custom' && !data.customEndpoint) return false;
    if (data.provider === 'harness' && data.customEndpoint) return false;
    return true;
  },
  { message: 'Invalid configuration: model required for cloud providers; customEndpoint required for custom provider; customEndpoint not allowed for harness' }
);

// Environment variable fallbacks
function getEnvConfig(): Partial<z.infer<typeof LLMPConfigSchema>> {
  return {
    provider: process.env.VTN_LLM_PROVIDER as any,
    model: process.env.VTN_LLM_MODEL,
    temperature: process.env.VTN_LLM_TEMPERATURE ? parseFloat(process.env.VTN_LLM_TEMPERATURE) : undefined,
    maxTokens: process.env.VTN_LLM_MAX_TOKENS ? parseInt(process.env.VTN_LLM_MAX_TOKENS) : undefined,
    // Provider-specific API keys
    customEndpoint: process.env.VTN_LLM_CUSTOM_ENDPOINT ? {
      baseUrl: process.env.VTN_LLM_CUSTOM_ENDPOINT!,
      apiKey: process.env.VTN_LLM_API_KEY || '',
      model: process.env.VTN_LLM_MODEL || '',
    } : undefined,
  };
}

// Merge: CLI args > config file > env vars > defaults
function resolveLLMConfig(cliArgs: any, configFile: any): z.infer<typeof LLMPConfigSchema> {
  const env = getEnvConfig();
  return LLMPConfigSchema.parse({ ...env, ...configFile?.llm, ...cliArgs });
}

// Model Provider (for Whisper/Tesseract - existing)
interface IModelProvider {
  getModel(name: string): Promise<ModelHandle>;
  listModels(): Promise<string[]>;
  downloadModel(name: string, progress: (p: number) => void): Promise<void>;
  verifyModel(name: string): Promise<boolean>;
}

// LLM Provider Capabilities (per-model)
interface LLMProviderCapabilities {
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
  costPer1kTokens?: number;
}

// LLM Provider Interface (Production-Ready)
interface ILLMProvider {
  // Core completion with timeout & retry
  complete(request: LLMRequest, options?: LLMCallOptions): Promise<LLMResponse>;
  
  // Streaming output
  completeStream(request: LLMRequest, options?: LLMCallOptions): AsyncIterable<LLMChunk>;
  
  // Structured output with fallback strategies
  completeStructured<T extends z.ZodTypeAny>(
    request: LLMRequest,
    schema: T,
    options?: LLMCallOptions
  ): Promise<z.infer<T>>;
  
  // Context streaming for large inputs
  completeWithContextStream(
    request: LLMRequest,
    contextStream: AsyncIterable<string>,
    options?: LLMCallOptions
  ): Promise<LLMResponse>;
  
  // Model info & discovery
  getModelInfo(): LLMModelInfo;
  listAvailableModels(): Promise<string[]>;
  
  // Health & monitoring
  healthCheck(): Promise<HealthStatus>;
  getUsageStats(): Promise<UsageStats>;
  
  // Capabilities
  getCapabilities(): LLMProviderCapabilities;
}

interface LLMCallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  priority?: 'low' | 'normal' | 'high';
  idempotencyKey?: string;
  skipCache?: boolean;
}

interface LLMRequest {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  // For grounded generation
  systemPrompt?: string;
  context?: string | AsyncIterable<string>;  // Source text or stream for grounding
  requireCitations?: boolean;
  citationFormat?: 'inline' | 'footnote' | 'bracket';
  // Context management
  contextStrategy?: 'truncate' | 'chunk' | 'map-reduce';
  maxContextTokens?: number;
  chunkOverlapTokens?: number;
}

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMResponse {
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  // Grounding metadata
  citations?: Citation[];
  groundednessScore?: number;
}

interface LLMChunk {
  delta: string;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

interface LLMModelInfo {
  provider: string;
  model: string;
  maxContextTokens: number;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsCitations: boolean;
}

interface HealthStatus {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  checkedAt: Date;
}

interface UsageStats {
  totalRequests: number;
  totalTokens: { prompt: number; completion: number };
  totalCostUsd: number;
  averageLatencyMs: number;
  errorRate: number;
}

interface Citation {
  text: string;
  source: 'ocr' | 'transcript' | 'scene';
  timestamp: string;
  frameId?: string;
  segmentId?: string;
  confidence: number;
}

// LLM Capabilities Registry
class LLMCapabilitiesRegistry {
  private caps = new Map<string, LLMProviderCapabilities>();
  private defaults: Record<string, LLMProviderCapabilities>;
  
  constructor() {
    this.defaults = {
      harness: { provider: 'harness', model: 'dynamic', supportsJSONMode: true, supportsToolUse: true, supportsStreaming: true, supportsStructuredOutput: true, supportsCitations: true, maxContextTokens: 128000, optimalTemperature: 0.3, citationComplexity: 'rich', averageLatencyMs: 500 },
      deepseek: { provider: 'deepseek', model: 'deepseek-chat', supportsJSONMode: true, supportsToolUse: true, supportsStreaming: true, supportsStructuredOutput: true, supportsCitations: true, maxContextTokens: 128000, optimalTemperature: 0.3, citationComplexity: 'rich', averageLatencyMs: 800, costPer1kTokens: 0.0014 },
      openai: { provider: 'openai', model: 'gpt-4o', supportsJSONMode: true, supportsToolUse: true, supportsStreaming: true, supportsStructuredOutput: true, supportsCitations: true, maxContextTokens: 128000, optimalTemperature: 0.3, citationComplexity: 'rich', averageLatencyMs: 1200, costPer1kTokens: 0.005 },
      anthropic: { provider: 'anthropic', model: 'claude-3-5-sonnet', supportsJSONMode: true, supportsToolUse: true, supportsStreaming: true, supportsStructuredOutput: true, supportsCitations: true, maxContextTokens: 200000, optimalTemperature: 0.3, citationComplexity: 'rich', averageLatencyMs: 1500, costPer1kTokens: 0.015 },
      google: { provider: 'google', model: 'gemini-1.5-pro', supportsJSONMode: true, supportsToolUse: true, supportsStreaming: true, supportsStructuredOutput: true, supportsCitations: true, maxContextTokens: 1000000, optimalTemperature: 0.3, citationComplexity: 'rich', averageLatencyMs: 1000, costPer1kTokens: 0.0035 },
      ollama: { provider: 'ollama', model: 'llama3.1:8b', supportsJSONMode: false, supportsToolUse: false, supportsStreaming: true, supportsStructuredOutput: false, supportsCitations: false, maxContextTokens: 8192, optimalTemperature: 0.1, citationComplexity: 'simple', averageLatencyMs: 2000 },
      custom: { provider: 'custom', model: 'dynamic', supportsJSONMode: true, supportsToolUse: true, supportsStreaming: true, supportsStructuredOutput: true, supportsCitations: true, maxContextTokens: 32768, optimalTemperature: 0.3, citationComplexity: 'standard', averageLatencyMs: 2000 },
    };
    for (const [k, v] of Object.entries(this.defaults)) this.caps.set(k, v);
  }
  
  async detect(provider: ILLMProvider): Promise<LLMProviderCapabilities> {
    const info = await provider.getModelInfo();
    const d = this.defaults[info.provider] || this.defaults.custom;
    return { ...d, model: info.model, supportsJSONMode: info.supportsStructuredOutput, supportsToolUse: info.supportsStructuredOutput, supportsStructuredOutput: info.supportsStructuredOutput, supportsCitations: info.supportsCitations, maxContextTokens: info.maxContextTokens };
  }
  
  get(key: string): LLMProviderCapabilities | undefined { return this.caps.get(key); }
  set(key: string, caps: LLMProviderCapabilities): void { this.caps.set(key, caps); }
}
```

### Context-Aware Summarizer (Map-Reduce for Long Content)
```typescript
class ContextAwareSummarizer implements ISummarizer {
  constructor(
    private llm: ILLMProvider,
    private caps: LLMCapabilitiesRegistry,
    private citationNormalizer: CitationNormalizer,
    private groundednessValidator: GroundednessValidator,
    private structuredOutputCoordinator: StructuredOutputCoordinator
  ) {}
  
  async summarize(
    alignedContent: AlignedContentBlock[],
    config: SummarizationConfig
  ): Promise<NoteSection[]> {
    const capabilities = await this.caps.detect(this.llm);
    const promptBuilder = new ModelAwarePromptBuilder(capabilities);
    
    // Estimate total token count
    const context = this.buildContext(alignedContent);
    const estimatedTokens = this.estimateTokens(context) + config.maxTokens;
    
    if (estimatedTokens > capabilities.maxContextTokens * 0.8) {
      // Use map-reduce for long content
      return this.summarizeMapReduce(alignedContent, config, capabilities, promptBuilder);
    }
    
    return this.summarizeSinglePass(alignedContent, config, capabilities, promptBuilder);
  }
  
  private async summarizeMapReduce(
    alignedContent: AlignedContentBlock[],
    config: SummarizationConfig,
    caps: LLMProviderCapabilities,
    promptBuilder: ModelAwarePromptBuilder
  ): Promise<NoteSection[]> {
    // 1. Chunk by scene/timestamp (semantic boundaries)
    const chunks = this.chunkByScene(alignedContent, caps.maxContextTokens * 0.6);
    
    // 2. Parallel summarize each chunk
    const chunkSummaries = await Promise.all(
      chunks.map((chunk, i) => this.summarizeChunk(chunk, i, chunks.length, config, caps, promptBuilder))
    );
    
    // 3. Synthesize final note from chunk summaries
    const synthesisContext = chunkSummaries.map((s, i) => `Chunk ${i+1}:\n${s}`).join('\n\n---\n\n');
    const synthesisPrompt = promptBuilder.buildSynthesisPrompt(config);
    
    const request: LLMRequest = {
      messages: [
        { role: 'system', content: synthesisPrompt },
        { role: 'user', content: synthesisContext }
      ],
      temperature: config.synthesisTemperature ?? 0.2,
      maxTokens: config.maxTokens,
      requireCitations: true,
      citationFormat: 'bracket',
    };
    
    const schema = this.getSummarySchema();
    const result = await this.structuredOutputCoordinator.executeWithFallback(
      this.llm, request, schema, caps
    );
    
    return this.citationNormalizer.normalizeAndValidate(result.sections, alignedContent);
  }
  
  private async summarizeChunk(
    chunk: AlignedContentBlock[],
    index: number,
    total: number,
    config: SummarizationConfig,
    caps: LLMProviderCapabilities,
    promptBuilder: ModelAwarePromptBuilder
  ): Promise<string> {
    const context = this.buildContext(chunk);
    const prompt = promptBuilder.buildChunkPrompt(config, index, total);
    
    const request: LLMRequest = {
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: context }
      ],
      temperature: caps.optimalTemperature,
      maxTokens: Math.min(config.maxTokens, 4000),
      requireCitations: true,
      citationFormat: 'bracket',
    };
    
    const schema = this.getChunkSchema();
    const result = await this.structuredOutputCoordinator.executeWithFallback(
      this.llm, request, schema, caps
    );
    
    return this.citationNormalizer.normalizeAndValidate(result.sections, chunk);
  }
  
  private async summarizeSinglePass(
    alignedContent: AlignedContentBlock[],
    config: SummarizationConfig,
    caps: LLMProviderCapabilities,
    promptBuilder: ModelAwarePromptBuilder
  ): Promise<NoteSection[]> {
    const context = this.buildContext(alignedContent);
    const prompt = promptBuilder.buildSinglePassPrompt(config);
    
    const request: LLMRequest = {
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: context }
      ],
      temperature: caps.optimalTemperature,
      maxTokens: config.maxTokens,
      topP: 0.95,
      requireCitations: true,
      citationFormat: 'bracket',
    };
    
    const schema = this.getSummarySchema();
    const result = await this.structuredOutputCoordinator.executeWithFallback(
      this.llm, request, schema, caps
    );
    
    return this.citationNormalizer.normalizeAndValidate(result.sections, alignedContent);
  }
}
```

### Structured Output Coordinator (Multi-Strategy Fallback)
```typescript
class StructuredOutputCoordinator {
  async executeWithFallback<T>(
    llm: ILLMProvider,
    request: LLMRequest,
    schema: z.ZodType<T>,
    caps: LLMProviderCapabilities
  ): Promise<T> {
    const strategies = this.buildStrategyChain(caps);
    
    for (const strategy of strategies) {
      try {
        const result = await strategy.execute(llm, request, schema);
        if (this.validateResult(result, schema)) {
          return result;
        }
      } catch (e) {
        // Log and try next strategy
        console.warn(`Strategy ${strategy.name} failed: ${e.message}`);
      }
    }
    
    throw new Error('All structured output strategies failed');
  }
  
  private buildStrategyChain(caps: LLMProviderCapabilities): OutputStrategy[] {
    const chain: OutputStrategy[] = [];
    
    // Strategy 1: Native JSON mode (OpenAI, Anthropic, Google, DeepSeek, Harness, Custom)
    if (caps.supportsStructuredOutput) {
      chain.push(new NativeJSONStrategy());
    }
    
    // Strategy 2: Tool/Function calling (OpenAI, Anthropic, Google, Harness)
    if (caps.supportsToolUse) {
      chain.push(new ToolCallingStrategy());
    }
    
    // Strategy 3: Regex repair + retry (all providers)
    chain.push(new RegexRepairStrategy(3)); // max 3 retries
    
    // Strategy 4: Guided JSON with schema in prompt (fallback for Ollama, etc.)
    chain.push(new GuidedRetryStrategy(2)); // max 2 retries
    
    return chain;
  }
  
  private validateResult<T>(result: T, schema: z.ZodType<T>): boolean {
    const parsed = schema.safeParse(result);
    return parsed.success;
  }
}

interface OutputStrategy {
  name: string;
  execute<T>(llm: ILLMProvider, request: LLMRequest, schema: z.ZodType<T>): Promise<T>;
}

// Implementation strategies...
```

### Citation Normalizer & Groundedness Validator
```typescript
class CitationNormalizer {
  normalizeAndValidate(sections: NoteSection[], source: AlignedContentBlock[]): NoteSection[] {
    for (const section of sections) {
      for (const citation of this.extractCitations(section.content)) {
        const normalized = this.normalize(citation);
        const validated = this.validate(normalized, source);
        if (!validated.valid) {
          section.content = this.flagCitation(section.content, citation, validated.reason);
        } else {
          section.content = this.replaceCitation(section.content, citation, validated.canonical);
        }
      }
    }
    return sections;
  }
  
  private normalize(citation: string): Citation {
    // Parse [00:12:34], [00:12:34.567], [00:12:34:frame_045], [00:12:34:seg_12]
    // Return canonical { timestamp, sourceId, type }
  }
  
  private validate(citation: Citation, source: AlignedContentBlock[]): { valid: boolean; canonical: Citation; reason?: string } {
    // Check timestamp exists in source, find nearest frame/segment
    // Return canonical citation with correct precision
  }
}

class GroundednessValidator {
  async validate(summary: string, source: AlignedContentBlock[]): Promise<GroundednessReport> {
    // Split summary into atomic claims
    const claims = this.extractClaims(summary);
    
    // For each claim, check if supported by source (embedding similarity or LLM judge)
    const results = await Promise.all(
      claims.map(claim => this.checkClaim(claim, source))
    );
    
    const supported = results.filter(r => r.supported).length;
    const score = supported / claims.length;
    
    return { score, claims: results, threshold: 0.9 };
  }
  
  private async checkClaim(claim: string, source: AlignedContentBlock[]): Promise<ClaimCheck> {
    // Embedding-based: claim embedding vs source chunk embeddings
    // Or LLM judge: "Does the source support this claim? Cite evidence."
  }
}
```

### Model-Aware Prompt Builder
```typescript
class ModelAwarePromptBuilder {
  constructor(private caps: LLMCapabilitiesRegistry) {}
  
  buildSinglePassPrompt(config: SummarizationConfig): string {
    return this.buildBasePrompt(config) + this.getCitationInstructions(config);
  }
  
  buildChunkPrompt(config: SummarizationConfig, index: number, total: number): string {
    return `You are summarizing chunk ${index}/${total} of a longer video.
${this.getCitationInstructions(config)}
Focus on this chunk only. Use citations from this chunk.`;
  }
  
  buildSynthesisPrompt(config: SummarizationConfig): string {
    return `You are synthesizing a final note from ${config.detailLevel} chunk summaries.
${this.getCitationInstructions(config)}
Merge overlapping content, preserve all citations, create coherent flow.`;
  }
  
  private getCitationInstructions(config: SummarizationConfig): string {
    const complexity = config.citationComplexity || 'standard';
    switch (complexity) {
      case 'simple':
        return 'Cite sources using [MM:SS] format only. Example: "The speaker introduced transformers [03:45]."';
      case 'standard':
        return 'Cite sources using [MM:SS] for transcript or [MM:SS:frame_N] for visual content. Example: "Slide showed architecture diagram [02:15:frame_012]."';
      case 'rich':
        return 'Cite using [MM:SS.mmm] for precise transcript or [MM:SS.mmm:frame_NNN:OCR] / [MM:SS.mmm:seg_N:TRANSCRIPT]. Distinguish visual vs spoken sources. Example: "The loss function was displayed on screen [05:22.147:frame_045:OCR] and explained verbally [05:23.012:seg_8:TRANSCRIPT]."';
    }
  }
  
  // Adjust prompt for model capability
  adaptForModel(prompt: string, caps: LLMProviderCapabilities): string {
    if (caps.citationComplexity === 'simple') {
      return this.simplifyPrompt(prompt);
    }
    if (!caps.supportsStructuredOutput) {
      return this.addFewShotExamples(prompt);
    }
    return prompt;
  }
}
```

### LLM Provider Pool (Connection Pooling, Rate Limiting, Circuit Breaker)
```typescript
class LLMProviderPool {
  private pools = new Map<string, ProviderPool>();
  private rateLimiters = new Map<string, TokenBucketRateLimiter>();
  private circuitBreakers = new Map<string, CircuitBreaker>();
  
  constructor(private config: PoolConfig) {
    // Initialize per-provider pools
    for (const providerName of ['harness', 'deepseek', 'openai', 'anthropic', 'google', 'ollama', 'custom']) {
      const caps = DEFAULT_PROVIDER_CAPABILITIES[providerName];
      this.pools.set(providerName, new ProviderPool(caps));
      this.rateLimiters.set(providerName, new TokenBucketRateLimiter(caps.costPer1kTokens ? 1000000 : Infinity));
      this.circuitBreakers.set(providerName, new CircuitBreaker(5, 60000));
    }
  }
  
  async execute<T>(
    providerName: string,
    fn: (provider: ILLMProvider) => Promise<T>,
    options: { priority?: 'low' | 'normal' | 'high'; timeoutMs?: number } = {}
  ): Promise<T> {
    const pool = this.pools.get(providerName);
    const rateLimiter = this.rateLimiters.get(providerName);
    const breaker = this.circuitBreakers.get(providerName);
    
    if (breaker.isOpen) {
      throw new Error(`Circuit breaker open for ${providerName}`);
    }
    
    await rateLimiter.acquire(1); // Token budget
    const permit = await pool.acquire(options.priority);
    
    try {
      const provider = await pool.getProvider();
      const result = await fn(provider);
      breaker.recordSuccess();
      return result;
    } catch (e) {
      breaker.recordFailure();
      throw e;
    } finally {
      pool.release(permit);
    }
  }
}
```

### Semantic Cache Layer
```typescript
class LLMSemanticCache {
  private cache = new Map<string, CacheEntry>();
  private ttlMs: number;
  
  constructor(ttlMs = 3600000) { this.ttlMs = ttlMs; }
  
  async get(key: string): Promise<LLMResponse | null> {
    const entry = this.cache.get(key);
    if (!entry || Date.now() > entry.expiresAt) return null;
    return entry.value;
  }
  
  async set(key: string, value: LLMResponse): Promise<void> {
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
  
  makeKey(request: LLMRequest, configHash: string): string {
    // Hash of: messages + systemPrompt + temperature + maxTokens + configHash
    return hash(JSON.stringify({ ...request, configHash }));
  }
}
```

### CLI Error Codes for LLM Providers
```bash
# LLM-specific error codes
VTN_E_LLM_API_KEY_MISSING: "API key required for provider. Set via --llm-api-key, VTN_LLM_API_KEY env, or Harness secrets."
VTN_E_LLM_MODEL_NOT_FOUND: "Model not found. Run 'vtn models list --provider <provider>' to see available models."
VTN_E_LLM_ENDPOINT_UNREACHABLE: "Cannot reach LLM endpoint. Check network, baseUrl, and firewall."
VTN_E_LLM_RATE_LIMITED: "Rate limit exceeded. Wait or configure fallback provider."
VTN_E_LLM_QUOTA_EXCEEDED: "API quota exceeded. Check billing or switch provider."
VTN_E_LLM_TIMEOUT: "LLM request timed out. Increase --llm-timeout or use faster model."
VTN_E_LLM_STRUCTURED_OUTPUT_FAILED: "Failed to parse structured output after all fallback strategies."
VTN_E_LLM_CONTEXT_TOO_LARGE: "Context exceeds model limit. Use --context-strategy map-reduce."
VTN_E_HARNESS_MODEL_UNAVAILABLE: "Harness LLM unavailable. Configure fallback provider with --llm-fallback."
```

### Doctor Command - LLM Provider Checks
```bash
vtn doctor
# Checks:
# ✓ FFmpeg / Tesseract / Whisper
# ✓ LLM Provider connectivity
#   - Harness: session model accessible, fallback chain configured
#   - DeepSeek: API key valid, models listable, rate limit status
#   - OpenAI: API key valid, models listable, quota status
#   - Anthropic: API key valid, models listable, quota status
#   - Google: API key valid, models listable, quota status
#   - Ollama: server running, models pulled, digest verification
#   - Custom: endpoint reachable, auth valid, models listable
# ✓ Rate limit / quota status per provider
# ✓ Context window vs estimated usage for current config
# ✓ Fallback chain validity (all providers in chain healthy)
```

### Health Check with Fallback (HarnessLLMProvider)
```typescript
class HarnessLLMProvider implements ILLMProvider {
  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      // Lightweight request: 1-token completion
      await this.complete({
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 1,
      }, { timeoutMs: 5000 });
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (e) {
      return { healthy: false, latencyMs: Date.now() - start, error: e.message };
    }
  }
  
  // Fallback to next provider in chain when Harness unavailable
  async completeWithFallback(request: LLMRequest, fallbackProviders: string[]): Promise<LLMResponse> {
    try {
      return await this.complete(request);
    } catch (e) {
      if (fallbackProviders.length === 0) throw e;
      
      // Try each fallback provider
      for (const fb of fallbackProviders) {
        const fallback = await this.getProvider(fb);
        try {
          return await fallback.complete(request);
        } catch {
          continue; // Try next fallback
        }
      }
      throw new Error(`All fallback providers failed: ${fallbackProviders.join(', ')}`);
    }
  }
}
```

### Wizard (vtn init) - LLM Provider Setup
```bash
vtn init
# 1. Detect available providers (Harness session, Ollama local, cloud APIs)
# 2. Prompt: "Select default LLM provider for summarization:"
#    [1] Harness (current session model) - RECOMMENDED
#    [2] DeepSeek API
#    [3] OpenAI API
#    [4] Anthropic API
#    [5] Google Gemini
#    [6] Ollama (local)
#    [7] Custom endpoint
# 3. If cloud: prompt for API key (stored in Harness secrets)
# 4. If Ollama: check server, offer to pull recommended model (llama3.1:8b)
# 5. Test connection, verify model access
# 6. Save to config
```

### Configuration Documentation
```markdown
# CONFIGURATION.md - LLM Provider Section

## Environment Variables
VTN_LLM_PROVIDER=harness|deepseek|openai|anthropic|google|ollama|custom
VTN_LLM_MODEL=gpt-4o|claude-3-5-sonnet|llama3.1:8b|...
VTN_LLM_API_KEY=sk-... (for cloud providers)
VTN_LLM_CUSTOM_ENDPOINT=http://localhost:8000/v1
VTN_LLM_TEMPERATURE=0.3
VTN_LLM_MAX_TOKENS=8192

## Priority: CLI flags > config file > env vars > defaults
```

### Cross-Provider Model Listing & Verification
```typescript
// All cloud providers implement listAvailableModels() via their APIs
async listAvailableModels(): Promise<string[]> {
  // OpenAI: GET /v1/models
  // Anthropic: Not directly available (use known list + model validation)
  // Google: GET /v1/models
  // DeepSeek: GET /v1/models
  // Custom: GET /v1/models (OpenAI-compatible)
  // Ollama: GET /api/tags
  // Harness: Uses session model (dynamic)
}
```

### Health Check Implementation
```typescript
async healthCheck(): Promise<HealthStatus> {
  const start = Date.now();
  try {
    // Lightweight request: 1-token completion
    await this.complete({
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 1,
    }, { timeoutMs: 5000 });
    return { healthy: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { healthy: false, latencyMs: Date.now() - start, error: e.message };
  }
}
```

### Usage Stats & Cost Tracking
```typescript
interface UsageStats {
  totalRequests: number;
  totalTokens: { prompt: number; completion: number };
  totalCostUsd: number;
  averageLatencyMs: number;
  errorRate: number;
}
```
  delta: string;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
}

interface LLMModelInfo {
  provider: string;
  model: string;
  maxContextTokens: number;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsCitations: boolean;
}

// Secrets via Harness Secret Provider
interface ISecretProvider {
  get(key: 'whisper-api-key' | 'videodb-api-key' | 'deepseek-api-key' | 'openai-api-key' | 'anthropic-api-key' | 'google-api-key' | 'custom-llm-api-key'): Promise<string | null>;
}
```

### LLM Provider Adapters (Infrastructure Layer)
```typescript
// HarnessLLMProvider - Uses DeepSeek Harness built-in LLM (current session model)
class HarnessLLMProvider implements ILLMProvider {
  constructor(private harness: HarnessLLMClient) {}
  
  async complete(request: LLMRequest): Promise<LLMResponse> {
    // Uses current Harness session's model via dsh-llm
    // Supports all models configured in Harness (DeepSeek, OpenAI, Anthropic, etc.)
    return this.harness.chat.completions.create({
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      top_p: request.topP,
    });
  }
  
  async completeStructured<T>(request: LLMRequest, schema: z.ZodType<T>): Promise<T> {
    // Uses Harness structured output if available, otherwise JSON mode + validation
    const response = await this.complete({
      ...request,
      messages: [
        ...request.messages,
        { role: 'system', content: `Output valid JSON matching this schema: ${JSON.stringify(schema.shape)}` }
      ]
    });
    return schema.parse(JSON.parse(response.content));
  }
  
  getModelInfo(): LLMModelInfo {
    return {
      provider: 'harness',
      model: this.harness.getCurrentModel(),
      maxContextTokens: this.harness.getContextWindow(),
      supportsStreaming: true,
      supportsStructuredOutput: true,
      supportsCitations: true,
    };
  }
}

// DeepSeekLLMProvider - Direct DeepSeek API
class DeepSeekLLMProvider implements ILLMProvider {
  constructor(private apiKey: string, private baseUrl = 'https://api.deepseek.com') {}
  
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        stream: false,
      }),
    });
    return response.json();
  }
  // ... other methods
}

// OpenAILLMProvider - OpenAI API (GPT-4o, GPT-4o-mini, o1, etc.)
class OpenAILLMProvider implements ILLMProvider {
  constructor(private apiKey: string, private baseUrl = 'https://api.openai.com') {}
  // ... standard OpenAI chat completions
}

// AnthropicLLMProvider - Claude API (Claude 3.5 Sonnet, Opus, etc.)
class AnthropicLLMProvider implements ILLMProvider {
  constructor(private apiKey: string, private baseUrl = 'https://api.anthropic.com') {}
  // ... Anthropic messages API
}

// GoogleLLMProvider - Gemini API (Gemini 1.5 Pro, Flash, etc.)
class GoogleLLMProvider implements ILLMProvider {
  constructor(private apiKey: string, private baseUrl = 'https://generativelanguage.googleapis.com') {}
  // ... Google Generative Language API
}

// OllamaLLMProvider - Local Ollama (llama3.1, mistral, codellama, qwen2.5, etc.)
class OllamaLLMProvider implements ILLMProvider {
  private modelDigests = new Map<string, string>(); // model -> sha256 digest
  
  constructor(
    private baseUrl = 'http://localhost:11434',
    private allowedModels: Map<string, string> = new Map() // model -> expected sha256 digest
  ) {
    // Load pinned digests from skills-lock.json style config
    this.loadPinnedDigests();
  }
  
  private loadPinnedDigests(): void {
    // Load from .vtn/models-lock.json or config
    // Format: { "llama3.1:8b": "sha256:abc123...", "mistral:7b": "sha256:def456..." }
    // For now, using default allowed models without strict pinning
    // In production, load from config file
    this.allowedModels.set('llama3.1:8b', '');
    this.allowedModels.set('llama3.1:70b', '');
    this.allowedModels.set('mistral:7b', '');
    this.allowedModels.set('codellama:13b', '');
    this.allowedModels.set('qwen2.5:7b', '');
    this.allowedModels.set('qwen2.5:14b', '');
  }
  
  async listAvailableModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`);
    const data = await response.json();
    return data.models.map((m: any) => m.name);
  }
  
  async verifyModel(model: string): Promise<boolean> {
    // Check if model is in allowed list
    if (!this.allowedModels.has(model)) {
      return false;
    }
    
    // Verify model digest if pinned
    const expectedDigest = this.allowedModels.get(model);
    if (expectedDigest) {
      try {
        const response = await fetch(`${this.baseUrl}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: model }),
        });
        const data = await response.json();
        // Ollama returns model info including digest
        const actualDigest = data.details?.digest || data.digest;
        if (actualDigest && actualDigest !== expectedDigest) {
          console.warn(`Model digest mismatch for ${model}: expected ${expectedDigest}, got ${actualDigest}`);
          return false;
        }
      } catch (e) {
        console.warn(`Failed to verify model digest for ${model}: ${e.message}`);
        return false;
      }
    }
    return true;
  }
  
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model || 'llama3.1';
    
    // Verify model before use
    if (!(await this.verifyModel(model))) {
      throw new Error(`Model '${model}' not allowed or digest mismatch. Allowed: ${Array.from(this.allowedModels.keys()).join(', ')}`);
    }
    
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: request.messages,
        options: { temperature: request.temperature, num_predict: request.maxTokens },
        stream: false,
      }),
    });
    return response.json();
  }
  
  async getModelInfo(): Promise<LLMModelInfo> {
    return {
      provider: 'ollama',
      model: 'llama3.1',
      maxContextTokens: 8192,
      supportsStreaming: true,
      supportsStructuredOutput: false,
      supportsCitations: false,
    };
  }
}

// CustomLLMProvider - Any OpenAI-compatible endpoint (vLLM, TGI, LocalAI, etc.)
class CustomLLMProvider implements ILLMProvider {
  constructor(private config: CustomEndpointConfig) {}
  
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const response = await fetch(`${this.config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        stream: false,
      }),
    });
    return response.json();
  }
}
```

### Summarization Stage - LLM-Agnostic Grounded Generation
```typescript
// LLM Response Sanitizer (Security: prevents XSS/injection in rendered notes)
class LLMSanitizer {
  private static readonly DANGEROUS_PATTERNS = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /data:/gi,
    /on\w+\s*=/gi,
    /<iframe/gi,
    /<object/gi,
    /<embed/gi,
    /<form/gi,
    /<input/gi,
    /<link/gi,
    /<meta/gi,
  ];
  
  static sanitize(content: string): string {
    let sanitized = content;
    for (const pattern of this.DANGEROUS_PATTERNS) {
      sanitized = sanitized.replace(pattern, '');
    }
    // Also sanitize markdown links with dangerous protocols
    sanitized = sanitized.replace(/\[([^\]]+)\]\((javascript|data|vbscript):[^)]+\)/gi, '[$1](#blocked)');
    return sanitized;
  }
  
  static sanitizeNoteSections(sections: NoteSection[]): NoteSection[] {
    return sections.map(section => ({
      ...section,
      content: this.sanitize(section.content),
      subsections: section.subsections ? this.sanitizeNoteSections(section.subsections) : undefined,
    }));
  }
}

class GroundedSummarizer implements ISummarizer {
  constructor(
    private llm: ILLMProvider,
    private citationFormatter: CitationFormatter,
    private sanitizer: LLMSanitizer = new LLMSanitizer()
  ) {}
  
  async summarize(
    alignedContent: AlignedContentBlock[],  // OCR + transcript + scenes by timestamp
    config: SummarizationConfig
  ): Promise<NoteSection[]> {
    // Build context from aligned content
    const context = this.buildContext(alignedContent);
    
    // System prompt for grounded summarization with citations
    const systemPrompt = this.buildSystemPrompt(config);
    
    const request: LLMRequest = {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Source content:\n${context}\n\nGenerate structured summary with citations.` }
      ],
      temperature: config.temperature ?? 0.3,
      maxTokens: config.maxTokens ?? 8192,
      topP: config.topP ?? 0.95,
      requireCitations: true,
      citationFormat: 'bracket',  // [timestamp:frameId] or [timestamp:segmentId]
    };
    
    // Use structured output for reliable parsing
    const schema = this.getSummarySchema();
    const result = await this.llm.completeStructured(request, schema);
    
    // Post-process: verify citations against source, format timestamps
    const sections = this.verifyAndFormatCitations(result.sections, alignedContent);
    
    // SECURITY: Sanitize LLM output before rendering
    return this.sanitizer.sanitizeNoteSections(sections);
  }
  
  private buildSystemPrompt(config: SummarizationConfig): string {
    return `You are an expert technical content summarizer. 
Generate a structured summary with the following requirements:
1. Every claim MUST be grounded in the provided source content
2. Use citations in format [timestamp] or [timestamp:frameId] for every factual statement
3. Distinguish between visual content (OCR from frames) and spoken content (transcript)
4. Flag any gaps where source content is missing or contradictory
5. Output structured sections matching the NoteSchema v1.0 hierarchy
6. Do not hallucinate - if information is not in source, mark as [NOT_IN_SOURCE]`;
  }
  
  private verifyAndFormatCitations(sections: NoteSection[], source: AlignedContentBlock[]): NoteSection[] {
    // Verify each citation points to actual source content
    // Convert internal timestamps to display format (HH:MM:SS.mmm)
    // Cross-reference visual and audio citations
    return sections;
  }
}

interface SummarizationConfig {
  template: 'lecture' | 'meeting' | 'tutorial' | 'documentary' | 'custom';
  temperature: number;
  maxTokens: number;
  topP: number;
  requireCitations: boolean;
  citationFormat: 'inline' | 'footnote' | 'bracket';
  detailLevel: 'executive' | 'standard' | 'comprehensive';
}
```

### CLI Integration - Model Selection
```bash
# LLM provider selection (short flags: -p, -m, -H)
vtn analyze video.mp4 -p harness                    # Use current Harness model (default)
vtn analyze video.mp4 -p deepseek                   # DeepSeek API
vtn analyze video.mp4 -p openai                     # OpenAI API (GPT-4o, etc.)
vtn analyze video.mp4 -p anthropic                  # Anthropic API (Claude)
vtn analyze video.mp4 -p google                     # Google API (Gemini)
vtn analyze video.mp4 -p ollama                     # Local Ollama
vtn analyze video.mp4 -p custom --llm-endpoint http://localhost:8000/v1 -m llama3.1

# Model override (-m for cloud/custom, -H for Harness-specific override)
vtn analyze video.mp4 -p openai -m gpt-4o
vtn analyze video.mp4 -p ollama -m llama3.1:70b

# Harness model override (-H, uses different model than current session)
vtn analyze video.mp4 -p harness -H deepseek-coder

# LLM parameters
vtn analyze video.mp4 -t 0.1 --max-tokens 4096 --top-p 0.9

# List available models for each provider
vtn models list -p ollama
vtn models list -p openai
vtn models list -p harness

# Verify model access and connectivity
vtn models verify -p openai -m gpt-4o
vtn models verify -p ollama -m llama3.1:8b
```

### CLI Flag Reference
| Flag | Short | Description |
|------|-------|-------------|
| `--llm-provider` | `-p` | Provider: harness, deepseek, openai, anthropic, google, ollama, custom |
| `--llm-model` | `-m` | Model name (required for cloud/custom providers) |
| `--harness-model` | `-H` | Override Harness session model (only for `-p harness`) |
| `--llm-endpoint` | | Custom endpoint base URL (required for `-p custom`) |
| `--llm-api-key` | | API key (or use VTN_LLM_API_KEY env / Harness secrets) |
| `--temperature` | `-t` | Sampling temperature (0.0-2.0) |
| `--max-tokens` | | Max completion tokens |
| `--top-p` | | Nucleus sampling threshold |
| `--llm-fallback` | | Fallback provider list (comma-separated) |
| `--context-strategy` | | truncate, chunk, map-reduce |
| `--llm-timeout` | | Request timeout in ms |
| `--llm-fallback` | | Fallback provider chain |

---

## Phase 4: Interface Adapters

### 4.1 CLI Adapter (User-Facing)
```bash
# Command hierarchy
vtn analyze <video.mp4> [options]
vtn batch <folder> [options]
vtn init                    # Interactive wizard
vtn doctor                  # Validate FFmpeg/Tesseract/Whisper
vtn models list             # Available Whisper models
vtn models pull base.int8   # Download with progress
vtn models verify           # Checksum validation
vtn config show             # Resolved config (global→project→video)
vtn config presets          # List lecture/tutorial/meeting/doc
vtn batch --resume          # Resume from checkpoint
vtn batch --dry-run         # Show what would process

# Progress Protocol (JSON Lines to stdout)
{"stage":"frame_extract","percent":23,"current":"frame_0045.jpg","eta":45,"throughput":"12fps"}
{"stage":"transcribe","percent":67,"current":"segment_12","eta":18,"throughput":"3.2x realtime"}

# Error Codes (machine-parseable)
VTN_E_FFMPEG_MISSING: "FFmpeg not found. Install: brew install ffmpeg"
VTN_E_OCR_LOW_CONFIDENCE: "Frame 0045 OCR confidence 42% < 70%. Try --ocr-preset=document"
VTN_E_WHISPER_MODEL_MISSING: "Model base.int8 not found. Run: vtn models pull base.int8"
VTN_E_VIDEO_CORRUPT: "Cannot decode video.mp4. Check file integrity."

# Cancellation Contract
# SIGINT: Finish current frame, flush partial note with [INCOMPLETE], cleanup, exit 130
# SIGTERM: Hard stop, checkpoint, exit 143
```

### 4.2 Harness Plugin Adapter
```typescript
// dsh-plugin manifest
{
  "name": "video-to-notes",
  "version": "0.1.0",
  "permissions": [
    "read:video-input",
    "write:notes-output", 
    "exec:ffmpeg",
    "net:cloud-opt-in"  // Only granted after user consent
  ],
  "skills": [
    { "id": "video-content-extractor", "version": "pinned-commit-hash" },
    { "id": "audio-transcriber", "version": "pinned-commit-hash" },
    { "id": "watch-igaming", "version": "pinned-commit-hash" }
  ],
  "entryPoints": {
    "cli": "dist/cli.js",
    "web": "dist/web-panel.js"  // Drag-drop, live progress, note preview
  },
  "lifecycle": {
    "onLoad": "initializeModels()",      // Load Whisper/Tesseract models
    "onUnload": "cleanupResources()"     // Release model memory, close pools
  }
}

// Web UI Panel (Harness)
// - Drag-drop video upload
// - Live progress with stage breakdown
// - Note preview (Markdown/HTML toggle)
// - Configuration presets selector
// - Batch queue management
```

### 4.3 REST API Adapter (Programmatic)
```yaml
# OpenAPI 3.1
/videos:
  post:
    summary: Start video analysis
    requestBody:
      content:
        multipart/form-data:
          schema:
            type: object
            properties:
              file: { type: string, format: binary }
              config: { $ref: '#/components/schemas/ProcessingConfig' }
    responses:
      '202': { description: Job accepted, returns jobId }

/jobs/{jobId}:
  get:
    summary: Job status with progress
    responses:
      '200': { $ref: '#/components/schemas/JobStatus' }

/jobs/{jobId}/note:
  get:
    summary: Get generated note
    parameters:
      - name: format
        in: query
        schema: { type: string, enum: [md, json, html] }
    responses:
      '200': { description: Note in requested format }
```

---

## Phase 5: Review Committee System (Separate Bounded Context)

### 5.1 Domain Model
```typescript
// ReviewSession.ts - Aggregate Root
class ReviewSession {
  id: ReviewSessionId;
  artifactId: ArtifactId;           // Plan, code, config, etc.
  artifactType: 'plan' | 'code' | 'config';
  status: 'pending' | 'in_review' | 'approved' | 'rejected' | 'revision';
  requiredScore: 95;                // Minimum
  minPersonaScore: 85;              // No persona below this
  personas: ReviewPersona[];
  consensus?: ConsensusResult;
  createdAt: DateTime;
  completedAt?: DateTime;
}

// ReviewPersona.ts - Entity
class ReviewPersona {
  id: PersonaId;
  type: 'security' | 'architecture' | 'ux' | 'performance' | 'domain';
  evaluator: IPersonaEvaluator;     // Plugin/agent implementing evaluation
  weight: number;                   // Default 1.0, configurable
  findings: ReviewFinding[];
  score: number;                    // 0-100
}

// ConsensusResult.ts - Value Object
class ConsensusResult {
  approved: boolean;
  overallScore: number;
  personaScores: Record<PersonaType, number>;
  blockingFindings: ReviewFinding[];  // Critical/high not resolved
  revisionRequired: boolean;
  revisionGuidance: string[];
}
```

### 5.2 Persona Evaluators (Implement IPersonaEvaluator)
Each persona is a separate skill/agent with:
- **SecurityEvaluator**: Threat model, STRIDE analysis, OWASP checks
- **ArchitectureEvaluator**: Clean Architecture compliance, SOLID, coupling metrics
- **UXEvaluator**: Heuristic evaluation, schema validation, accessibility audit
- **PerformanceEvaluator**: Benchmark execution, resource profiling, scalability modeling
- **DomainEvaluator**: Ground truth comparison, extraction completeness metrics

### 5.3 Review Orchestrator
```typescript
class ReviewOrchestrator {
  async review(artifact: Artifact, session: ReviewSession): Promise<ConsensusResult> {
    // 1. Parallel evaluation by all 5 personas
    const evaluations = await Promise.all(
      session.personas.map(p => p.evaluator.evaluate(artifact, p))
    );
    
    // 2. Aggregate scores
    const scores = evaluations.map(e => e.score);
    const overall = scores.reduce((a, b) => a + b, 0) / scores.length;
    
    // 3. Check thresholds
    const approved = overall >= 95 && scores.every(s => s >= 85);
    
    // 4. Collect blocking findings
    const blocking = evaluations.flatMap(e => 
      e.findings.filter(f => f.severity === 'critical' || f.severity === 'high')
    );
    
    // 5. If rejected: generate revision guidance
    const guidance = approved ? [] : this.generateGuidance(evaluations);
    
    return { approved, overallScore: overall, personaScores: ..., blockingFindings: blocking, revisionRequired: !approved, revisionGuidance: guidance };
  }
  
  async iterateUntilApproved(artifact: Artifact, maxIterations: 5): Promise<ConsensusResult> {
    for (let i = 0; i < maxIterations; i++) {
      const result = await this.review(artifact, ...);
      if (result.approved) return result;
      // Auto-revise artifact based on guidance (if implementable)
      artifact = await this.autoRevise(artifact, result.revisionGuidance);
    }
    throw new Error('Max review iterations exceeded');
  }
}
```

### 5.4 Integration with CI/CD
- **Pre-merge gate**: GitHub Action runs review on plan/code changes
- **Post-deployment audit**: Scheduled review of production config
- **Audit trail**: All reviews stored in `ReviewSession` with correlation IDs

---

## Phase 6: Agentic Skills Integration

### 6.1 Skill Adapter Pattern
```typescript
interface ISkillAdapter<TSkillConfig, TSkillResult> {
  skillId: string;
  version: string;              // Pinned commit hash
  capabilities: string[];       // e.g., ['frame-extraction', 'ocr']
  
  execute(input: TSkillConfig, context: SkillContext): Promise<TSkillResult>;
  validate(input: TSkillConfig): ValidationResult;
  healthCheck(): Promise<HealthStatus>;
}

// Adapters for each skill:
VideoContentExtractorAdapter → IFrameExtractor + IOCRProcessor
AudioTranscriberAdapter → ITranscriptionEngine
WatchIgamingAdapter → ISceneAnalyzer + IQATableGenerator
VideoDBSkillAdapter → ICloudVideoProcessor (optional, opt-in)
SeekAndAnalyzeVideoAdapter → IVideoQAEngine (optional, opt-in)
```

### 6.2 Skill Router (Video-Router Pattern)
```typescript
class SkillRouter {
  route(request: VideoAnalysisRequest): SkillPipeline {
    // Analyze request: content type, quality needs, privacy mode
    // Select primary axis: Compose (notes) + Edit (extract) + Generate (summarize)
    // Lock primary axis, allow overlays
    
    // Return composed pipeline with skill adapters
  }
}
```

### 6.3 Skill Version Pinning & Verification
```json
// skills-lock.json
{
  "video-content-extractor": "sha256:abc123...@commit:def456",
  "audio-transcriber": "sha256:ghi789...@commit:jkl012",
  "watch-igaming": "sha256:mno345...@commit:pqr678"
}
// Verified on install; checksum mismatch → reject
```

---

## Phase 7: Comprehensive Testing (TDD)

### 7.1 Unit Tests (Per Component)
```typescript
// Domain
describe('Timestamp', () => {
  it('aligns PTS to ISO with millisecond precision', () => { /* ... */ });
  it('calculates drift between audio and video clocks', () => { /* ... */ });
  it('generates valid deep-link protocol', () => { /* ... */ });
});

describe('TimestampAligner', () => {
  it('syncs transcript segments to nearest OCR frame ±2s', () => { /* ... */ });
  it('flags gaps >10s with single-modality content', () => { /* ... */ });
  it('detects visual references ("this slide") and links to OCR', () => { /* ... */ });
});

// Infrastructure
describe('FfmpegFrameExtractor', () => {
  it('extracts frames at scene boundaries with correct PTS', () => { /* ... */ });
  it('adapts interval for static vs action content', () => { /* ... */ });
  it('streams frames without loading all into memory', () => { /* ... */ });
});

describe('TesseractOCRProcessor', () => {
  it('applies CLAHE + deskew preprocessing', () => { /* ... */ });
  it('selects PSM 6 for slide content, PSM 11 for sparse UI', () => { /* ... */ });
  it('filters word confidence < 70%', () => { /* ... */ });
});
```

### 7.2 Integration Tests (Full Pipeline)
```typescript
describe('VideoAnalysisPipeline', () => {
  it('processes 10-min lecture video in < 2 min (CI benchmark)', () => { /* ... */ });
  it('produces note with all major topics from ground truth', () => { /* ... */ });
  it('timestamps accurate within ±2s vs manual annotation', () => { /* ... */ });
  it('OCR accuracy ≥ 90% on clear text frames (test fixture)', () => { /* ... */ });
  it('Transcription WER ≤ 10% on clear audio (test fixture)', () => { /* ... */ });
  it('resumes from checkpoint after simulated crash', () => { /* ... */ });
  it('batch processes 10 videos with memory < 2GB', () => { /* ... */ });
});
```

### 7.3 Contract Tests
```typescript
// Format serializer round-trip
describe('NoteSerializers', () => {
  it('MD → JSON → MD preserves all semantic content', () => { /* ... */ });
  it('JSON Schema validation passes for all generated notes', () => { /* ... */ });
  it('HTML output passes WCAG 2.2 AA automated checks', () => { /* ... */ });
});

// Plugin interface
describe('HarnessPlugin', () => {
  it('registers skills with correct permissions', () => { /* ... */ });
  it('enforces privacy mode (no cloud calls in local-only)', () => { /* ... */ });
  it('cleans up resources on unload', () => { /* ... */ });
});
```

### 7.4 Property-Based Tests
```typescript
// fast-check
it('Timestamp alignment is commutative and associative', () => {
  fc.assert(fc.property(timestampArb, transcriptArb, ocrArb, (ts, tr, ocr) => {
    const aligned1 = aligner.align(tr, ocr);
    const aligned2 = aligner.align(ocr, tr); // Should be symmetric
    expect(aligned1.gaps).toEqual(aligned2.gaps);
  }));
});
```

### 7.5 Test Fixtures
- `fixtures/lecture-10min.mp4` - Ground truth: manual annotations, expected notes
- `fixtures/tutorial-5min.mp4` - Code walkthrough with syntax highlighting
- `fixtures/meeting-15min.mp4` - Multi-speaker, screen share
- `fixtures/documentary-20min.mp4` - Mixed content, gradual transitions
- `fixtures/lecture-1hr.mp4` - **1-hour lecture for memory benchmark** (validates < 2GB RSS)
- `fixtures/empty-audio.mp4` - Adversarial: video with no audio track
- `fixtures/no-text.mp4` - Adversarial: video with no visual text
- `fixtures/rapid-cuts.mp4` - Adversarial: rapid scene changes (< 1s)
- `fixtures/cjk-content.mp4` - Adversarial: Chinese/Japanese/Korean text
- `fixtures/rtl-content.mp4` - Adversarial: Arabic/Hebrew RTL text
- `fixtures/multi-monitor.mp4` - Meeting with screen share + participant tiles

---

## Phase 8: Configuration Presets (Addresses UXReviewer)

```typescript
// Built-in presets (user selectable via --preset or config)
const PRESETS = {
  lecture: {
    frameExtraction: { 
      preset: 'lecture',
      sceneThreshold: 0.35,
      minIntervalSec: 30,
      maxIntervalSec: 5,
      enableTransientDetection: false,
    },
    ocr: { 
      psm: 'auto',           // PSM 6 for slides
      languages: ['eng'], 
      confidenceThreshold: 0.7,
      superResolution: true,
    },
    transcription: { 
      model: 'base.int8',
      enableVAD: true,
      vocabularyBoost: 'auto',  // From OCR
    },
    note: { template: 'lecture' },
  },
  tutorial: {
    frameExtraction: { 
      preset: 'tutorial',
      sceneThreshold: 0.3,
      minIntervalSec: 10,
      maxIntervalSec: 2,
      enableTransientDetection: true,  // Code popups, tooltips
    },
    ocr: { 
      psm: 'auto',           // PSM 4 for code columns
      languages: ['eng'],
      confidenceThreshold: 0.75,
      codeDetection: true,
    },
    transcription: { 
      model: 'small.int8',   // Better for technical terms
      vocabularyBoost: 'auto',
    },
    note: { template: 'tutorial' },
  },
  meeting: {
    frameExtraction: { 
      preset: 'meeting',
      sceneThreshold: 0.25,
      minIntervalSec: 5,
      maxIntervalSec: 1,
      enableTransientDetection: true,  // Chat, participants
      fastExtract: false,
      enableRegionDetection: true,     // Detect screen-share area
      regionOfInterest: 'screen-share',
    },
    ocr: { 
      psm: 11,               // Sparse text (names, UI)
      languages: ['eng'],
      regionAware: true,     // Only OCR detected regions
    },
    transcription: { 
      model: 'base.int8',
      // Future: speaker diarization
    },
    note: { template: 'meeting' },
  },
  documentary: {
    frameExtraction: { 
      preset: 'documentary',
      sceneThreshold: 0.4,
      minIntervalSec: 15,
      maxIntervalSec: 3,
    },
    ocr: { 
      psm: 'auto',
      languages: ['eng'],
    },
    transcription: { 
      model: 'large-v3.int8',  // Best quality
    },
    note: { template: 'documentary' },
  },
};
```

---

## Phase 9: NoteSchema v1.0 (Addresses UXReviewer & DomainExpertReviewer)

```yaml
# Note Frontmatter (Required)
---
schemaVersion: "1.0"
videoId: "uuid-v7"
sourcePath: "/absolute/path/video.mp4"
contentHash: "sha256:..."
duration: "00:10:23.456"
resolution: "1920x1080"
fps: "30000/1001"
processingConfig:
  preset: "lecture"
  frameExtraction: { ... }
  ocr: { ... }
  transcription: { ... }
  privacy: "local-only"
generatedAt: "2026-01-15T10:30:00Z"
processingTimeMs: 87342
tags: ["machine-learning", "lecture", "introduction"]
---

# Standard Section Hierarchy
# 1. Executive Summary (LLM, grounded, cited)
## 1.1 Key Takeaways (bullets with timestamps)
## 1.2 Prerequisites / Context

# 2. Timeline (Scene-based, hierarchical)
## 2.1 Scene 1: Introduction (00:00-02:34) [static-slide]
### 2.1.1 Visual Content (OCR text from slides)
### 2.1.2 Transcript Excerpt (aligned)
### 2.1.3 Key Points (LLM summary with citations)
### 2.1.4 Code Blocks (detected from syntax highlighting)
### 2.1.5 Action Items / TODOs

## 2.2 Scene 2: Core Concepts (02:34-07:12) [talking-head + slides]
...

# 3. Visual Elements Index
## 3.1 Slide 1 (00:12) - "Course Overview"
## 3.2 Diagram: Neural Network Architecture (03:45)
## 3.3 Code Example: Training Loop (05:22)

# 4. Full Transcript (searchable, timestamped)
## 4.1 Segment 1 (00:00-00:45) - "Welcome to the course..."
## 4.2 ...

# 5. Cross-References
## 5.1 "See Section 2.3 for loss function details"
## 5.2 "Refer to Slide 5 at 04:12 for architecture diagram"

# 6. Metadata
## 6.1 Processing Statistics
## 6.2 Quality Metrics (OCR avg confidence, Transcription WER estimate)
## 6.3 Gaps Flagged (segments with single-modality only)
```

### JSON Schema (Draft 2020-12)
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://video-to-notes.dev/schemas/note-1.0.json",
  "type": "object",
  "required": ["schemaVersion", "videoId", "frontmatter", "sections"],
  "properties": {
    "schemaVersion": { "const": "1.0" },
    "videoId": { "type": "string", "format": "uuid" },
    "frontmatter": { "$ref": "#/$defs/frontmatter" },
    "sections": { "type": "array", "items": { "$ref": "#/$defs/section" } }
  },
  "$defs": {
    "frontmatter": { ... },
    "section": { ... },
    "timestamp": { "type": "string", "pattern": "^([0-9]{2}:){2}[0-9]{2}\\.[0-9]{3}$" }
  }
}
```

---

## Phase 10: Quality Gates & CI/CD

### 10.1 CI Pipeline (GitHub Actions)
```yaml
# .github/workflows/ci.yml
jobs:
  lint-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run lint && npm run typecheck

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run test:unit -- --coverage

  # Native binary build with SIMD optimization
  build-native:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install build deps
        run: sudo apt-get update && sudo apt-get install -y build-essential cmake ninja-build libopenblas-dev
      - name: Build whisper.cpp (AVX2 + OpenBLAS)
        run: |
          cd vendor/whisper.cpp
          cmake -B build -DWHISPER_OPENMP=ON -DWHISPER_CUDA=OFF -DBLAS=OpenBLAS -DCMAKE_C_FLAGS="-mavx2 -mfma" -DCMAKE_CXX_FLAGS="-mavx2 -mfma"
          cmake --build build --config Release --target whisper
      - name: Build ffmpeg (static, SIMD)
        run: |
          # Use pre-built ffmpeg-static with SIMD or build from source
          npm install ffmpeg-static@latest
      - name: Verify SIMD support
        run: |
          ./vendor/whisper.cpp/build/bin/whisper --help | grep -i simd || true

  integration-tests:
    runs-on: ubuntu-latest
    needs: [build-native]
    # Requires FFmpeg, Tesseract, Whisper models
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run test:integration

  # Memory benchmark for 1hr video (Critical - Addresses PerformanceReviewer)
  memory-benchmark:
    runs-on: ubuntu-latest
    needs: [build-native]
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - name: Download 1hr test fixture
        run: |
          # Download lecture-1hr.mp4 from artifact storage
          wget -O fixtures/lecture-1hr.mp4 "https://storage.example.com/test-fixtures/lecture-1hr.mp4"
      - name: Run memory benchmark
        run: |
          node --expose-gc scripts/memory-benchmark.js fixtures/lecture-1hr.mp4 --preset=lecture --max-rss-mb=2048
      - name: Upload benchmark results
        uses: actions/upload-artifact@v4
        with:
          name: memory-benchmark
          path: benchmark-results.json

  # Speed benchmark for 10-min video
  speed-benchmark:
    runs-on: ubuntu-latest
    needs: [build-native]
    if: github.event_name == 'schedule' || github.event_name == 'workflow_dispatch'
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - name: Run speed benchmark
        run: |
          node scripts/speed-benchmark.js fixtures/lecture-10min.mp4 --target-ms=120000
      - name: Upload benchmark results
        uses: actions/upload-artifact@v4
        with:
          name: speed-benchmark
          path: benchmark-results.json

  security-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm audit --audit-level=high
      - run: npx @cyclonedx/bom .

  review-committee:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - run: npx vtn-review-committee --artifact PLAN_REVISED.md --threshold 95

  bundle-size:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build
      - run: npx bundlesize  # < 50MB core

  release:
    needs: [lint-typecheck, unit-tests, integration-tests, security-audit, review-committee, bundle-size]
    if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - run: npm publish --access public
```

### 10.1.5 SIMD Build Specifications (NEW - Addresses PerformanceReviewer)
```bash
# whisper.cpp build flags (documented in BUILD.md)
# CPU baseline: AVX2 (Intel Haswell 2013+, AMD Excavator 2015+)
# Optional: AVX-512 (Skylake-X 2017+, Zen 4 2022+), NEON (ARM)

# Release build (CPU only, maximum compatibility):
cmake -B build \
  -DWHISPER_OPENMP=ON \
  -DWHISPER_CUDA=OFF \
  -DWHISPER_METAL=OFF \
  -DWHISPER_ROCM=OFF \
  -DBLAS=OpenBLAS \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS="-O3 -mavx2 -mfma -march=x86-64-v3" \
  -DCMAKE_CXX_FLAGS="-O3 -mavx2 -mfma -march=x86-64-v3"

# GPU build (CUDA):
cmake -B build \
  -DWHISPER_OPENMP=ON \
  -DWHISPER_CUDA=ON \
  -DBLAS=OpenBLAS \
  -DCMAKE_BUILD_TYPE=Release

# FFmpeg: Use ffmpeg-static npm package (pre-built with SIMD)
# Or build from source with:
./configure --enable-gpl --enable-nonfree --enable-libx264 --enable-libvpx \
  --cpu=x86-64-v3 --extra-cflags="-mavx2 -mfma" --extra-cxxflags="-mavx2 -mfma"

# Tesseract: Use tesseract.js (WASM with SIMD) or compile with:
./configure --enable-openmp --with-extra-cflags="-O3 -mavx2 -mfma"

# CI Docker base image with build tools:
# FROM ubuntu:22.04
# RUN apt-get update && apt-get install -y build-essential cmake ninja-build libopenblas-dev
```

### 10.2 Quality Gate Thresholds
| Metric | Threshold | Gate |
|--------|-----------|------|
| TypeScript strict | 0 errors | CI fail |
| ESLint | 0 errors, 0 warnings | CI fail |
| Unit test coverage | ≥ 80% core, ≥ 60% overall | CI fail |
| Integration tests | All pass | CI fail |
| npm audit | 0 critical/high | CI fail |
| Review Committee | ≥ 95 overall, ≥ 85 each | PR block |
| Bundle size (core) | < 50MB | CI fail |
| Memory (1hr video) | < 2GB | Integration test |
| Speed (10min video) | < 2 min | Integration test |

---

## Phase 11: Documentation & Release

### 11.1 Documentation
- [ ] `README.md`: Quick start, architecture overview, preset guide, troubleshooting
- [ ] `ARCHITECTURE.md`: ADRs, layer diagrams, extension points
- [ ] `CONFIGURATION.md`: Full schema, presets, environment variables
- [ ] `CLI_REFERENCE.md`: All commands, options, error codes
- [ ] `PLUGIN_DEVELOPMENT.md`: Creating skill adapters, custom renderers
- [ ] `PRIVACY.md`: Data handling, local-only mode, consent model
- [ ] TypeDoc API docs: `npm run docs` → `docs/`

### 11.2 Release Branch Strategy
```bash
# Main branch: protected, requires PR + review committee approval
# Release tags: v0.1.0, v0.2.0, v1.0.0
# Changelog: Keep a Changelog format, auto-generated from conventional commits

git checkout -b release/v0.1.0
# Final validation
npm run validate:all
git tag v0.1.0
git push origin v0.1.0
# GitHub Release auto-created with changelog
```

---

## Risk Mitigation Matrix (Updated)

| Risk | Likelihood | Impact | Mitigation (Implemented in Plan) |
|------|------------|--------|----------------------------------|
| Path traversal / command injection | High | Critical | **Phase 0.1-0.2**: PathValidator, ArgumentSanitizer, execFile only |
| Cloud upload without consent | High | Critical | **Phase 0.3**: PrivacyMode enum, ConsentGate, audit log |
| Dependency supply chain | Medium | High | **Phase 0.4**: Exact pinning, SBOM, audit gate, provenance |
| Temp file leakage | High | High | **Phase 0.3**: SecureTempManager, encryption, crash recovery |
| Markdown/HTML injection | Medium | High | **Phase 0.5**: DOMPurify, entity escaping, CSP |
| Clean Architecture violations | High | High | **Phase 1-2**: Explicit ports, adapters, dependency inversion |
| God object VideoProcessor | High | High | **Phase 2.2**: Pipeline DAG with IPipelineStage |
| Memory OOM on long videos | High | High | **Phase 2.5**: Streaming, bounded buffers, incremental render |
| Unachievable speed targets | High | High | **Phase 2.1.5, 3.5**: GPU auto-detect, ModelSelector, base.int8/small.int8, parallel DAG, warmup |
| Incomplete extraction | High | High | **Phase 3.2-3.6**: Adaptive intervals, scene detection, transient text, region detection |
| Timestamp misalignment | Medium | High | **Phase 1.3**: PTS master clock, semantic matching, gap flagging |
| Hallucinated summaries | Medium | High | **Phase 3.7, 3.8**: Grounded summarization with citations, ILLMProvider abstraction |
| LLM provider lock-in | Medium | High | **Phase 3.8**: Multi-provider ILLMProvider (Harness, DeepSeek, OpenAI, Anthropic, Google, Ollama, Custom) |
| LLM structured output failure | Medium | High | **Phase 3.8**: StructuredOutputCoordinator (native JSON → tool calling → regex repair → guided retry) |
| LLM context overflow | High | High | **Phase 3.8**: ContextAwareSummarizer (map-reduce, chunking, token budgeting) |
| LLM provider latency variance | Medium | High | **Phase 3.8**: LLMProviderPool (circuit breaker, fallback chain, latency-aware routing) |
| LLM rate limit / quota exceeded | Medium | High | **Phase 3.8**: LLMProviderPool (token bucket rate limiting, priority queue, cost tracking) |
| LLM hallucination / ungrounded claims | High | High | **Phase 3.8**: GroundednessValidator (embedding/LLM-judge claim verification, ≥90% threshold) |
| LLM citation inconsistency | Medium | High | **Phase 3.8**: CitationNormalizer (canonical format, validation against source, cross-provider) |
| LLM cold start latency | Low | Medium | **Phase 3.8**: LLMProviderPool warmup, connection pooling, Ollama model pre-load |
| LLM SSRF via custom endpoint | High | Critical | **Phase 3.8**: SSRF protection in customEndpoint.baseUrl validation (blocks RFC1918, metadata endpoints, DNS rebinding) |
| LLM header injection via custom headers | Medium | High | **Phase 3.8**: Header allowlist (only content-type, accept, user-agent, x-request-id), strips Authorization/cookies/proxy headers |
| LLM response injection (XSS) | High | Critical | **Phase 3.8**: LLMSanitizer strips <script>, javascript:, data:, onerror=, iframes, dangerous markdown links |
| LLM model supply chain (Ollama/custom) | Medium | High | **Phase 3.8**: Model digest pinning in skills-lock.json, verifyModel() with digest verification before use |
| Skill version drift | Medium | Medium | **Phase 6.3**: skills-lock.json with commit hashes |
| Bundle size bloat | Low | Medium | **Phase 10.1**: esbuild, optional deps, bundlesize gate |
| GPU unavailable / OOM | Medium | High | **Phase 2.1.5**: ModelSelector fallback chain (GPU small→GPU base→CPU base→CPU tiny) |
| Cross-branch pipeline stall | Medium | High | **Phase 2.1.5**: PipelineCoordinator credit-based backpressure |
| Single-process scaling limit | Medium | High | **Phase 2.4.5**: WorkerPool abstraction (Local → Distributed via Redis) |
| No SIMD optimization | Medium | High | **Phase 10.1.5**: whisper.cpp/FFmpeg/Tesseract AVX2/OpenBLAS builds |
| No memory benchmark validation | High | High | **Phase 10.1**: Scheduled 1hr video benchmark asserting < 2GB RSS |
| Vocabulary prompt overflow | Medium | Medium | **Phase 3.5**: VocabularyPrioritizer with 224-token budget |
| First-inference latency | Low | Medium | **Phase 2.1.5**: WarmupStage with dummy inference |
| Scene detection overhead | Low | Medium | **Phase 3.2**: FastFrameExtractor (direct PTS seek) optional strategy |

---

## Open Questions - RESOLVED

| # | Question | Resolution |
|---|----------|------------|
| 1 | Local vs cloud Whisper? | **Default: local-only (base.int8 CPU, small.int8 GPU). Cloud opt-in only with explicit consent.** |
| 2 | VideoDB integration? | **Optional skill adapter behind `net:cloud-opt-in` permission. Disabled by default.** |
| 3 | GPU acceleration required? | **Auto-detected via GPUDetector. Fallback chain: GPU small.int8 → GPU base.int8 → CPU base.int8 (AVX2) → CPU tiny.int8. No manual config needed.** |
| 4 | Single vs combined notes? | **Configurable: `--output-mode single|combined`. Default: single per video.** |
| 5 | Target video types? | **Presets for lecture/tutorial/meeting/documentary. Custom via config.** |
| 6 | Harness sandbox constraints? | **Plugin manifest declares permissions. Sandbox enforces deny-by-default.** |
| 7 | Model update strategy? | **Pinned versions in skills-lock.json. Manual update via `vtn models pull`.** |
| 8 | Regulatory compliance? | **Local-only default satisfies GDPR. No PII extraction. Configurable retention.** |
| 9 | Horizontal scaling? | **WorkerPool abstraction: LocalWorkerPool (3-4 concurrent optimal) → DistributedWorkerPool (Redis-backed) for fleets.** |
| 10 | SIMD baseline? | **AVX2 (x86-64-v3) minimum for CPU builds. NEON for ARM. Documented in BUILD.md.** |
| 11 | LLM provider support? | **Multi-provider ILLMProvider: Harness (built-in), DeepSeek, OpenAI, Anthropic, Google, Ollama, Custom OpenAI-compatible. Default: Harness (current session model).** |
| 12 | LLM model selection? | **CLI flags: `--llm-provider`, `--llm-model`, `--harness-model`. Config: provider, model, temperature, maxTokens. Harness uses current session model by default.** |
| 13 | Grounded summarization citations? | **Bracket format [timestamp] by default. Configurable: inline, footnote, bracket. Verified against source OCR+transcript timestamps.** |

---

## Implementation Priority Order (Updated)

### Sprint 1: Security Foundation + Domain Core (Weeks 1-2)
- Phase 0: All security hardening
- Phase 1.1-1.3: Domain entities, events, services
- Phase 7.1: Unit test infrastructure

### Sprint 2: Pipeline Architecture + Performance Services (Weeks 3-4)
- Phase 2.1-2.5: Pipeline stages, executor, resilience, resources
- **Phase 2.1.5: GPUDetector, ModelSelector, PipelineCoordinator, WarmupStage, FastFrameExtractor**
- Phase 3.1-3.2: Metadata + Frame extraction adapters
- Phase 7.2: Pipeline integration tests

### Sprint 3: OCR + Transcription + Scenes (Weeks 5-6)
- Phase 3.3-3.6: OCR, Audio, Transcription, Scene adapters
- **Phase 3.5: VocabularyPrioritizer, adaptive model escalation**
- Phase 3.7: TimestampAligner, ContentAggregator domain services
- Phase 7.2-7.3: Integration + contract tests

### Sprint 4: Note Generation + Rendering + LLM Providers (Weeks 7-8)
- Phase 3.7: Summarization (grounded, cited)
- **Phase 3.8: LLM Providers (ILLMProvider + adapters: Harness, DeepSeek, OpenAI, Anthropic, Google, Ollama, Custom)**
- Phase 3.7: NoteRenderers (MD/JSON/HTML with templates)
- Phase 9: NoteSchema v1.0 + JSON Schema
- Phase 7.4: Property-based tests

### Sprint 5: Interface Adapters + Horizontal Scaling (Weeks 9-10)
- Phase 4.1: CLI with full UX (wizard, doctor, completions)
- Phase 4.2: Harness Plugin (manifest, web UI panel)
- Phase 4.3: REST API (OpenAPI)
- **Phase 2.4.5: WorkerPool abstraction (Local + Distributed)**
- Phase 7.5: Test fixtures validation (including 1hr + adversarial)

### Sprint 6: Review Committee + Skills + CI/CD (Weeks 11-12)
- Phase 5: Review Committee bounded context
- Phase 6: Skill adapters, router, version pinning
- **Phase 10: CI/CD with SIMD builds, memory/speed benchmarks, review committee gate**

### Sprint 7: Polish + Release (Weeks 13-14)
- Phase 11: Documentation, ADRs, TypeDoc
- Phase 8: Configuration presets finalization
- Release v0.1.0

---

## Committee Re-Evaluation Checklist

Before implementation begins, this revised plan must score ≥95 from all 5 personas:

| Persona | Original Score | Target | Key Fixes Addressed |
|---------|---------------|--------|---------------------|
| SecurityReviewer | 42 | 95+ | Phase 0 (all 10 findings), **Phase 3.8** (SSRF protection, header sanitization, LLM response sanitizer, Ollama model digest verification) |
| ArchitectureReviewer | 72 | 95+ | Phase 1-2 (ports, domain, pipeline, resilience, observability), **Phase 3.8** (ILLMProvider multi-provider abstraction) |
| UXReviewer | 62 | 95+ | Phase 4.1, 8, 9 (NoteSchema, presets, CLI UX, templates), **Phase 3.8, 4.1** (LLM provider selection CLI with short flags -p/-m/-H, model management with verify, doctor checks with fallback, wizard setup with guided API key setup, error codes VTN_E_LLM_*, env var fallbacks documented) |
| PerformanceReviewer | 42 | 95+ | **Phase 2.1.5** (GPU auto-detect, ModelSelector, PipelineCoordinator, WarmupStage, FastFrameExtractor), **Phase 2.4.5** (WorkerPool horizontal scaling), **Phase 3.5** (VocabularyPrioritizer, adaptive escalation), **Phase 3.8** (LLMProviderPool, circuit breaker, fallback chain, semantic cache, token budgeting, cost-aware routing), **Phase 10.1** (SIMD builds, 1hr memory benchmark, speed benchmark), **Phase 7.5** (1hr fixture, adversarial fixtures) |
| DomainExpertReviewer | 68 | 95+ | Phase 3.2-3.7 (adaptive extraction, OCR pipeline, transcription, alignment, grounded summary), **Phase 3.8** (ContextAwareSummarizer map-reduce, StructuredOutputCoordinator fallback, CitationNormalizer, GroundednessValidator, ModelAwarePromptBuilder) |

---

## Sign-Off

This revised plan incorporates **all 42 findings** from the review committee with specific, implementable solutions. Each phase includes validation criteria that directly map to the scoring rubrics used by the 5 personas.

**Next Step**: Upon committee re-approval (≥95 all personas), begin Sprint 1 implementation.

---
*Revised plan created after comprehensive review committee evaluation (5 personas). All critical/high findings addressed with architectural decisions, not just promises.*