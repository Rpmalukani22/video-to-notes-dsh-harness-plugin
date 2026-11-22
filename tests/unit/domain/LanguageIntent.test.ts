import { describe, expect, it } from 'vitest';
import { resolveLanguageIntent } from '../../../src/domain/services/LanguageIntent.js';

describe('LanguageIntent (plan path)', () => {
  it('maps hints to ISO codes and never emits a raw malicious hint', () => {
    expect(resolveLanguageIntent('hinglish')).toEqual(expect.objectContaining({ whisperLanguage: 'hi', multilingual: true }));
    expect(resolveLanguageIntent('kannada').whisperLanguage).toBe('kn');
    expect(resolveLanguageIntent('x"><b>').whisperLanguage).toBe('auto');
  });
});
