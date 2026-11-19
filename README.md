# Video-to-Notes

> Transform video content into structured, searchable Markdown notes with timestamps, citations, and grounded summaries.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)

## Overview

Video-to-Notes is a TypeScript application that processes MP4 videos into structured Markdown notes with:

- **Timestamps** - Every piece of content linked to its source time
- **Citations** - Grounded summaries with verifiable source references
- **Scene detection** - Automatic identification of visual transitions
- **OCR extraction** - Text recognition from visual frames
- **Transcription** - Speech-to-text with word-level timestamps
- **Multi-LLM support** - Harness, OpenAI, Anthropic, Google, DeepSeek, Ollama, custom endpoints

## Architecture

Built with **Clean Architecture** (Ports & Adapters):

```
src/
├── domain/           # Pure TypeScript - entities, value objects, domain services
├── application/      # Use cases, ports (interfaces)
├── infrastructure/   # Adapters (FFmpeg, Whisper, Tesseract, LLM providers)
└── interfaces/       # CLI, Harness Plugin, REST API
```

### Key Components

| Component | Technology |
|-----------|------------|
| Frame Extraction | FFmpeg (PTS-based timestamps) |
| OCR Processing | Tesseract.js |
| Transcription | Whisper.cpp / faster-whisper |
| Scene Detection | PySceneDetect |
| Timestamp Alignment | PTS master clock + semantic embedding |
| LLM Providers | Harness, OpenAI, Anthropic, Google, DeepSeek, Ollama, Custom |
| Note Rendering | Markdown with citations |

## Pipeline Flow

```
Video Input
    │
    ├─► Metadata Extraction (FFprobe)
    │
    ├─► Parallel Processing
    │    ├─► Frame Extraction ──► OCR ──► Visual Text
    │    ├─► Audio Extraction ──► Transcription ──► Transcript
    │    └─► Scene Detection (PySceneDetect)
    │
    ├─► Timestamp Alignment (PTS + Embeddings)
    │
    ├─► Content Aggregation (Deduplication)
    │
    ├─► Grounded Summarization (Multi-LLM with citations)
    │
    └─► Note Rendering (Markdown/JSON/HTML)
```

## Installation

```bash
# Clone the repository
git clone https://github.com/rpmalukani22/video-to-notes.git
cd video-to-notes

# Install dependencies
npm install

# Install system dependencies
# Ubuntu/Debian:
sudo apt-get install ffmpeg tesseract-ocr python3-pip
pip3 install scenedetect

# macOS:
brew install ffmpeg tesseract python3
pip3 install scenedetect

# Windows:
# Download FFmpeg from https://ffmpeg.org/download.html
# Install Tesseract from https://github.com/UB-Mannheim/tesseract/wiki
# pip3 install scenedetect
```

## Quick Start

```bash
# Build the project
npm run build

# Process a video
npm run vtn -- analyze <input-video>

# With options
npm run vtn -- analyze <input-video> \
  --output-dir ./notes \
  --formats md,json \
  --preset tutorial \
  --provider ollama
```

### CLI Options

```bash
vtn analyze <video-path> [options]

Options:
  -o, --output-dir <path>     Output directory (default: ./output)
  -f, --formats <formats>     Output formats: md,json,html (default: md)
  -p, --preset <preset>       Frame extraction preset: lecture|tutorial|meeting|documentary
  --provider <provider>       LLM provider: harness|openai|anthropic|google|deepseek|ollama|custom
  --model <model>             Specific model to use
  --api-key <key>             API key for cloud providers
  --resume                    Resume from checkpoint
  --batch                     Batch process directory
```

## Configuration

Create a `.vtn/config.json` in your project root:

```json
{
  "frameExtraction": {
    "preset": "tutorial",
    "strategy": "uniform",
    "intervalSec": 5,
    "fastExtract": false
  },
  "ocr": {
    "enabled": true,
    "language": "eng",
    "psm": "6"
  },
  "transcription": {
    "model": "base.en",
    "language": "en",
    "enableVAD": true,
    "wordTimestamps": true
  },
  "llm": {
    "provider": "ollama",
    "model": "llama3.1:8b",
    "temperature": 0.3,
    "maxTokens": 8192,
    "requireCitations": true,
    "citationFormat": "inline"
  },
  "output": {
    "formats": ["md", "json"],
    "includeTimestamps": true,
    "includeCitations": true
  }
}
```

## Supported LLM Providers

| Provider | Models | Streaming | Structured Output | Citations |
|----------|--------|-----------|-------------------|-----------|
| Harness | Dynamic | ✅ | ✅ | ✅ |
| OpenAI | GPT-4o, GPT-4 Turbo | ✅ | ✅ | ✅ |
| Anthropic | Claude 3.5 Sonnet | ✅ | ✅ | ✅ |
| Google | Gemini 1.5 Pro | ✅ | ✅ | ✅ |
| DeepSeek | DeepSeek Chat/Coder | ✅ | ✅ | ✅ |
| Ollama | Local models (llama3, mistral, etc.) | ✅ | ❌ | ❌ |
| Custom | Any OpenAI-compatible endpoint | ✅ | ✅ | ✅ |

