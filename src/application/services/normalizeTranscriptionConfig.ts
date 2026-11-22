import { resolveLanguageIntent } from '../../domain/services/LanguageIntent.js';
import type { ProcessingConfig } from '../ports/Interfaces.js';

/** Applied once in AnalyzeVideo.resolveConfig so CLI, batch and plugin share it. */
export function normalizeTranscriptionConfig(config: ProcessingConfig): ProcessingConfig {
  const intent = resolveLanguageIntent(config.transcription.language);
  const boostParts = [config.transcription.vocabularyBoost, intent.prompt].filter(
    (part): part is string => typeof part === 'string' && part.trim().length > 0
  );
  return {
    ...config,
    transcription: {
      ...config.transcription,
      language: intent.whisperLanguage,
      multilingual: config.transcription.multilingual || intent.multilingual,
      ...(boostParts.length > 0 ? { vocabularyBoost: boostParts.join('\n') } : {}),
    },
  };
}
