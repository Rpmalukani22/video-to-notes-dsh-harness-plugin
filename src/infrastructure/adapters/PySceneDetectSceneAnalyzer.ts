import { Video } from '../../domain/entities/Video.js';
import { Frame } from '../../domain/entities/Frame.js';
import { Scene, SceneType } from '../../domain/entities/Scene.js';
import { Timestamp } from '../../domain/value-objects/Timestamp.js';
import { ISceneAnalyzer } from '../../application/ports/Interfaces.js';
import { ILogger, IMetricsCollector } from '../../application/ports/Interfaces.js';
import { spawn } from 'child_process';

/**
 * PySceneDetect-based scene analyzer
 * Uses content-aware and adaptive detection for scene boundaries
 */

export interface SceneBoundary {
  start: number;
  end: number;
}

export class PySceneDetectSceneAnalyzer implements ISceneAnalyzer {
  private readonly _scenedetectPath: string;
  private readonly _logger: ILogger;
  private readonly _metrics: IMetricsCollector;
  private readonly _timeoutMs: number;

  constructor(
    scenedetectPath: string = 'scenedetect',
    logger: ILogger,
    metrics: IMetricsCollector,
    timeoutMs: number = 300000
  ) {
    this._scenedetectPath = scenedetectPath;
    this._logger = logger;
    this._metrics = metrics;
    this._timeoutMs = timeoutMs;
  }

  async analyze(video: Video, frames: Frame[]): Promise<Scene[]> {
    const startTime = Date.now();
    
    try {
      // Run PySceneDetect with content-aware detection
      const sceneBoundaries = await this.detectSceneBoundaries(video);
      
      // Create Scene entities from boundaries
      const scenes = this.createScenesFromBoundaries(video.id, sceneBoundaries, frames);
      
      // Classify scene types
      const classifiedScenes = await this.classifyScenes(scenes, frames);
      
      const duration = Date.now() - startTime;
      this._metrics.recordHistogram('scene_detection_duration_ms', duration);
      this._logger.debug('Scene detection completed', { videoId: video.id, sceneCount: scenes.length, duration });
      
      return classifiedScenes;
    } catch (error) {
      this._metrics.incrementCounter('scene_detection_errors');
      throw error;
    }
  }

