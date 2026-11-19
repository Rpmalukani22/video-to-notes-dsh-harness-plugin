import { Frame } from '../../domain/entities/Frame.js';
import { OCRResult, LineOCRResult } from '../../domain/value-objects/OCRResult.js';
import { Confidence } from '../../domain/value-objects/Confidence.js';
import { BoundingBox } from '../../domain/value-objects/BoundingBox.js';
import { IOCRProcessor, OCRConfig, ILogger, IMetricsCollector } from '../../application/ports/Interfaces.js';
import { spawn } from 'child_process';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import sharp from 'sharp';

/**
 * Tesseract OCR processor.
 *
 * Runs a small sharp-based preprocessing pass (grayscale + normalize + sharpen),
 * then invokes the Tesseract CLI asking for TSV output so we get real word-level
 * confidences and bounding boxes rather than a flat text blob.
 */

type PsmMode = '3' | '4' | '6' | '11';

export class TesseractOCRProcessor implements IOCRProcessor {
  private readonly _tesseractPath: string;
  private readonly _tessdataDir: string;
  private readonly _logger: ILogger;
  private readonly _metrics: IMetricsCollector;
  private readonly _modelsLoaded = new Map<string, boolean>();
  private readonly _tempFiles = new Set<string>();

  constructor(
    tesseractPath: string = 'tesseract',
    tessdataDir: string = '',
    logger: ILogger,
    metrics: IMetricsCollector
  ) {
    this._tesseractPath = tesseractPath;
    this._tessdataDir = tessdataDir;
    this._logger = logger;
    this._metrics = metrics;
  }

  async process(frame: Frame, config: OCRConfig): Promise<OCRResult> {
    const startTime = Date.now();

    if (!frame.imageData && !frame.imagePath) {
      throw new Error(`Frame ${frame.id} has no image data or path`);
    }

    try {
      const processedImagePath = await this.preprocessImage(frame);
      const psm = this.selectPSM(config);
      const result = await this.runTesseract(processedImagePath, config, psm);

      const processingTimeMs = Date.now() - startTime;
      this._metrics.recordHistogram('ocr_duration_ms', processingTimeMs);
      this._logger.debug('OCR completed', {
        frameId: frame.id,
        processingTimeMs,
        lines: result.lineCount,
        words: result.wordCount,
      });

      return result;
    } catch (error) {
      this._metrics.incrementCounter('ocr_errors');
      this._logger.warn('OCR failed for frame', {
        frameId: frame.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await this.cleanupTempFiles();
    }
  }

  private async preprocessImage(frame: Frame): Promise<string> {
    const inputPath = frame.imagePath ?? await this.saveBufferToTemp(frame.imageData as Buffer);
    const outputPath = join(tmpdir(), `vtn_ocr_pre_${randomUUID()}.png`);
    this._tempFiles.add(outputPath);

    // Grayscale + contrast normalisation + slight sharpen. This is cheap and is
    // what makes slide/deck text survive Tesseract's binarisation step.
    await sharp(inputPath)
      .grayscale()
      .normalize()
      .sharpen()
      .png({ compressionLevel: 0 })
      .toFile(outputPath);

    return outputPath;
  }

  private async saveBufferToTemp(data: Buffer): Promise<string> {
    const dir = join(tmpdir(), 'vtn-frames');
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, `frame_${randomUUID()}.png`);
    await writeFile(filePath, data);
    this._tempFiles.add(filePath);
    return filePath;
  }

  /** `auto` picks a single uniform block, which suits slides and code panes. */
  private selectPSM(config: OCRConfig): PsmMode {
    if (config.psm !== 'auto') {
      return config.psm;
    }
    return config.codeDetection ? '6' : '3';
  }

  private runTesseract(imagePath: string, config: OCRConfig, psm: PsmMode): Promise<OCRResult> {
    const outputBase = join(tmpdir(), `vtn_tess_${randomUUID()}`);
    const txtPath = `${outputBase}.txt`;
    const tsvPath = `${outputBase}.tsv`;
    this._tempFiles.add(txtPath);
    this._tempFiles.add(tsvPath);

    const args: string[] = [
      imagePath,
      outputBase,
      '-l', config.languages.join('+'),
      '--psm', psm,
      '--oem', '1',
    ];
    if (this._tessdataDir.length > 0) {
      args.push('--tessdata-dir', this._tessdataDir);
    }
    args.push('tsv');

    return new Promise<OCRResult>((resolve, reject) => {
      const proc = spawn(this._tesseractPath, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: 120000,
      });

      let stderr = '';
      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Tesseract exited with ${code}: ${stderr.trim()}`));
          return;
        }
        readFile(tsvPath, 'utf8')
          .then((tsv) => resolve(parseTesseractTsv(tsv, config.languages[0] ?? 'eng')))
          .catch((error: unknown) => reject(error instanceof Error ? error : new Error(String(error))));
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn Tesseract (${this._tesseractPath}): ${err.message}`));
      });
    });
  }

  private async cleanupTempFiles(): Promise<void> {
    const files = [...this._tempFiles];
    this._tempFiles.clear();
    await Promise.all(files.map((file) => unlink(file).catch(() => undefined)));
  }

  getSupportedLanguages(): string[] {
    return [
      'eng', 'chi_sim', 'chi_tra', 'jpn', 'kor', 'ara', 'heb', 'deu', 'fra', 'spa',
      'ita', 'por', 'rus', 'nld', 'pol', 'ces', 'hun', 'ron', 'tur', 'vie', 'tha', 'ind',
    ];
  }

  async warmup(): Promise<void> {
    // No eager work: Tesseract loads language packs per invocation.
    this._modelsLoaded.set('eng', true);
  }
}

