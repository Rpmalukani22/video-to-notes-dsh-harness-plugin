import { readFile } from 'fs/promises';
import { parse as parseYaml } from 'yaml';
import type {
  IConfigurationProvider,
  ProcessingConfig,
  LLMConfig,
  PresetConfig,
  ValidationResult,
  FrameExtractionConfig,
  OCRConfig,
  TranscriptionConfig,
  NoteConfig,
  ValidationConfig,
} from '../../application/ports/Interfaces.js';
import {
  resolveLanguageIntent,
  SUPPORTED_LANGUAGES,
} from '../../domain/services/LanguageIntent.js';
import type { ILogger } from '../../application/ports/Interfaces.js';

export const DEFAULT_FRAME_CONFIG: FrameExtractionConfig = {
  preset: 'lecture',
  strategy: 'adaptive',
  sceneThreshold: 0.3,
  minIntervalSec: 30,
  maxIntervalSec: 5,
  intervalSec: 15,
  screenshotCount: 20,
  enableTransientDetection: false,
  maxFrames: 500,
  fastExtract: true,
  fastIntervalSec: 20,
  enableRegionDetection: false,
};

export const DEFAULT_OCR_CONFIG: OCRConfig = {
  psm: 'auto',
  languages: ['eng'],
  confidenceThreshold: 0.5,
  superResolution: false,
  codeDetection: false,
  regionAware: false,
};

export const DEFAULT_TRANSCRIPTION_CONFIG: TranscriptionConfig = {
  model: 'base.int8',
  enableVAD: true,
  multilingual: false,
  wordTimestamps: true,
  enableEscalation: true,
  escalationThreshold: 0.6,
  maxEscalations: 1,
};

export const DEFAULT_NOTE_CONFIG: NoteConfig = {
  template: 'default',
  outputFormats: ['md'],
  citationFormat: 'inline',
  detailLevel: 'standard',
};

export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  enabled: true,
  maxCorrections: 10,
  abstainOnUnverifiedBasis: true,
};

export const DEFAULT_PROCESSING_CONFIG: ProcessingConfig = {
  frameExtraction: DEFAULT_FRAME_CONFIG,
  ocr: DEFAULT_OCR_CONFIG,
  transcription: DEFAULT_TRANSCRIPTION_CONFIG,
  note: DEFAULT_NOTE_CONFIG,
  privacy: 'local-only',
  batch: { maxConcurrent: 2, checkpointInterval: 1, resume: true },
  validation: DEFAULT_VALIDATION_CONFIG,
};

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: 'none',
  temperature: 0.2,
  maxTokens: 2048,
  topP: 0.95,
};

const PRESETS: Record<string, Partial<ProcessingConfig>> = {
  lecture: {
    frameExtraction: { ...DEFAULT_FRAME_CONFIG, preset: 'lecture', fastIntervalSec: 20 },
    note: { ...DEFAULT_NOTE_CONFIG, detailLevel: 'comprehensive' },
  },
  tutorial: {
    frameExtraction: {
      ...DEFAULT_FRAME_CONFIG,
      preset: 'tutorial',
      sceneThreshold: 0.25,
      fastIntervalSec: 10,
    },
    ocr: { ...DEFAULT_OCR_CONFIG, codeDetection: true },
    note: { ...DEFAULT_NOTE_CONFIG, detailLevel: 'comprehensive' },
  },
  meeting: {
    frameExtraction: { ...DEFAULT_FRAME_CONFIG, preset: 'meeting', fastIntervalSec: 60 },
    note: { ...DEFAULT_NOTE_CONFIG, detailLevel: 'executive' },
  },
  documentary: {
    frameExtraction: {
      ...DEFAULT_FRAME_CONFIG,
      preset: 'documentary',
      sceneThreshold: 0.35,
      fastIntervalSec: 15,
    },
    note: { ...DEFAULT_NOTE_CONFIG, detailLevel: 'standard' },
  },
  custom: {},
};

/**
 * Configuration provider backed by an optional YAML file layered over
 * code defaults. A missing file is not an error; it simply means "defaults".
 */
export class YamlConfigProvider implements IConfigurationProvider {
  private readonly _logger: ILogger;
  private _processing: ProcessingConfig = clone(DEFAULT_PROCESSING_CONFIG);
  private _llm: LLMConfig = clone(DEFAULT_LLM_CONFIG);
  private _loaded = false;

