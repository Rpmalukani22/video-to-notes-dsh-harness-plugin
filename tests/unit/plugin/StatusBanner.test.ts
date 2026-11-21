import { describe, expect, it } from 'vitest';
import { captureStatus } from '../../helpers/toolCapture.js';

describe('Status banner (plan path)', () => {
  it('prints all artifact paths and the VAD remediation hint', async () => {
    const tool = captureStatus();
    const value = await tool.execute({ jobId: 'j1' });
    const text = tool.output.render({}, value).map((part: { text: string }) => part.text).join('\n');
    expect(text).toContain('sample_notes.md');
    expect(text).toContain('sample_transcript.md');
    expect(text).toContain('sample_ocr.md');
    expect(text).toContain('vad off');
  });
});
