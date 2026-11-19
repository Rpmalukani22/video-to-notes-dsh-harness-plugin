import { NoteSection } from '../../domain/entities/Note.js';
import { ILLMProvider, ILogger, LLMConfig } from '../ports/Interfaces.js';

/**
 * Summarisation port.
 *
 * The pipeline always has a deterministic, offline summariser available; an LLM
 * is an optional quality upgrade layered on top of it.
 */

export interface SummarizeOptions {
  detailLevel?: 'executive' | 'standard' | 'comprehensive';
  signal?: AbortSignal | undefined;
}

export interface ISummarizer {
  summarize(sections: NoteSection[], options?: SummarizeOptions): Promise<NoteSection[]>;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'while', 'of', 'to',
  'in', 'on', 'at', 'by', 'for', 'with', 'about', 'as', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'we', 'you', 'he',
  'she', 'they', 'them', 'his', 'her', 'their', 'our', 'your', 'my', 'me', 'us', 'so',
  'not', 'no', 'yes', 'do', 'does', 'did', 'have', 'has', 'had', 'can', 'could', 'would',
  'should', 'will', 'just', 'very', 'really', 'like', 'there', 'here', 'what', 'which',
  'who', 'how', 'why', 'from', 'into', 'than', 'too', 'also', 'up', 'down', 'out', 'over',
  'under', 'again', 'more', 'most', 'some', 'any', 'all', 'each', 'every', 'one', 'two',
]);

const BULLET_LIMITS: Record<NonNullable<SummarizeOptions['detailLevel']>, number> = {
  executive: 3,
  standard: 6,
  comprehensive: 10,
};

/**
 * Deterministic extractive summariser.
 *
 * Keeps the note faithful to the source: on-screen text is preserved verbatim,
 * and spoken content is reduced to the highest-scoring sentences while keeping
 * their original order and the section's citations/timestamps untouched.
 */
export class ExtractiveSummarizer implements ISummarizer {
  async summarize(sections: NoteSection[], options: SummarizeOptions = {}): Promise<NoteSection[]> {
    const limit = BULLET_LIMITS[options.detailLevel ?? 'standard'];
    return sections.map((section) => this.summarizeSection(section, limit));
  }

  private summarizeSection(section: NoteSection, limit: number): NoteSection {
    const { visual, audio } = splitSectionContent(section.content);

    const visualLines = dedupe(
      visual
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    ).slice(0, limit);

    const audioSentences = rankSentences(audio, limit);

    const parts: string[] = [];
    if (visualLines.length > 0) {
      parts.push('**On screen**', '', ...visualLines.map((line) => `- ${line}`), '');
    }
    if (audioSentences.length > 0) {
      parts.push('**Key points**', '', ...audioSentences.map((line) => `- ${line}`), '');
    }

    const content = parts.join('\n').trim();
    return {
      ...section,
      content: content.length > 0 ? content : section.content,
      metadata: { ...section.metadata, summarizer: 'extractive' },
    };
  }
}

/**
 * LLM-backed summariser with a hard guarantee: any failure (network, timeout,
 * empty response) degrades to the extractive result for that section instead of
 * failing the whole job.
 */
export class LLMSummarizer implements ISummarizer {
  constructor(
    private readonly _provider: ILLMProvider,
    private readonly _config: LLMConfig,
    private readonly _logger: ILogger,
    private readonly _fallback: ISummarizer = new ExtractiveSummarizer()
  ) {}

  async summarize(sections: NoteSection[], options: SummarizeOptions = {}): Promise<NoteSection[]> {
    const result: NoteSection[] = [];
    for (const section of sections) {
      result.push(await this.summarizeSection(section, options));
    }
    return result;
  }

  private async summarizeSection(section: NoteSection, options: SummarizeOptions): Promise<NoteSection> {
    const source = stripLabels(section.content).slice(0, 12000);
    if (source.trim().length === 0) {
      return section;
    }

    try {
      const response = await this._provider.complete(
        {
          systemPrompt:
            'You summarise video content into concise Markdown bullet points. ' +
            'Only use facts present in the supplied source. Do not invent timestamps, ' +
            'names, or numbers. Return bullets only, no preamble.',
          messages: [
            {
              role: 'user',
              content:
                `Section: ${section.title}\n` +
                (section.timestamp ? `Timestamp: ${section.timestamp.toISO()}\n` : '') +
                `\nSource:\n${source}\n\n` +
                'Write 3-8 Markdown bullet points capturing the key information.',
            },
          ],
          temperature: this._config.temperature,
          maxTokens: Math.min(this._config.maxTokens, 1024),
        },
        { signal: options.signal }
      );

      const content = response.content.trim();
      if (content.length === 0) {
        throw new Error('LLM returned an empty summary');
      }

      return {
        ...section,
        content,
        metadata: { ...section.metadata, summarizer: 'llm', model: response.model },
      };
    } catch (error) {
      this._logger.warn('LLM summarisation failed; using extractive fallback', {
        sectionId: section.id,
        error: error instanceof Error ? error.message : String(error),
      });
      const [fallback] = await this._fallback.summarize([section], options);
      return fallback ?? section;
    }
  }
}

/**
 * Split the aggregator's `**Visual Content:**` / `**Transcript:**` block back
 * into its two sources. Unknown formats are treated as transcript text.
 */
export function splitSectionContent(content: string): { visual: string; audio: string } {
  const visualMarker = '**Visual Content:**';
  const audioMarker = '**Transcript:**';
  const visualIndex = content.indexOf(visualMarker);
  const audioIndex = content.indexOf(audioMarker);

  if (visualIndex === -1 && audioIndex === -1) {
    return { visual: '', audio: content };
  }

  let visual = '';
  let audio = '';

  if (visualIndex !== -1) {
    const start = visualIndex + visualMarker.length;
    const end = audioIndex > visualIndex ? audioIndex : content.length;
    visual = content.slice(start, end).trim();
  }
  if (audioIndex !== -1) {
    audio = content.slice(audioIndex + audioMarker.length).trim();
  }

  return { visual, audio };
}

function stripLabels(content: string): string {
  const { visual, audio } = splitSectionContent(content);
  return [visual, audio].filter((part) => part.length > 0).join('\n');
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Frequency-rank sentences, then restore their original reading order. */
function rankSentences(text: string, limit: number): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.split(' ').length >= 4);

  if (sentences.length === 0) {
    return text.trim().length > 0 ? [text.trim().slice(0, 240)] : [];
  }

  const frequency = new Map<string, number>();
  for (const sentence of sentences) {
    for (const word of tokenize(sentence)) {
      frequency.set(word, (frequency.get(word) ?? 0) + 1);
    }
  }

  const scored = sentences.map((sentence, index) => ({
    sentence,
    index,
    score: tokenize(sentence).reduce((acc, word) => acc + (frequency.get(word) ?? 0), 0) /
      Math.sqrt(Math.max(1, sentence.split(' ').length)),
  }));

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit))
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.sentence);
}

function tokenize(sentence: string): string[] {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}
