import { Frame } from '../entities/Frame.js';
import { TranscriptSegment } from '../entities/Transcript.js';
import { Video } from '../entities/Video.js';

/**
 * DeduplicationService - Domain service for content deduplication
 * Uses perceptual hashing for frames and content hashing for transcripts
 */

export interface DeduplicationConfig {
  frameSimilarityThreshold: number;     // pHash similarity threshold (0-1)
  transcriptSimilarityThreshold: number; // Text similarity threshold (0-1)
  enableCrossVideoDedup: boolean;        // Deduplicate across videos
}

export interface FrameHash {
  frameId: string;
  videoId: string;
  pHash: string;           // Perceptual hash
  timestamp: number;       // milliseconds
}

export interface TranscriptHash {
  segmentId: string;
  videoId: string;
  contentHash: string;     // SHA-256 of normalized text
  text: string;
}

export class DeduplicationService {
  private readonly _config: DeduplicationConfig;
  private _frameHashes: Map<string, FrameHash[]> = new Map();      // videoId -> hashes
  private _transcriptHashes: Map<string, TranscriptHash[]> = new Map();
  private _globalFrameHashes: FrameHash[] = [];
  private _globalTranscriptHashes: TranscriptHash[] = [];

  constructor(config: Partial<DeduplicationConfig> = {}) {
    this._config = {
      frameSimilarityThreshold: 0.85,    // 85% similarity
      transcriptSimilarityThreshold: 0.9, // 90% similarity
      enableCrossVideoDedup: true,
      ...config
    };
  }

  /**
   * Compute perceptual hash for a frame
   * Simplified implementation - in production use a proper pHash library
   */
  async computeFramePHash(frame: Frame): Promise<string> {
    // In production, use a proper perceptual hashing library like 'phash'
    // This is a placeholder that uses timestamp + image data
    const data = frame.imageData || Buffer.from(frame.id);
    const hash = await this.simpleHash(data);
    return hash.substring(0, 16); // 64-bit hash
  }

  /**
   * Compute content hash for transcript segment
   */
  async computeTranscriptHash(segment: TranscriptSegment): Promise<string> {
    // Normalize text: lowercase, remove punctuation, normalize whitespace
    const normalized = segment.text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Use SHA-256 in production
    return await this.simpleHash(Buffer.from(normalized));
  }

  /**
   * Check if frame is duplicate within video
   */
  async isFrameDuplicate(frame: Frame): Promise<{ isDuplicate: boolean; similarFrameId?: string; similarity?: number }> {
    const pHash = await this.computeFramePHash(frame);
    const videoHashes = this._frameHashes.get(frame.videoId) || [];
    
    for (const existing of videoHashes) {
      const similarity = this.hammingSimilarity(pHash, existing.pHash);
      if (similarity >= this._config.frameSimilarityThreshold) {
        return { isDuplicate: true, similarFrameId: existing.frameId, similarity };
      }
    }

    // Check cross-video if enabled
    if (this._config.enableCrossVideoDedup) {
      for (const existing of this._globalFrameHashes) {
        if (existing.videoId !== frame.videoId) {
          const similarity = this.hammingSimilarity(pHash, existing.pHash);
          if (similarity >= this._config.frameSimilarityThreshold) {
            return { isDuplicate: true, similarFrameId: existing.frameId, similarity };
          }
        }
      }
    }

    return { isDuplicate: false };
  }

  /**
   * Check if transcript segment is duplicate
   */
  async isTranscriptDuplicate(segment: TranscriptSegment): Promise<{ isDuplicate: boolean; similarSegmentId?: string; similarity?: number }> {
    const contentHash = await this.computeTranscriptHash(segment);
    const videoId = segment.id.split('-')[0] ?? 'unknown';
    const videoHashes = this._transcriptHashes.get(videoId) || []; // Approximate videoId
    
    for (const existing of videoHashes) {
      const similarity = existing.contentHash === contentHash ? 1.0 : this.textSimilarity(segment.text, existing.text);
      if (similarity >= this._config.transcriptSimilarityThreshold) {
        return { isDuplicate: true, similarSegmentId: existing.segmentId, similarity };
      }
    }

    if (this._config.enableCrossVideoDedup) {
      for (const existing of this._globalTranscriptHashes) {
        if (existing.segmentId !== segment.id) {
          const similarity = existing.contentHash === contentHash ? 1.0 : this.textSimilarity(segment.text, existing.text);
          if (similarity >= this._config.transcriptSimilarityThreshold) {
            return { isDuplicate: true, similarSegmentId: existing.segmentId, similarity };
          }
        }
      }
    }

    return { isDuplicate: false };
  }

