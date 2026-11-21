import { join, basename, extname } from 'path';
import { mkdir } from 'fs/promises';
import type { VideoMetadata } from '../../domain/entities/Video.js';
import { Video } from '../../domain/entities/Video.js';
import type { Frame } from '../../domain/entities/Frame.js';
import { Transcript } from '../../domain/entities/Transcript.js';
import type { Scene } from '../../domain/entities/Scene.js';
import type {
  NoteSection,
  NoteFrontmatter,
  ProcessingConfigSummary,
} from '../../domain/entities/Note.js';
import { Note } from '../../domain/entities/Note.js';
import { Timestamp } from '../../domain/value-objects/Timestamp.js';
import type {
  IVideoMetadataExtractor,
  IFrameExtractor,
  IOCRProcessor,
  IAudioExtractor,
  ITranscriptionEngine,
  ISceneAnalyzer,
  ITimestampAligner,
  IContentAggregator,
  INoteRenderer,
  IConfigurationProvider,
  IResourcePool,
  IMetricsCollector,
  ILogger,
  PipelineContext,
  ProcessingConfig,
  AudioFile,
  OutputFileManifest,
  IRawTranscriptRenderer,
  IRawOCRRenderer,
  IFrameCopier,
  IAudioEnhancer,
  INoteSynthesizer,
  INoteValidator,
} from '../ports/Interfaces.js';
import type { ISummarizer } from '../services/Summarizer.js';
import { buildValidationSection } from '../../domain/services/CorrectionFormatter.js';
import { normalizeTranscriptionConfig } from '../services/normalizeTranscriptionConfig.js';
import { checkCoverage } from '../../domain/services/CoverageChecker.js';
import { emptyCoverageCounts } from '../../domain/entities/ValidationFinding.js';
import type { NoteValidationResult } from '../../domain/entities/ValidationFinding.js';

/**
 * AnalyzeVideo use case - orchestrates the full video -> notes pipeline.
 *
 * Design notes:
 *  - Every optional stage (frames, audio, transcription, OCR, scenes) degrades
 *    to "no content from that modality" instead of failing the run. A user with
 *    no Tesseract still gets a transcript-backed note.
 *  - The use case is stateless; the stateful content aggregator is supplied via
 *    a factory so one instance is created per run.
 *  - `outputDir` is a directory. Output files are named after the video's base
 *    name, e.g. `<outputDir>/lecture-01.md`.
 */

export interface AnalyzeVideoInput {
  videoPath: string;
  config?: Partial<ProcessingConfig> | undefined;
  outputDir?: string | undefined;
  formats?: ('md' | 'json' | 'html')[] | undefined;
  progressCallback?: ((progress: ProgressUpdate) => void) | undefined;
}

export interface ProgressUpdate {
  stage: string;
  percent: number;
  current: string;
  etaSeconds: number;
  throughput: string;
}

export interface AnalyzeVideoOutput {
  note: Note;
  video: Video;
  processingTimeMs: number;
  outputFiles: string[];
  manifest?: OutputFileManifest;
  /** Non-fatal degradations worth surfacing to the user (missing tools, etc.). */
  warnings: string[];
}

export interface AnalyzeVideoDeps {
  metadataExtractor: IVideoMetadataExtractor;
  frameExtractor: IFrameExtractor;
  ocrProcessor: IOCRProcessor;
  audioExtractor: IAudioExtractor;
  transcriptionEngine: ITranscriptionEngine;
  sceneAnalyzer: ISceneAnalyzer;
  timestampAligner: ITimestampAligner;
  createContentAggregator: () => IContentAggregator;
  noteRenderer: INoteRenderer;
  summarizer: ISummarizer;
  configProvider: IConfigurationProvider;
  metrics: IMetricsCollector;
  logger: ILogger;
  ffmpegPool?: IResourcePool<unknown> | undefined;
  whisperPool?: IResourcePool<unknown> | undefined;
  tesseractPool?: IResourcePool<unknown> | undefined;
  rawTranscriptRenderer?: IRawTranscriptRenderer | undefined;
  rawOcrRenderer?: IRawOCRRenderer | undefined;
  frameCopier?: IFrameCopier | undefined;
  audioEnhancer?: IAudioEnhancer | undefined;
  synthesizer?: INoteSynthesizer | undefined;
  validator?: INoteValidator | undefined;
}

const supportedFormats = new Set(['md', 'json', 'html']);

