import { describe, it, expect } from 'vitest';
import { AudioChunker } from '../../../src/infrastructure/adapters/AudioChunker.js';
import { AudioFile } from '../../../src/application/ports/Interfaces.js';
import { tmpdir } from 'os';

describe('AudioChunker', () => {
  it('does not split audio if duration is under chunk duration', async () => {
    const chunker = new AudioChunker('ffmpeg');
    const audio: AudioFile = {
      videoId: 'v1',
      path: '/path/to/short.wav',
      duration: 300, // 5 minutes
      sampleRate: 16000,
      channels: 1,
      format: 'wav',
    };

    const chunks = await chunker.splitIntoChunks(audio, tmpdir(), 600);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.startSec).toBe(0);
    expect(chunks[0]!.durationSec).toBe(300);
  });
});