  /**
   * Register frame hash after processing
   */
  async registerFrame(frame: Frame): Promise<void> {
    const pHash = await this.computeFramePHash(frame);
    const hash: FrameHash = {
      frameId: frame.id,
      videoId: frame.videoId,
      pHash,
      timestamp: frame.timestamp.milliseconds
    };

    const videoHashes = this._frameHashes.get(frame.videoId) || [];
    videoHashes.push(hash);
    this._frameHashes.set(frame.videoId, videoHashes);

    if (this._config.enableCrossVideoDedup) {
      this._globalFrameHashes.push(hash);
    }
  }

  /**
   * Register transcript segment hash after processing
   */
  async registerTranscriptSegment(segment: TranscriptSegment, videoId: string): Promise<void> {
    const contentHash = await this.computeTranscriptHash(segment);
    const hash: TranscriptHash = {
      segmentId: segment.id,
      videoId,
      contentHash,
      text: segment.text
    };

    const videoHashes = this._transcriptHashes.get(videoId) || [];
    videoHashes.push(hash);
    this._transcriptHashes.set(videoId, videoHashes);

    if (this._config.enableCrossVideoDedup) {
      this._globalTranscriptHashes.push(hash);
    }
  }

  /**
   * Get deduplication statistics
   */
  getStats(): object {
    let totalFrames = 0;
    let totalTranscripts = 0;
    for (const hashes of this._frameHashes.values()) {
      totalFrames += hashes.length;
    }
    for (const hashes of this._transcriptHashes.values()) {
      totalTranscripts += hashes.length;
    }

    return {
      framesPerVideo: Object.fromEntries(
        Array.from(this._frameHashes.entries()).map(([k, v]) => [k, v.length])
      ),
      transcriptsPerVideo: Object.fromEntries(
        Array.from(this._transcriptHashes.entries()).map(([k, v]) => [k, v.length])
      ),
      globalFrames: this._globalFrameHashes.length,
      globalTranscripts: this._globalTranscriptHashes.length
    };
  }

  /**
   * Clear caches for a video (e.g., after processing complete)
   */
  clearVideoCache(videoId: string): void {
    this._frameHashes.delete(videoId);
    this._transcriptHashes.delete(videoId);
    
    if (this._config.enableCrossVideoDedup) {
      this._globalFrameHashes = this._globalFrameHashes.filter(h => h.videoId !== videoId);
      this._globalTranscriptHashes = this._globalTranscriptHashes.filter(h => h.videoId !== videoId);
    }
  }

  /**
   * Simple hash function (placeholder for proper crypto)
   */
  private async simpleHash(data: Buffer): Promise<string> {
    // In production, use crypto.createHash('sha256').update(data).digest('hex')
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const byte = data[i];
      if (byte === undefined) continue;
      hash = ((hash << 5) - hash) + byte;
      hash |= 0; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).padStart(8, '0');
  }

  /**
   * Hamming similarity for perceptual hashes
   */
  private hammingSimilarity(hash1: string, hash2: string): number {
    if (hash1.length !== hash2.length) return 0;
    
    let matches = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] === hash2[i]) matches++;
    }
    return matches / hash1.length;
  }

  /**
   * Text similarity using Jaccard index on trigrams
   */
  private textSimilarity(text1: string, text2: string): number {
    const trigrams1 = this.getTrigrams(text1);
    const trigrams2 = this.getTrigrams(text2);
    
    const intersection = new Set([...trigrams1].filter(x => trigrams2.has(x)));
    const union = new Set([...trigrams1, ...trigrams2]);
    
    return intersection.size / union.size;
  }

  private getTrigrams(text: string): Set<string> {
    const normalized = text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
    const trigrams = new Set<string>();
    for (let i = 0; i <= normalized.length - 3; i++) {
      trigrams.add(normalized.substring(i, i + 3));
    }
    return trigrams;
  }
}