  constructor(logger: ILogger) {
    this._logger = logger;
  }

  /** Load and merge a YAML config file. Missing file leaves defaults intact. */
  async load(configPath?: string): Promise<void> {
    if (!configPath) {
      this._loaded = true;
      return;
    }
    try {
      const raw = await readFile(configPath, 'utf8');
      const parsed = parseYaml(raw) as Record<string, unknown> | null;
      if (parsed && typeof parsed === 'object') {
        const processing = parsed['processing'];
        if (processing && typeof processing === 'object') {
          this._processing = mergeDeep(this._processing, processing as Record<string, unknown>);
        }
        const llm = parsed['llm'];
        if (llm && typeof llm === 'object') {
          this._llm = mergeDeep(this._llm, llm as Record<string, unknown>);
        }
      }
      this._logger.debug('Loaded configuration', { path: configPath });
    } catch (error) {
      if (!isNotFound(error)) {
        this._logger.warn('Could not read config file; using defaults', {
          path: configPath,
          error: String(error),
        });
      }
    } finally {
      this._loaded = true;
    }
  }

  get isLoaded(): boolean {
    return this._loaded;
  }

  getVideoProcessingConfig(): ProcessingConfig {
    return clone(this._processing);
  }

  getLLMConfig(): LLMConfig {
    return clone(this._llm);
  }

  getPresetConfig(preset: string): PresetConfig {
    const overrides = PRESETS[preset] ?? {};
    const frame = overrides.frameExtraction ?? this._processing.frameExtraction;
    const ocr = overrides.ocr ?? this._processing.ocr;
    const transcription = overrides.transcription ?? this._processing.transcription;
    const note = overrides.note ?? this._processing.note;
    return clone({ name: preset, frameExtraction: frame, ocr, transcription, note });
  }

  validate(config: object): ValidationResult {
    const errors: string[] = [];
    const record = config as Record<string, unknown>;

    const frame = record['frameExtraction'] as Partial<FrameExtractionConfig> | undefined;
    if (frame) {
      if (
        frame.maxFrames !== undefined &&
        (!Number.isInteger(frame.maxFrames) || frame.maxFrames < 1)
      ) {
        errors.push('frameExtraction.maxFrames must be a positive integer');
      }
      if (
        frame.sceneThreshold !== undefined &&
        (frame.sceneThreshold < 0 || frame.sceneThreshold > 1)
      ) {
        errors.push('frameExtraction.sceneThreshold must be between 0 and 1');
      }
    }

    const ocr = record['ocr'] as Partial<OCRConfig> | undefined;
    if (ocr) {
      if (
        ocr.confidenceThreshold !== undefined &&
        (ocr.confidenceThreshold < 0 || ocr.confidenceThreshold > 1)
      ) {
        errors.push('ocr.confidenceThreshold must be between 0 and 1');
      }
      if (
        ocr.languages !== undefined &&
        (!Array.isArray(ocr.languages) || ocr.languages.length === 0)
      ) {
        errors.push('ocr.languages must be a non-empty array');
      }
    }

    const transcription = record['transcription'] as Partial<TranscriptionConfig> | undefined;
    if (transcription) {
      const models = ['tiny.int8', 'base.int8', 'small.int8', 'large-v3.int8'];
      if (transcription.model !== undefined && !models.includes(transcription.model)) {
        errors.push(`transcription.model must be one of ${models.join(', ')}`);
      }
      if (transcription.language !== undefined) {
        const intent = resolveLanguageIntent(transcription.language);
        if (intent.warning !== undefined) {
          errors.push(
            `Invalid language "${transcription.language}"; use an ISO code from: ${SUPPORTED_LANGUAGES.join(', ')}`
          );
        }
      }
    }

    const batch = record['batch'] as Partial<ProcessingConfig['batch']> | undefined;
    if (
      batch &&
      batch.maxConcurrent !== undefined &&
      (!Number.isInteger(batch.maxConcurrent) || batch.maxConcurrent < 1)
    ) {
      errors.push('batch.maxConcurrent must be a positive integer');
    }

    return { valid: errors.length === 0, errors };
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function mergeDeep<T>(base: T, override: Record<string, unknown>): T {
  const result = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = mergeDeep(current, value);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