/**
 * Parse Tesseract's TSV output into line-level results.
 *
 * Columns: level page_num block_num par_num line_num word_num left top width height conf text
 * Only rows with level 5 contain words. `conf` is 0-100, or -1 for non-text.
 */
export function parseTesseractTsv(tsv: string, language: string): OCRResult {
  const lines = new Map<string, { words: Array<{ text: string; conf: number; box: BoundingBox }> }>();

  for (const rawLine of tsv.split(/\r?\n/)) {
    if (rawLine.trim().length === 0) continue;
    const cols = rawLine.split('\t');
    if (cols.length < 12) continue;
    if (cols[0] === 'level') continue; // header

    const level = Number(cols[0]);
    const text = cols.slice(11).join('\t').trim();
    if (level !== 5 || text.length === 0) continue;

    const conf = Number(cols[10]);
    if (!Number.isFinite(conf) || conf < 0) continue;

    const left = Number(cols[6]) || 0;
    const top = Number(cols[7]) || 0;
    const width = Number(cols[8]) || 0;
    const height = Number(cols[9]) || 0;

    const key = `${cols[1]}:${cols[2]}:${cols[3]}:${cols[4]}`;
    const bucket = lines.get(key) ?? { words: [] };
    bucket.words.push({
      text,
      conf: clamp01(conf / 100),
      box: new BoundingBox(left, top, width, height),
    });
    lines.set(key, bucket);
  }

  const result: LineOCRResult[] = [];
  for (const bucket of lines.values()) {
    if (bucket.words.length === 0) continue;
    const text = bucket.words.map((w) => w.text).join(' ');
    const confidence = new Confidence(
      bucket.words.reduce((acc, w) => acc + w.conf, 0) / bucket.words.length
    );
    const boxes = bucket.words.map((w) => w.box);
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const maxX = Math.max(...boxes.map((b) => b.x + b.width));
    const maxY = Math.max(...boxes.map((b) => b.y + b.height));

    result.push({
      text,
      confidence,
      boundingBox: BoundingBox.fromCoordinates(minX, minY, maxX, maxY),
      words: bucket.words.map((w) => ({
        text: w.text,
        confidence: new Confidence(w.conf),
        boundingBox: w.box,
        startTimestamp: 0,
        endTimestamp: 0,
      })),
    });
  }

  return new OCRResult(result, language, 0);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