export class AnalyzeVideo {
  private readonly _deps: AnalyzeVideoDeps;

  constructor(deps: AnalyzeVideoDeps) {
    this._deps = deps;
  }

  async execute(input: AnalyzeVideoInput, context: PipelineContext): Promise<AnalyzeVideoOutput> {
    const startedAt = Date.now();
    const pipelineStart = Date.now();
    const warnings: string[] = [];
    const { videoPath } = input;
    const signal = context.signal;

    const config = this.resolveConfig(input.config);
    const videoId = crypto.randomUUID();

    this.emitProgress(input, {
      stage: 'init',
      percent: 0,
      current: 'Reading video',
      etaSeconds: 0,
      throughput: '',
    });
    this.throwIfAborted(signal);

    // ---- 1. Metadata -------------------------------------------------------
    this.emitProgress(input, {
      stage: 'metadata',
      percent: 4,
      current: 'Extracting metadata',
      etaSeconds: 10,
      throughput: '',
    });
    const video = new Video(videoId, videoPath, emptyMetadata(), 'pending');
    await this._deps.metadataExtractor.extract(video);
    this.throwIfAborted(signal);

    const baseName = basename(videoPath, extname(videoPath));
    const outputDir = input.outputDir ?? join(process.cwd(), 'output');
    await mkdir(outputDir, { recursive: true });

    // ---- 2. Frames ---------------------------------------------------------
    this.emitProgress(input, {
      stage: 'frames',
      percent: 8,
      current: 'Extracting frames',
      etaSeconds: 30,
      throughput: '0 fps',
    });
    const frames = await this.extractFrames(video, config, input, signal, warnings);
    this.throwIfAborted(signal);

    // ---- 3. Audio ----------------------------------------------------------
    this.emitProgress(input, {
      stage: 'audio',
      percent: 28,
      current: 'Extracting audio',
      etaSeconds: 20,
      throughput: '',
    });
    const audio = await this.extractAudio(video, signal, warnings);
    this.throwIfAborted(signal);

    if (frames.length === 0 && !audio) {
      throw new Error(
        `No audio or frames could be extracted from "${videoPath}". ` +
          'Check that the file is a readable video and that ffmpeg is installed.'
      );
    }

    // ---- 4. Transcription --------------------------------------------------
    this.emitProgress(input, {
      stage: 'transcription',
      percent: 34,
      current: 'Transcribing audio',
      etaSeconds: 90,
      throughput: '',
    });
    let transcript = await this.transcribe(video, audio, config, signal, warnings);

    const hasAudio = audio !== null && audio.duration > 3;
    const emptyTranscript = transcript.segments.length === 0;

    if (hasAudio && emptyTranscript) {
      if (config.transcription.enableVAD) {
        warnings.push(
          'VAD_EMPTY_TRANSCRIPT: Audio was present but VAD produced empty transcript. You can specify vadEnabled: false to retry without VAD or enable audio enhancement.'
        );
      } else {
        warnings.push('EMPTY_TRANSCRIPT: No speech detected in audio.');
      }

      if (config.transcription.enhanceAudio && this._deps.audioEnhancer) {
        this.emitProgress(input, {
          stage: 'transcription',
          percent: 38,
          current: 'Enhancing audio and retrying transcription',
          etaSeconds: 60,
          throughput: '',
        });
        this._deps.logger.info('VAD/audio noise suspected. Running ffmpeg audio enhancement...');
        try {
          const workDir = join(outputDir, '.work', video.id);
          await mkdir(workDir, { recursive: true });
          const enhancedAudio = await this._deps.audioEnhancer.enhance(audio, workDir, signal);
          transcript = await this.transcribe(video, enhancedAudio, config, signal, warnings);
        } catch (enhErr) {
          this._deps.logger.warn('Audio enhancement retry failed', { error: describe(enhErr) });
        }
      }
    }
    video.setTranscript(transcript);

    // ---- 5. OCR ------------------------------------------------------------
    this.emitProgress(input, {
      stage: 'ocr',
      percent: 50,
      current: 'Reading on-screen text',
      etaSeconds: 40,
      throughput: '',
    });
    await this.runOcr(video, frames, config, input, signal, warnings);
    this.throwIfAborted(signal);

    // ---- 6. Scenes ---------------------------------------------------------
    this.emitProgress(input, {
      stage: 'scenes',
      percent: 68,
      current: 'Detecting scenes',
      etaSeconds: 20,
      throughput: '',
    });
    const scenes = await this.detectScenes(video, frames, warnings);
    for (const scene of scenes) video.addScene(scene);
    assignScenesToFrames(frames, scenes);

    // ---- 7. Alignment ------------------------------------------------------
    this.emitProgress(input, {
      stage: 'alignment',
      percent: 74,
      current: 'Aligning timestamps',
      etaSeconds: 5,
      throughput: '',
    });
    const alignedBlocks = this._deps.timestampAligner.align(transcript.segments, frames, scenes);

    // ---- 8. Aggregation ----------------------------------------------------
    this.emitProgress(input, {
      stage: 'aggregation',
      percent: 79,
      current: 'Building sections',
      etaSeconds: 5,
      throughput: '',
    });
    const aggregator = this._deps.createContentAggregator();
    for (const block of alignedBlocks) {
      aggregator.processBlock(block);
    }
    let sections = aggregator.toNoteSections();
    if (sections.length === 0) {
      warnings.push('No sections could be aggregated; emitted a single overview section.');
      sections = [buildFallbackSection(video, transcript, frames)];
    }

    // ---- 8.5 Screenshots & Key Frames --------------------------------------
    let keyFramePaths = new Map<string, string>();
    const framesDir = join(outputDir, `${baseName}_frames`);
    if (this._deps.frameCopier) {
      this.emitProgress(input, {
        stage: 'screenshots',
        percent: 81,
        current: 'Saving screenshots',
        etaSeconds: 5,
        throughput: '',
      });
      const cap = Math.min(
        config.frameExtraction.screenshotCount,
        config.frameExtraction.maxFrames
      );
      keyFramePaths = await this._deps.frameCopier.copyKeyFrames(
        frames,
        outputDir,
        baseName,
        cap,
        video.duration.milliseconds
      );
    }
    this.throwIfAborted(signal);

    // ---- 8.6 Render Raw Transcript & Raw OCR -------------------------------
    const transcriptPath = join(outputDir, `${baseName}_transcript.md`);
    const ocrPath = join(outputDir, `${baseName}_ocr.md`);

    if (this._deps.rawTranscriptRenderer) {
      await this._deps.rawTranscriptRenderer.render(transcript, transcriptPath, video);
    }
    if (this._deps.rawOcrRenderer) {
      await this._deps.rawOcrRenderer.render(frames, ocrPath, video);
    }

    // ---- 9. Synthesis -------------------------------------------------------
    this.emitProgress(input, {
      stage: 'synthesize',
      percent: 86,
      current: 'Synthesizing notes',
      etaSeconds: 20,
      throughput: '',
    });
    const synthesisInput = {
      video,
      transcript,
      frames,
      scenes,
      alignedBlocks,
      keyFramePaths,
      sections,
    };
    let finalSections: NoteSection[];
    let counts = emptyCoverageCounts();

    if (this._deps.synthesizer) {
      const synthResult = await this._deps.synthesizer.synthesize(synthesisInput, {
        detailLevel: config.note.detailLevel,
        signal,
        privacy: config.privacy,
        validation: config.validation,
      });
      finalSections = synthResult.sections;
      counts = synthResult.gapCounts;
      if (synthResult.degraded)
        warnings.push('LLM synthesis degraded; used the offline extractive notes.');
    } else {
      finalSections = await this._deps.summarizer.summarize(sections, {
        detailLevel: config.note.detailLevel,
        signal,
      });
    }
    this.throwIfAborted(signal);

    // ---- 9b. Independent validation & accuracy -----------------------------
    let findings: NoteValidationResult = {
      missingTranscript: [],
      missingOcr: [],
      corrections: [],
      incomplete: [],
      degraded: true,
    };
    if (this._deps.validator && config.validation.enabled) {
      this.emitProgress(input, {
        stage: 'validate',
        percent: 90,
        current: 'Validating notes',
        etaSeconds: 15,
        throughput: '',
      });
      const notesBeforeValidation = sectionsToText(finalSections);
      findings = await this._deps.validator.validate(
        {
          notes: notesBeforeValidation,
          transcript,
          frames,
          screenshots: keyFramePaths,
          language: transcript.language || config.transcription.language || 'auto',
        },
        {
          signal,
          ...(config.validation.model !== undefined ? { model: config.validation.model } : {}),
        }
      );
      this.throwIfAborted(signal);
      if (!findings.degraded) {
        this.emitProgress(input, {
          stage: 'repair',
          percent: 92,
          current: 'Applying corrections',
          etaSeconds: 10,
          throughput: '',
        });
        if (this._deps.synthesizer) {
          finalSections = await this._deps.synthesizer.revise(
            finalSections,
            findings,
            synthesisInput,
            {
              detailLevel: config.note.detailLevel,
              signal,
              privacy: config.privacy,
              validation: config.validation,
            }
          );
        }
        this.throwIfAborted(signal);
      }
      if (findings.corrections.length > 0) {
        warnings.push(
          `${findings.corrections.length} concept correction(s) applied during validation.`
        );
      }
    }

    // Final coverage is measured before the verbatim appendix is added.
    const finalReport = checkCoverage(sectionsToText(finalSections), transcript, frames);
    finalSections = [
      ...finalSections,
      buildValidationSection(findings, finalReport.counts, finalReport.gaps),
    ];

    // ---- 10. Note + render -------------------------------------------------
    this.emitProgress(input, {
      stage: 'rendering',
      percent: 95,
      current: 'Writing notes',
      etaSeconds: 5,
      throughput: '',
    });
    const processingTimeMs = Date.now() - pipelineStart;
    const note = this.createNote(video, finalSections, config, processingTimeMs);
    const formats = this.resolveFormats(input.formats, config);
    const noteFiles = await this.render(note, outputDir, baseName, formats);

    const primaryNotePath =
      noteFiles.find(path => path.endsWith('_notes.md')) ?? join(outputDir, `${baseName}_notes.md`);
    const extras = noteFiles.filter(path => path !== primaryNotePath);
    const manifest: OutputFileManifest = {
      transcript: transcriptPath,
      ocr: ocrPath,
      notes: primaryNotePath,
      framesDir,
      all: [primaryNotePath, transcriptPath, ocrPath, ...extras],
    };

    const outputFiles = [primaryNotePath, transcriptPath, ocrPath, ...extras];

    this._deps.metrics.recordHistogram('video_analysis_duration_ms', Date.now() - startedAt, {
      preset: config.frameExtraction.preset,
    });
    this._deps.metrics.incrementCounter('videos_analyzed');

    this.emitProgress(input, {
      stage: 'complete',
      percent: 100,
      current: 'Done',
      etaSeconds: 0,
      throughput: '',
    });

    return { note, video, processingTimeMs, outputFiles, manifest, warnings };
  }

