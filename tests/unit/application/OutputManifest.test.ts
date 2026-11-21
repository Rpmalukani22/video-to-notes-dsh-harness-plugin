import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Output manifest (plan path)', () => {
  it('always writes the notes in markdown and names all three artifacts', () => {
    const source = readFileSync('src/application/use-cases/AnalyzeVideo.ts', 'utf8');
    expect(source).toContain("`${baseName}_notes.${format}`");
    expect(source).toContain("`${baseName}_transcript.md`");
    expect(source).toContain("`${baseName}_ocr.md`");
    expect(source).toContain("formats.includes('md')");
  });
});
