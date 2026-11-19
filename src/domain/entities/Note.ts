import { Timestamp } from '../value-objects/Timestamp.js';

/**
 * Note section - hierarchical structure
 */
export interface NoteSection {
  id: string;
  title: string;
  level: number;              // Heading level (1-4)
  timestamp: Timestamp | null; // Associated timestamp
  content: string;            // Markdown content
  subsections: NoteSection[];  // Nested sections
  citations: Citation[];       // Source citations
  metadata: Record<string, unknown>;
}

export interface Citation {
  text: string;
  source: 'ocr' | 'transcript' | 'scene';
  timestamp: string;           // HH:MM:SS.mmm format
  frameId?: string | undefined;
  segmentId?: string | undefined;
  confidence: number;
}

/**
 * Note frontmatter metadata
 */
export interface NoteFrontmatter {
  schemaVersion: string;
  videoId: string;
  sourcePath: string;
  contentHash: string;
  duration: string;            // HH:MM:SS.mmm
  resolution: string;
  fps: string;                 // Rational format
  processingConfig: ProcessingConfigSummary;
  generatedAt: string;         // ISO 8601
  processingTimeMs: number;
  tags: string[];
}

export interface ProcessingConfigSummary {
  preset: string;
  frameExtraction: {
    strategy: string;
    sceneThreshold: number;
    intervalSec: number;
  };
  ocr: {
    psm: string;
    languages: string[];
    confidenceThreshold: number;
  };
  transcription: {
    model: string;
    enableVAD: boolean;
    vocabularyBoost?: string;
  };
  privacy: string;
}

/**
 * Note aggregate root - the final output
 */
export class Note {
  private readonly _id: string;
  private readonly _videoId: string;
  private readonly _frontmatter: NoteFrontmatter;
  private readonly _sections: NoteSection[];
  private readonly _schemaVersion: string;
  private readonly _generatedAt: Date;
  private readonly _processingConfig: object;

  constructor(
    id: string,
    videoId: string,
    frontmatter: NoteFrontmatter,
    sections: NoteSection[],
    processingConfig: object
  ) {
    this._id = id;
    this._videoId = videoId;
    this._frontmatter = frontmatter;
    this._sections = sections;
    this._schemaVersion = '1.0';
    this._generatedAt = new Date();
    this._processingConfig = processingConfig;
  }

  get id(): string {
    return this._id;
  }

  get videoId(): string {
    return this._videoId;
  }

  get frontmatter(): NoteFrontmatter {
    return this._frontmatter;
  }

  get sections(): NoteSection[] {
    return this._sections;
  }

  get schemaVersion(): string {
    return this._schemaVersion;
  }

  get generatedAt(): Date {
    return this._generatedAt;
  }

  get processingConfig(): object {
    return this._processingConfig;
  }

  getAllSections(flat: boolean = true): NoteSection[] {
    const result: NoteSection[] = [];
    const collect = (sections: NoteSection[]) => {
      for (const section of sections) {
        result.push(section);
        if (flat && section.subsections.length > 0) {
          collect(section.subsections);
        }
      }
    };
    collect(this._sections);
    return result;
  }

  getAllCitations(): Citation[] {
    const citations: Citation[] = [];
    const collect = (sections: NoteSection[]) => {
      for (const section of sections) {
        citations.push(...section.citations);
        if (section.subsections.length > 0) {
          collect(section.subsections);
        }
      }
    };
    collect(this._sections);
    return citations;
  }

  getSectionById(id: string): NoteSection | null {
    const sections = this.getAllSections(true);
    return sections.find(s => s.id === id) || null;
  }

  getWordCount(): number {
    return this._sections.reduce((acc, s) => {
      const words = s.content.split(/\s+/).filter(w => w.length > 0).length;
      return acc + words + s.subsections.reduce((subAcc, sub) => subAcc + sub.content.split(/\s+/).filter(w => w.length > 0).length, 0);
    }, 0);
  }

  toMarkdown(): string {
    const frontmatter = '---\n' + Object.entries(this._frontmatter)
      .map(([key, value]) => {
        if (typeof value === 'object') {
          return `${key}: ${JSON.stringify(value)}`;
        }
        return `${key}: ${value}`;
      })
      .join('\n') + '\n---\n\n';

    const sections = this._sections.map(s => this.sectionToMarkdown(s)).join('\n\n');
    return frontmatter + sections;
  }

  private sectionToMarkdown(section: NoteSection, depth: number = 0): string {
    const heading = '#'.repeat(Math.min(section.level, 4));
    let md = `${heading} ${section.title}\n\n`;
    
    if (section.timestamp) {
      md += `*Timestamp: ${section.timestamp.toISO()}*\n\n`;
    }
    
    md += section.content + '\n\n';
    
    if (section.citations.length > 0) {
      md += '*Citations:*\n';
      for (const citation of section.citations) {
        md += `- [${citation.timestamp}] ${citation.source}: ${citation.text.substring(0, 100)}...\n`;
      }
      md += '\n';
    }

    for (const subsection of section.subsections) {
      md += this.sectionToMarkdown(subsection, depth + 1);
    }

    return md;
  }

  toJSON(): object {
    return {
      id: this._id,
      videoId: this._videoId,
      schemaVersion: this._schemaVersion,
      frontmatter: this._frontmatter,
      sections: this._sections,
      generatedAt: this._generatedAt.toISOString(),
      processingConfig: this._processingConfig
    };
  }
}