  // -------------------------------------------------------------------------
  // Stages
  // -------------------------------------------------------------------------

  private async extractFrames(
    video: Video,
    config: ProcessingConfig,
    input: AnalyzeVideoInput,
    signal: AbortSignal,
    warnings: string[]
  ): Promise<Frame[]> {
    const frames: Frame[] = [];
    const estimated = Math.max(
      1,
      this._deps.frameExtractor.getEstimatedFrameCount(video, config.frameExtraction)
    );
    const start = Date.now();

    try {
      for await (const frame of this._deps.frameExtractor.extractFrames(
        video,
        config.frameExtraction,
        signal
      )) {
        if (signal.aborted) break;
        frames.push(frame);
        video.addFrame(frame);

        if (frames.length % 5 === 0 || frames.length === estimated) {
          const elapsedSec = Math.max(0.001, (Date.now() - start) / 1000);
          const rate = frames.length / elapsedSec;
          const remaining = Math.max(0, estimated - frames.length);
          this.emitProgress(input, {
            stage: 'frames',
            percent: Math.min(27, 8 + (frames.length / estimated) * 19),
            current: `Frame ${frames.length}/${estimated}`,
            etaSeconds: rate > 0 ? Math.round(remaining / rate) : 0,
            throughput: `${rate.toFixed(1)} fps`,
          });
        }
      }
    } catch (error) {
      const message = `Frame extraction failed: ${describe(error)}`;
      warnings.push(message);
      this._deps.logger.warn(message, { videoId: video.id });
    }

    return frames;
  }

