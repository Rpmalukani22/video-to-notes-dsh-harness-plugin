import { mkdir, writeFile } from 'fs/promises';
import { dirname, extname } from 'path';
import { Note } from '../../domain/entities/Note.js';
import { INoteRenderer } from '../../application/ports/Interfaces.js';

/**
 * Renders a domain `Note` to Markdown, JSON, or a small self-contained HTML
 * document, choosing the format from the output file extension.
 */
export class MarkdownNoteRenderer implements INoteRenderer {
  async render(note: Note, outputPath: string): Promise<void> {
    await mkdir(dirname(outputPath), { recursive: true });
    const format = extname(outputPath).toLowerCase();
    const body = format === '.json'
      ? JSON.stringify(note.toJSON(), null, 2)
      : format === '.html'
        ? renderHtml(note)
        : note.toMarkdown();
    await writeFile(outputPath, body, 'utf8');
  }

  getSupportedFormats(): string[] {
    return ['md', 'json', 'html'];
  }

  /** Render to a string without touching the filesystem. */
  renderToString(note: Note, format: 'md' | 'json' | 'html' = 'md'): string {
    if (format === 'json') return JSON.stringify(note.toJSON(), null, 2);
    if (format === 'html') return renderHtml(note);
    return note.toMarkdown();
  }
}

function renderHtml(note: Note): string {
  const markdown = note.toMarkdown();
  const { frontmatter, body } = splitFrontmatter(markdown);
  const title = escapeHtml(String(frontmatter['sourcePath'] ?? note.videoId));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; line-height: 1.6; max-width: 52rem; margin: 2rem auto; padding: 0 1rem; }
  pre { background: rgba(127,127,127,.12); padding: .75rem; overflow-x: auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  blockquote { border-left: 3px solid rgba(127,127,127,.4); margin-left: 0; padding-left: 1rem; }
  .meta { font-size: .85rem; opacity: .7; }
</style>
</head>
<body>
${Object.keys(frontmatter).length > 0 ? `<p class="meta">${Object.entries(frontmatter).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`).join('<br>')}</p>` : ''}
${markdownToHtml(body)}
</body>
</html>
`;
}

function splitFrontmatter(markdown: string): { frontmatter: Record<string, string>; body: string } {
  if (!markdown.startsWith('---\n')) return { frontmatter: {}, body: markdown };
  const end = markdown.indexOf('\n---\n', 4);
  if (end < 0) return { frontmatter: {}, body: markdown };
  const frontmatter: Record<string, string> = {};
  for (const line of markdown.slice(4, end).split('\n')) {
    const sep = line.indexOf(': ');
    if (sep > 0) frontmatter[line.slice(0, sep).trim()] = line.slice(sep + 2).trim();
  }
  return { frontmatter, body: markdown.slice(end + 5) };
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];
  let inCode = false;
  let listOpen = false;

  const closeList = (): void => {
    if (listOpen) {
      out.push('</ul>');
      listOpen = false;
    }
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      closeList();
      out.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(escapeHtml(line));
      continue;
    }
    if (/^\s*$/.test(line)) {
      closeList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1]?.length ?? 1;
      out.push(`<h${level}>${inline(heading[2] ?? '')}</h${level}>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      if (!listOpen) {
        out.push('<ul>');
        listOpen = true;
      }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      closeList();
      out.push(`<blockquote>${inline(line.replace(/^\s*>\s?/, ''))}</blockquote>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
