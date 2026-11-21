import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveLanguageIntent } from '../../../src/domain/services/LanguageIntent.js';

describe('Multilingual whisper (plan path)', () => {
  it('excludes the English-only model and names the multilingual download', () => {
    const source = readFileSync('src/infrastructure/adapters/WhisperTranscriptionEngine.ts', 'utf8');
    expect(source).toContain('Multilingual Whisper model not found');
    expect(source).toContain('ggml-base.bin');
    expect(source).toContain('multilingual');
    expect(resolveLanguageIntent('hinglish').whisperLanguage).toBe('hi');
  });
});
