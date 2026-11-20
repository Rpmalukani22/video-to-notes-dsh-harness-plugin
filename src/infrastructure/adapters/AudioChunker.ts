import { spawn } from 'child_process';
import { join } from 'path';
import { mkdir, unlink } from 'fs/promises';
import { AudioFile, ILogger } from '../../application/ports/Interfaces.js';

export interface AudioChunk {
  index: number;
  startSec: number;
  durationSec: number;
  audioFile: AudioFile;
}

/**
 * Splits large audio files into manageable chunks (e.g. 10 minutes)
 * for reliable, progress-reported, and fault-tolerant speech transcription.
 */
export class AudioChunker {
  constructor(
    private readonly _ffmpegPath: string = 'ffmpeg',
    private readonly _logger?: ILogger
  ) {}

  async splitIntoChunks(
    audio: AudioFile,
    outputDir: string,
    chunkDurationSec: number = 600 // 10 minutes
  ): Promise<AudioChunk[]> {
    if (audio.duration <= chunkDurationSec) {
      return [{
        index: 0,
        startSec: 0,
        durationSec: audio.duration,
        audioFile: audio,
      }];
    }

    const chunksDir = join(outputDir, `chunks_${Date.now()}`);
    await mkdir(chunksDir, { recursive: true });

    const chunks: AudioChunk[] = [];
    const totalDuration = audio.duration;
    let startSec = 0;
    let index = 0;

    while (startSec < totalDuration) {
      const remainingSec = totalDuration - startSec;
      const currentDuration = Math.min(chunkDurationSec, remainingSec);
      const chunkPath = join(chunksDir, `chunk_${String(index).padStart(3, '0')}.wav`);

      // Extract chunk via ffmpeg fast copy
      const args = [
        '-y',
        '-hide_banner',
        '-loglevel', 'error',
        '-ss', startSec.toFixed(3),
        '-t', currentDuration.toFixed(3),
        '-i', audio.path,
        '-c:a', 'pcm_s16le',
        '-ar', '16000',
        '-ac', '1',
        chunkPath,
      ];

      await new Promise<void>((resolve, reject) => {
        const proc = spawn(this._ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg audio chunking failed at ${startSec}s: ${stderr}`));
        });
        proc.on('error', (err) => reject(err));
      });

      chunks.push({
        index,
        startSec,
        durationSec: currentDuration,
        audioFile: {
          videoId: audio.videoId,
          path: chunkPath,
          duration: currentDuration,
          sampleRate: 16000,
          channels: 1,
          format: 'wav',
        },
      });

      startSec += currentDuration;
      index++;
    }

    this._logger?.info(`Split audio (${totalDuration.toFixed(1)}s) into ${chunks.length} chunks of ${chunkDurationSec}s`);
    return chunks;
  }

  async cleanupChunks(chunks: AudioChunk[]): Promise<void> {
    for (const chunk of chunks) {
      if (chunk.audioFile.path.includes('chunk_')) {
        await unlink(chunk.audioFile.path).catch(() => undefined);
      }
    }
  }
}
