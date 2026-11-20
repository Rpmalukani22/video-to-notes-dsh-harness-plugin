import { NoteSection } from '../../domain/entities/Note.js';
import {
  ConceptValidation,
  ILLMProvider,
  ILogger,
  INoteSynthesizer,
  LLMConfig,
  SynthesisInput,
  SynthesisOptions,
  SynthesizedResult,
} from '../ports/Interfaces.js';
import { splitSectionContent } from './Summarizer.js';

/**
 * High-quality cross-modal Note Synthesizer.
 * Synthesizes OCR (visuals) and Transcript (spoken audio) into cohesive,
 * beautifully formatted notes with embedded screenshots and concept validation callouts.
 */
export class NoteSynthesizer implements INoteSynthesizer {
  constructor(
    private readonly _provider: ILLMProvider | null,
    private readonly _config: LLMConfig,
    private readonly _logger: ILogger
  ) {}

  async synthesize(input: SynthesisInput, options: SynthesisOptions = {}): Promise<SynthesizedResult> {
    if (!this._provider || this._config.provider === 'none') {
      return this.synthesizeExtractive(input);
    }

    try {
      return await this.synthesizeWithLLM(input, options);
    } catch (error) {
      this._logger.warn('LLM Note Synthesis failed, falling back to extractive synthesis', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.synthesizeExtractive(input);
    }
  }

  /**
   * Deterministic extractive synthesis with screenshot embedding and clear structure.
   */
  private synthesizeExtractive(input: SynthesisInput): SynthesizedResult {
    const updatedSections: NoteSection[] = [];

    for (const section of input.sections) {
      const { visual, audio } = splitSectionContent(section.content);
      const parts: string[] = [];

      // Find if there are screenshots for this section
      const screenshot = this.findScreenshotForSection(section, input);
      if (screenshot) {
        parts.push(`![Key Slide / Scene](${screenshot})\n`);
      }

      const visualLines = visual
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      if (visualLines.length > 0) {
        parts.push('### Key Visual Points (On-Screen)', '');
        for (const line of visualLines) {
          parts.push(`- ${line}`);
        }
        parts.push('');
      }

      const audioLines = audio
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 10);

      if (audioLines.length > 0) {
        parts.push('### Explanation & Discussion', '');
        for (const line of audioLines.slice(0, 8)) {
          parts.push(`- ${line}`);
        }
        parts.push('');
      }

      const newContent = parts.join('\n').trim();

      updatedSections.push({
        ...section,
        content: newContent.length > 0 ? newContent : section.content,
        metadata: {
          ...section.metadata,
          synthesizer: 'extractive',
        },
      });
    }

    return {
      sections: updatedSections,
      validations: [],
    };
  }

  /**
   * Advanced LLM synthesis merging transcript + OCR + concept validation + screenshots.
   */
  private async synthesizeWithLLM(input: SynthesisInput, options: SynthesisOptions): Promise<SynthesizedResult> {
    const updatedSections: NoteSection[] = [];
    const allValidations: ConceptValidation[] = [];

    for (const section of input.sections) {
      if (options.signal?.aborted) break;

      const { visual, audio } = splitSectionContent(section.content);
      const screenshot = this.findScreenshotForSection(section, input);

      if (!visual.trim() && !audio.trim()) {
        updatedSections.push(section);
        continue;
      }

      const prompt = [
        `Section Title: ${section.title}`,
        section.timestamp ? `Timestamp: ${section.timestamp.toISO()}` : '',
        '',
        '--- ON-SCREEN SLIDE / OCR TEXT ---',
        visual.trim() || '(No visual text detected)',
        '',
        '--- SPOKEN TRANSCRIPT ---',
        audio.trim() || '(No spoken audio detected)',
        '',
        'TASK:',
        '1. Synthesize both sources into cohesive, authoritative, and well-structured study notes.',
        '2. Use the slide text as structural hierarchy and the spoken transcript for explanation.',
        '3. DO NOT interleave OCR and transcript line-by-line.',
        '4. CONCEPT VALIDATION: If you spot a factual mistake, slip of the tongue, or discrepancy',
        '   (e.g., instructor says "Python 2" when slide or current standard is "Python 3", or instructor says X while formula/fact is Y),',
        '   add a prominent blockquote callout:',
        '   > ⚠️ **Clarification / Correction:** Instructor said "...", however the accurate fact/formula is "..."',
        '5. Return only Markdown content with clear headings, bullet points, and code blocks.',
      ].join('\n');

      try {
        const response = await this._provider!.complete(
          {
            systemPrompt:
              'You are an expert technical note taker and educator. Synthesize multimodal video inputs ' +
              '(slide OCR + spoken transcript) into clear, comprehensive, and accurate study notes. ' +
              'Highlight and correct any factual errors or slips of the tongue made by the instructor.',
            messages: [{ role: 'user', content: prompt }],
            temperature: this._config.temperature,
            maxTokens: Math.min(this._config.maxTokens, 2048),
          },
          { signal: options.signal }
        );

        let content = response.content.trim();
        if (screenshot) {
          // Prepend screenshot at the beginning of the section
          content = `![Key Slide / Scene](${screenshot})\n\n${content}`;
        }

        // Extract any validation callouts
        const extractedValidations = extractConceptValidations(content, section.timestamp?.toISO() ?? '');
        allValidations.push(...extractedValidations);

        updatedSections.push({
          ...section,
          content,
          metadata: {
            ...section.metadata,
            synthesizer: 'llm',
            model: response.model,
          },
        });
      } catch (err) {
        this._logger.warn(`Synthesis failed for section ${section.id}, falling back`, {
          error: err instanceof Error ? err.message : String(err),
        });
        const [fallback] = this.synthesizeExtractive({ ...input, sections: [section] }).sections;
        updatedSections.push(fallback ?? section);
      }
    }

    return {
      sections: updatedSections,
      validations: allValidations,
    };
  }

  private findScreenshotForSection(section: NoteSection, input: SynthesisInput): string | null {
    if (!section.timestamp || input.keyFramePaths.size === 0) return null;

    const sectionTimeMs = section.timestamp.milliseconds;
    let closestPath: string | null = null;
    let closestDiff = 15000; // within 15 seconds window

    for (const frame of input.frames) {
      const relPath = input.keyFramePaths.get(frame.id);
      if (!relPath) continue;

      const diff = Math.abs(frame.timestamp.milliseconds - sectionTimeMs);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestPath = relPath;
      }
    }

    return closestPath;
  }
}

function extractConceptValidations(markdown: string, timestamp: string): ConceptValidation[] {
  const validations: ConceptValidation[] = [];
  const regex = />\s*⚠️\s*\*\*Clarification \/ Correction:\*\*\s*Instructor (?:said|mentioned)\s*["']([^"']+)["'],?\s*however\s*(.+)/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    validations.push({
      timestamp,
      instructorSaid: match[1]?.trim() ?? '',
      actualFact: match[2]?.trim() ?? '',
      source: 'ocr-transcript-mismatch',
      confidence: 0.9,
    });
  }

  return validations;
}