## Harness Plugin

Video-to-Notes integrates with DeepSeek Harness:

```bash
# Install as plugin
dsh plugin install video-to-notes

# Use in Harness
dsh video-to-notes analyze <input-video>
```

## REST API

Start the REST server:

```bash
npm run server
```

Endpoints:

- `POST /api/v1/analyze` - Analyze video (multipart upload)
- `GET /api/v1/jobs/:id` - Get job status
- `GET /api/v1/jobs/:id/download` - Download results
- `GET /api/v1/health` - Health check

## Output Formats

### Markdown (.md)
```markdown
# Video Analysis: <input-video>

## Summary
This video covers...

## Sections

### [00:00-05:30] Introduction
**Transcript**: Welcome to this tutorial...
**Visual**: Slide showing agenda
**Summary**: Overview of topics covered

**Citations**: [Transcript: 00:00-00:15], [OCR: 00:00-00:30]
```

### JSON (.json)
```json
{
  "video": { "id": "...", "path": "...", "duration": 3600 },
  "sections": [
    {
      "id": "sec_1",
      "start": "00:00:00",
      "end": "00:05:30",
      "transcript": "...",
      "visualText": "...",
      "summary": "...",
      "citations": [...]
    }
  ]
}
```

## Development

### Project Structure
```
video-to-notes/
├── src/
│   ├── domain/                 # Pure domain logic
│   │   ├── entities/          # Video, Frame, Transcript, Scene, Note
│   │   ├── value-objects/     # Timestamp, Confidence, BoundingBox
│   │   ├── events/            # Domain events
│   │   └── services/          # TimestampAligner, ContentAggregator
│   ├── application/           # Use cases & ports
│   │   ├── ports/             # Interfaces (15 ports)
│   │   └── use-cases/         # AnalyzeVideo, BatchProcess
│   ├── infrastructure/        # Adapters
│   │   └── adapters/          # FFmpeg, Whisper, Tesseract, LLM providers
│   └── interfaces/            # CLI, Harness plugin, REST API
├── tests/                     # Unit & integration tests
├── scripts/                   # Benchmark scripts
├── .vtn/                      # Local config & models
├── package.json
├── tsconfig.json
└── README.md
```

### Running Tests
```bash
# Unit tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

### Code Quality
```bash
# Lint
npm run lint

# Format
npm run format

# Type check
npm run typecheck
```

## Roadmap

### Sprint 1 (Weeks 1-2) - Foundation ✅
- [x] Clean Architecture setup
- [x] Domain entities & value objects
- [x] Ports & interfaces
- [x] TypeScript strict configuration
- [x] Unit test infrastructure

### Sprint 2 (Weeks 3-4) - Core Pipeline
- [ ] FFmpeg frame extractor
- [ ] Whisper transcription adapter
- [ ] Tesseract OCR adapter
- [ ] PySceneDetect scene analyzer
- [ ] Timestamp alignment service

### Sprint 3 (Weeks 5-6) - LLM Integration
- [ ] Multi-LLM provider abstraction
- [ ] Harness, OpenAI, Anthropic, Google, DeepSeek adapters
- [ ] Ollama & Custom endpoint support
- [ ] Circuit breaker & rate limiting

### Sprint 4 (Weeks 7-8) - Grounded Summarization
- [ ] Content aggregation & deduplication
- [ ] Structured output with citations
- [ ] Groundedness validator
- [ ] Citation normalizer

### Sprint 5 (Weeks 9-10) - Interfaces
- [ ] CLI (vtn command)
- [ ] Harness plugin
- [ ] REST API (Fastify + OpenAPI)
- [ ] Batch processing

### Sprint 6 (Weeks 11-12) - Hardening
- [ ] Integration tests
- [ ] Performance benchmarks
- [ ] Security audit
- [ ] Documentation

### Sprint 7 (Weeks 13-14) - Release
- [ ] Production hardening
- [ ] CI/CD pipeline
- [ ] Release automation
- [ ] Examples & tutorials

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Code Standards
- TypeScript strict mode
- ESLint + Prettier
- Conventional commits
- 100% type coverage target
- Unit tests for new features

## License

MIT License - see [LICENSE](LICENSE) for details.

## Author

**rpmalukani22** - [GitHub](https://github.com/rpmalukani22)

## Acknowledgments

- [FFmpeg](https://ffmpeg.org/) - Multimedia processing
- [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) - Fast transcription
- [Tesseract.js](https://github.com/naptha/tesseract.js) - OCR in browser/Node
- [PySceneDetect](https://scenedetect.com/) - Scene detection
- [DeepSeek Harness](https://github.com/deepseek-ai/dsh) - Agent framework