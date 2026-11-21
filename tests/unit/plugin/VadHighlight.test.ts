import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('VAD highlight (plan path)', () => {
  it('tells the harness about "vad off" and the ffmpeg enhancement filter', () => {
    const tool = readFileSync('src/plugin/tools/analyzeVideo.ts', 'utf8');
    const banner = readFileSync('src/plugin/tools/getNote.ts', 'utf8');
    expect(tool).toContain('vad off');
    expect(tool).toContain('Hinglish');
    expect(banner).toContain('vadEnabled: false');
    expect(banner).toContain('afftdn=nf=-20');
  });
});