  private async extractAudio(
    video: Video,
    signal: AbortSignal,
    warnings: string[]
  ): Promise<AudioFile | null> {
    try {
      return await this.withPool(this._deps.ffmpegPool, () =>
        this._deps.audioExtractor.extract(
          video,
          join(process.cwd(), 'output', '.work', video.id),
          signal
        )
      );
    } catch (error) {
      const message = `Audio extraction failed: ${describe(error)}`;
      warnings.push(message);
      this._deps.logger.warn(message, { videoId: video.id });
      return null;
    }
  }

  private async transcribe(
    video: Video,
    audio: AudioFile | null,
    config: ProcessingConfig,
    signal: AbortSignal,
    warnings: string[]
  ): Promise<Transcript> {
    const empty = (): Transcript =>
      new Transcript(
        video.id,
        [],
        config.transcription.language ?? 'en',
        config.transcription.model,
        0
      );

    if (!audio) {
      warnings.push('No audio track available; the note has no transcript.');
      return empty();
    }

    try {
      return await this.withPool(this._deps.whisperPool, () =>
        this._deps.transcriptionEngine.transcribe(audio, config.transcription)
      );
    } catch (error) {
      if (signal.aborted) throw error;
      const message = `Transcription failed: ${describe(error)}`;
      warnings.push(message);
      this._deps.logger.warn(message, { videoId: video.id });
      return empty();
    }
  }

