#!/usr/bin/env node
// Deterministic OpenAI-compatible stub used by the offline LLM E2E path.
import { createServer } from 'node:http';

const PORT = Number(process.env.VTN_STUB_PORT ?? 4399);
const SENTINEL = 'Return your findings as VALIDATION_RESULT JSON conforming to the schema.';
const CORRECTION_JSON = JSON.stringify({
  missingTranscript: [],
  missingOcr: [],
  corrections: [],
  incomplete: [],
  degraded: false,
});

function chatCompletion(content) {
  return {
    id: 'stub',
    object: 'chat.completion',
    created: 0,
    model: 'stub-v1',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function seeded(prompt) {
  // The sentinel wins: validator prompts also contain the transcript's "Python 2".
  if (prompt.includes(SENTINEL)) return CORRECTION_JSON;
  if (prompt.includes('Python 2')) {
    return '> ⚠️ **Instructor said "Python 2" — actually Python 3** (basis: "Python 3" @ 00:00:05.000 [ocr])';
  }
  return '- **Index scans** are efficient.\n- **Python 3** is used.';
}

const server = createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'stub-v1', object: 'model' }] }));
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      let prompt = body;
      try {
        const parsed = JSON.parse(body);
        prompt = (parsed.messages ?? []).map((m) => m.content ?? '').join('\n');
      } catch {
        // fall back to the raw body
      }
      res.end(JSON.stringify(chatCompletion(seeded(prompt))));
    });
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`stub-llm-server listening on 127.0.0.1:${PORT}\n`);
});