  private detectSceneBoundaries(video: Video): Promise<Array<{ start: number; end: number }>> {
    return new Promise((resolve, reject) => {
      const args = [
        '-i', video.sourcePath,
        'detect-content',
        '--threshold', '0.3',
        'list-scenes',
        // Print the table, do not write `<video>-Scenes.csv` into the CWD.
        '-n',
      ];

      const proc = spawn(this._scenedetectPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: this._timeoutMs
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          try {
            const boundaries = this.parseSceneBoundaries(stdout);
            resolve(boundaries);
          } catch (error) {
            reject(error);
          }
        } else {
          reject(new Error(`scenedetect failed: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  private parseSceneBoundaries(output: string): SceneBoundary[] {
    return parseSceneList(output);
  }

  private createScenesFromBoundaries(
    videoId: string,
    boundaries: SceneBoundary[],
    frames: Frame[]
  ): Scene[] {
    return boundaries.map((boundary, index) => {
      const sceneId = `scene_${videoId}_${index}`;
      const start = Timestamp.fromSeconds(boundary.start);
      const end = Timestamp.fromSeconds(boundary.end);
      
      // Find key frames in this scene
      const keyFrames = frames
        .filter(f => f.timestamp.seconds >= boundary.start && f.timestamp.seconds <= boundary.end)
        .map(f => f.id);
      
      return new Scene(sceneId, videoId, start, end, 'unknown', keyFrames);
    });
  }

  private async classifyScenes(scenes: Scene[], frames: Frame[]): Promise<Scene[]> {
    // Classify each scene based on visual characteristics
    for (const scene of scenes) {
      const sceneFrames = frames.filter(f => 
        f.timestamp.seconds >= scene.start.seconds && 
        f.timestamp.seconds <= scene.end.seconds
      );
      
      const type = this.classifySceneType(sceneFrames);
      scene.setType(type);
      
      // Calculate confidence based on frame analysis
      const confidence = this.calculateSceneConfidence(sceneFrames, type);
      scene.setConfidence(confidence);
    }
    
    return scenes;
  }

  private classifySceneType(sceneFrames: Frame[]): SceneType {
    if (sceneFrames.length === 0) return 'unknown';

    const scores: Record<SceneType, number> = {
      'static-slide': 0,
      'talking-head': 0,
      'code': 0,
      'action': 0,
      'transition': 0,
      'unknown': 0,
    };
    const add = (type: SceneType, weight: number): void => {
      scores[type] = (scores[type] ?? 0) + weight;
    };

    for (const frame of sceneFrames) {
      if (!frame.hasOCR()) continue;
      const text = frame.getText();
      const confidence = frame.getOCRConfidence();
      const length = text.trim().length;

      if (this.looksLikeCode(text)) {
        add('code', 3);
      }
      if (confidence > 0.7 && length > 50) {
        add('static-slide', 2);
      } else if (confidence > 0.55 && length > 200) {
        add('static-slide', 1);
      }
    }

    const withText = sceneFrames.filter((frame) => frame.hasOCR() && frame.getText().trim().length > 0).length;
    const textRatio = withText / sceneFrames.length;
    if (textRatio < 0.2) {
      add('talking-head', 2);
      if (textRatio < 0.1 && sceneFrames.length >= 3) {
        add('action', 1);
      }
    }

    const ranked = (Object.entries(scores) as Array<[SceneType, number]>).sort((a, b) => b[1] - a[1]);
    const best = ranked[0];
    if (!best || best[1] === 0) return 'unknown';
    return best[0];
  }

  private looksLikeCode(text: string): boolean {
    // Heuristics for code detection
    const codePatterns = [
      /[{}()[\];]/,
      /(function|const|let|var|class|def|import|from|return|if|else|for|while)/,
      /[=<>!]=/,
      /\/\/.*/,
      /\/\*.*\*\//
    ];
    
    return codePatterns.some(pattern => pattern.test(text));
  }

  private calculateSceneConfidence(sceneFrames: Frame[], type: string): number {
    // Calculate confidence based on evidence
    let confidence = 0.5; // Base
    
    if (sceneFrames.length > 5) confidence += 0.1;
    if (sceneFrames.length > 20) confidence += 0.1;
    
    // Type-specific confidence boosters
    switch (type) {
      case 'static-slide':
        // High if frames have consistent high OCR
        confidence += 0.2;
        break;
      case 'code':
        // High if code patterns detected
        confidence += 0.2;
        break;
    }
    
    return Math.min(1, confidence);
  }

  getSupportedSceneTypes(): string[] {
    return ['static-slide', 'talking-head', 'code', 'action', 'transition'];
  }
}

/**
 * Parse the scene boundaries out of `scenedetect ... list-scenes` output.
 *
 * PySceneDetect 0.7 prints a pipe-delimited table, and each row contains
 * exactly two timecodes (start and end):
 *
 *   | Scene # | Start Frame |  Start Time  |  End Frame  |   End Time   |
 *   |      1  |           1 | 00:00:00.000 |           1 | 00:00:05.000 |
 *
 * Older releases print either `Scene 1: 00:00:00.000 - 00:01:30.000` lines or
 * CSV rows. The table is tried first because 0.7 also prints a bare
 * comma-separated timecode list that the fallback regex would misread.
 */
export function parseSceneList(output: string): SceneBoundary[] {
  const fromTable = parseSceneTable(output);
  if (fromTable.length > 0) return fromTable;

  const boundaries: SceneBoundary[] = [];
  for (const line of output.split(/\r?\n/)) {
    // 0.7 also prints a bare `00:00:05.000,00:00:10.000` cut list. It carries
    // cut points, not scene ranges, so it must not be read as a boundary pair.
    if (/^\s*\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\s*,\s*\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\s*$/.test(line)) {
      continue;
    }
    const match = line.match(/(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)\s*[-,]\s*(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/);
    if (match && match[1] && match[2]) {
      boundaries.push({
        start: parseTimeToSeconds(match[1]),
        end: parseTimeToSeconds(match[2]),
      });
    }
  }
  return boundaries;
}

function parseSceneTable(output: string): SceneBoundary[] {
  const boundaries: SceneBoundary[] = [];

  for (const line of output.split(/\r?\n/)) {
    if (!line.includes('|')) continue;
    const timecodes = line
      .split('|')
      .map((cell) => parseTimecode(cell.trim()))
      .filter((value): value is number => value !== null);
    if (timecodes.length !== 2) continue;

    const [start, end] = timecodes;
    if (start === undefined || end === undefined) continue;
    boundaries.push({ start, end });
  }

  return boundaries;
}

function parseTimecode(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d+))?$/.exec(value);
  if (!match) return null;
  const hours = parseInt(match[1] ?? '0', 10);
  const minutes = parseInt(match[2] ?? '0', 10);
  const seconds = parseFloat(`${match[3] ?? '0'}.${match[4] ?? '0'}`);
  return hours * 3600 + minutes * 60 + seconds;
}

function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':');
  const hours = parseInt(parts[0] ?? '0', 10);
  const minutes = parseInt(parts[1] ?? '0', 10);
  const seconds = parseFloat(parts[2] ?? '0');
  return hours * 3600 + minutes * 60 + seconds;
}