  private async runOcr(
    video: Video,
    frames: Frame[],
    config: ProcessingConfig,
    input: AnalyzeVideoInput,
    signal: AbortSignal,
    warnings: string[]
  ): Promise<void> {
    if (frames.length === 0) return;

    let failures = 0;
    for (let index = 0; index < frames.length; index++) {
      if (signal.aborted) break;
      const frame = frames[index];
      if (!frame) continue;

      try {
        const result = await this.withPool(this._deps.tesseractPool, () =>
          this._deps.ocrProcessor.process(frame, config.ocr)
        );
        frame.setOCRResult(result);
      } catch (error) {
        failures += 1;
        this._deps.logger.debug('OCR skipped for frame', {
          frameId: frame.id,
          error: describe(error),
        });
      }

      if (index % 5 === 0 || index === frames.length - 1) {
        this.emitProgress(input, {
          stage: 'ocr',
          percent: 50 + ((index + 1) / frames.length) * 17,
          current: `Frame ${index + 1}/${frames.length}`,
          etaSeconds: 0,
          throughput: '',
        });
      }
    }

    if (failures > 0 && failures === frames.length) {
      warnings.push(
        'OCR failed for every frame; check that Tesseract is installed and the language packs exist.'
      );
    } else if (failures > 0) {
      warnings.push(`OCR failed for ${failures} of ${frames.length} frames.`);
    }
  }

