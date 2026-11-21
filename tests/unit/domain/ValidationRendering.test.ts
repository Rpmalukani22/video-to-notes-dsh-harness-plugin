import { describe, expect, it } from 'vitest';
import { buildValidationSection } from '../../../src/domain/services/CorrectionFormatter.js';
import { Note } from '../../../src/domain/entities/Note.js';
import { emptyCoverageCounts } from '../../../src/domain/entities/ValidationFinding.js';

describe('Validation rendering (plan path)', () => {
  it('renders exactly one Validation & Accuracy heading', () => {
    const section = buildValidationSection(
      { missingTranscript: [], missingOcr: [], corrections: [], incomplete: [], degraded: false },
      emptyCoverageCounts(),
      []
    );
    const note = new Note('n', 'v', {
      schemaVersion: '1.0', videoId: 'v', sourcePath: 'v.mp4', contentHash: 'h',
      duration: '00:00:00.000', resolution: '1x1', fps: '1/1',
      processingConfig: { preset: 'x', frameExtraction: { strategy: 'x', sceneThreshold: 0, intervalSec: 0 }, ocr: { psm: 'auto', languages: [], confidenceThreshold: 0 }, transcription: { model: 'x', enableVAD: true }, privacy: 'local-only' },
      generatedAt: 'now', processingTimeMs: 0, tags: [],
    }, [section], {});
    const matches = note.toMarkdown().match(/## Validation & Accuracy/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});
