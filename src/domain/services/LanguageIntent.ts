/** ISO language handling for Whisper, independent of any application-layer concern. */

export const SUPPORTED_LANGUAGES = [
  'auto',
  'en',
  'hi',
  'kn',
  'ta',
  'te',
  'mr',
  'bn',
  'gu',
  'pa',
  'ur',
  'de',
  'es',
  'fr',
  'ru',
  'ja',
  'ko',
  'zh',
  'pt',
  'it',
  'ar',
  'tr',
  'nl',
  'pl',
  'sv',
] as const;

const ALIASES: Record<string, string> = {
  hindi: 'hi',
  english: 'en',
  kannada: 'kn',
  hinglish: 'hi',
};

export interface LanguageIntent {
  whisperLanguage: string;
  multilingual: boolean;
  prompt?: string;
  warning?: string;
}

const HINGLISH_PROMPT =
  'Hinglish: romanized Hindi mixed with English tech terms. Transcribe words as heard, ' +
  'including Hindi words written in Latin script.';

/**
 * Normalise a user-facing language hint into an ISO code accepted by whisper.cpp.
 * Unknown hints never reach the `-l` argument unescaped or unvalidated.
 */
export function resolveLanguageIntent(hint?: string): LanguageIntent {
  const raw = (hint ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'auto') {
    return { whisperLanguage: 'auto', multilingual: false };
  }
  if (raw === 'hinglish') {
    return { whisperLanguage: 'hi', multilingual: true, prompt: HINGLISH_PROMPT };
  }
  const mapped = ALIASES[raw] ?? raw;
  if ((SUPPORTED_LANGUAGES as readonly string[]).includes(mapped)) {
    return { whisperLanguage: mapped, multilingual: mapped !== 'en' };
  }
  return {
    whisperLanguage: 'auto',
    multilingual: true,
    warning: `Unknown language "${raw}"; using auto`,
  };
}

/** Escape a value before it is interpolated into an XML-like prompt attribute. */
export function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