  private async detectScenes(video: Video, frames: Frame[], warnings: string[]): Promise<Scene[]> {
    try {
      return await this._deps.sceneAnalyzer.analyze(video, frames);
    } catch (error) {
      const message = `Scene detection failed: ${describe(error)}`;
      warnings.push(message);
      this._deps.logger.warn(message, { videoId: video.id });
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Note construction
  // -------------------------------------------------------------------------

  private createNote(
    video: Video,
    sections: NoteSection[],
    config: ProcessingConfig,
    processingTimeMs: number
  ): Note {
    const summary: ProcessingConfigSummary = {
      preset: config.frameExtraction.preset,
      frameExtraction: {
        strategy: config.frameExtraction.strategy,
        sceneThreshold: config.frameExtraction.sceneThreshold,
        intervalSec: config.frameExtraction.intervalSec,
      },
      ocr: {
        psm: config.ocr.psm,
        languages: [...config.ocr.languages],
        confidenceThreshold: config.ocr.confidenceThreshold,
      },
      transcription: {
        model: config.transcription.model,
        enableVAD: config.transcription.enableVAD,
        ...(config.transcription.language !== undefined
          ? { language: config.transcription.language }
          : {}),
        multilingual: config.transcription.multilingual ?? false,
        ...(config.transcription.vocabularyBoost !== undefined
          ? { vocabularyBoost: config.transcription.vocabularyBoost }
          : {}),
      },
      privacy: config.privacy,
    };

    const frontmatter: NoteFrontmatter = {
      schemaVersion: '1.0',
      videoId: video.id,
      sourcePath: video.sourcePath,
      contentHash: video.contentHash,
      duration: video.duration.toISO(),
      resolution: video.resolution,
      fps: `${video.metadata.fps.num}/${video.metadata.fps.den}`,
      processingConfig: summary,
      generatedAt: new Date().toISOString(),
      processingTimeMs,
      tags: [config.frameExtraction.preset, config.privacy],
    };

    return new Note(crypto.randomUUID(), video.id, frontmatter, sections, summary);
  }

  private resolveFormats(
    requested: ('md' | 'json' | 'html')[] | undefined,
    config: ProcessingConfig
  ): ('md' | 'json' | 'html')[] {
    const source = requested && requested.length > 0 ? requested : config.note.outputFormats;
    const formats = source.filter((format): format is 'md' | 'json' | 'html' =>
      supportedFormats.has(format)
    );
    // The three-artifact contract always requires the notes in Markdown.
    return formats.includes('md') ? formats : [...formats, 'md'];
  }

  private async render(
    note: Note,
    outputDir: string,
    baseName: string,
    formats: ('md' | 'json' | 'html')[]
  ): Promise<string[]> {
    const files: string[] = [];
    for (const format of formats) {
      const outputPath = join(outputDir, `${baseName}_notes.${format}`);
      await this._deps.noteRenderer.render(note, outputPath);
      files.push(outputPath);
    }
    return files;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private resolveConfig(userConfig?: Partial<ProcessingConfig>): ProcessingConfig {
    const base = this._deps.configProvider.getVideoProcessingConfig();
    if (!userConfig) return normalizeTranscriptionConfig(base);
    const merged: ProcessingConfig = {
      ...base,
      ...userConfig,
      frameExtraction: { ...base.frameExtraction, ...(userConfig.frameExtraction ?? {}) },
      ocr: { ...base.ocr, ...(userConfig.ocr ?? {}) },
      transcription: { ...base.transcription, ...(userConfig.transcription ?? {}) },
      note: { ...base.note, ...(userConfig.note ?? {}) },
      batch: { ...base.batch, ...(userConfig.batch ?? {}) },
      validation: { ...base.validation, ...(userConfig.validation ?? {}) },
    };
    return normalizeTranscriptionConfig(merged);
  }

  private async withPool<T>(
    pool: IResourcePool<unknown> | undefined,
    fn: () => Promise<T>
  ): Promise<T> {
    if (!pool) return fn();
    const lease = await pool.acquire();
    try {
      return await fn();
    } finally {
      lease.release();
    }
  }

  private emitProgress(input: AnalyzeVideoInput, update: ProgressUpdate): void {
    const clamped: ProgressUpdate = {
      ...update,
      percent: Math.max(0, Math.min(100, update.percent)),
    };
    this._deps.logger.debug(`Progress: ${clamped.stage} ${clamped.percent.toFixed(0)}%`, {
      current: clamped.current,
    });
    try {
      input.progressCallback?.(clamped);
    } catch (error) {
      this._deps.logger.warn('progressCallback threw', { error: describe(error) });
    }
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      throw new Error('Video analysis aborted');
    }
  }
}

function emptyMetadata(): VideoMetadata {
  return {
    duration: Timestamp.fromMilliseconds(0),
    width: 0,
    height: 0,
    fps: { num: 0, den: 1 },
    codec: 'unknown',
    bitrate: 0,
    format: 'unknown',
    size: 0,
    chapters: [],
    subtitleTracks: [],
    audioTracks: [],
    isVFR: false,
  };
}

function assignScenesToFrames(frames: Frame[], scenes: Scene[]): void {
  if (scenes.length === 0) return;
  for (const frame of frames) {
    const scene = scenes.find(
      candidate =>
        !frame.timestamp.lessThan(candidate.start) && !frame.timestamp.greaterThan(candidate.end)
    );
    if (scene) frame.setSceneId(scene.id);
  }
}

function buildFallbackSection(video: Video, transcript: Transcript, frames: Frame[]): NoteSection {
  const visual = frames
    .filter(frame => frame.hasOCR())
    .map(frame => frame.getText().trim())
    .filter(text => text.length > 0)
    .join('\n');

  const audio = transcript.segments
    .map(segment => segment.text.trim())
    .filter(text => text.length > 0)
    .join(' ');

  const parts: string[] = [];
  if (visual.length > 0) parts.push('**On screen text**', '', visual, '');
  if (audio.length > 0) parts.push('**Spoken content**', '', audio, '');
  if (parts.length === 0) {
    parts.push('No text could be extracted from this video.');
  }

  return {
    id: `section-overview-${video.id}`,
    title: 'Overview',
    level: 2,
    timestamp: Timestamp.fromMilliseconds(0),
    content: parts.join('\n').trim(),
    subsections: [],
    citations: [],
    metadata: { fallback: true },
  };
}

function sectionsToText(sections: NoteSection[]): string {
  return sections.map(section => `## ${section.title}\n${section.content}`).join('\n\n');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
