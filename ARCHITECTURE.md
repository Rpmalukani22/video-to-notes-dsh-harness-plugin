# Architecture

This document describes the code that exists in this repository. For planned
but unimplemented work, see `STATUS.md`.

---

## Shape

The project is a TypeScript ESM package with four layers:

```text
src/
  domain/            pure entities, value objects, domain services
  application/       use cases, ports, summarisation
  infrastructure/    adapters and the composition root
  plugin/            DeepSeek Harness bundle entry and tools
  cli.ts             standalone command line
  index.ts           library barrel
```

Dependencies point inward:

```text
cli.ts / plugin/  ->  application/  ->  domain/
        \              ^
         \             |
          infrastructure/ (implements application ports)
```

`domain` imports nothing from the other layers. `application` depends on ports
(interfaces), never on adapters. The composition root wires concrete adapters to
the use cases.

---

## Domain

| Module | Responsibility |
| --- | --- |
| `value-objects/Timestamp` | millisecond-precision time with parsing/formatting |
| `value-objects/Confidence` | clamped 0..1 confidence with comparisons |
| `value-objects/BoundingBox` | inclusive intersection for OCR regions |
| `value-objects/OCRResult` | recognised text plus confidence and box |
| `entities/Video` | source path, metadata, content hash |
| `entities/Frame` | extracted frame with timestamp and optional OCR |
| `entities/Transcript` | ordered segments with word timestamps |
| `entities/Scene` | detected scene boundary |
| `entities/Note` | title, sections, transcript reference, frontmatter |
| `services/TimestampAligner` | joins visual and audio content near a scene |
| `services/ContentAggregator` | groups aligned blocks into timestamped sections |

The domain has no I/O and no external dependencies.

---

## Application

**Ports** (`src/application/ports/Interfaces.ts`) define every external
capability: metadata extraction, frame extraction, audio extraction, OCR,
transcription, scene analysis, rendering, LLM access, configuration, secrets,
checkpoints, resource pooling, metrics, and logging.

**Use cases**

- `AnalyzeVideo` runs the ten-stage pipeline for one video and returns the
  `Note`, the `Video`, output paths, timing, and warnings.
- `BatchProcess` finds videos with `fast-glob`, runs `AnalyzeVideo` with bounded
  concurrency, and writes per-video checkpoints.

**Summarisation**

- `ExtractiveSummarizer` is deterministic and offline. It preserves on-screen
  text verbatim and ranks transcript sentences by term frequency while keeping
  their original order.
- `LLMSummarizer` sends each section to a provider. Any failure, timeout, or
  empty response falls back to the extractive result for that section, so an
  LLM outage cannot fail a job.

The pipeline always has a summariser. An LLM is optional.

---

## Infrastructure

Each application port has one adapter:

| Port | Adapter |
| --- | --- |
| `IVideoMetadataExtractor` | `FfmpegVideoMetadataExtractor` (ffprobe) |
| `IFrameExtractor` | `FfmpegFrameExtractor` (scene filter + interval fallback) |
| `IAudioExtractor` | `FfmpegAudioExtractor` (mono 16 kHz WAV) |
| `IOCRProcessor` | `TesseractOCRProcessor` |
| `ITranscriptionEngine` | `WhisperTranscriptionEngine` (whisper.cpp) |
| `ISceneAnalyzer` | `PySceneDetectSceneAnalyzer` (ffmpeg fallback) |
| `INoteRenderer` | `MarkdownNoteRenderer` (Markdown, JSON, HTML) |
| `ILLMProvider` | cloud, local, and harness providers |
| `IConfigurationProvider` | `YamlConfigProvider` |
| `ISecretProvider` | `EnvSecretProvider` |
| `ICheckpointStore` | `JsonCheckpointStore` |
| `IResourcePool` | `SimpleResourcePool` |
| `IMetricsCollector` | `InMemoryMetricsCollector` |
| `ILogger` | `ConsoleLogger`, `NullLogger` |

External binaries are always spawned as `spawn(bin, args[])` with an argument
array. No adapter uses `shell: true`, so video paths and model names are never
interpreted by a shell.

### Composition root

`src/infrastructure/composition/createServices.ts` owns the object graph:

```ts
const services = createServices({ outputDir, configPath, ffmpegPath });
await services.init();          // loads YAML, selects the LLM provider
const result = await services.analyzeVideo.execute(input, services.createContext());
services.dispose();
```

`init()` is memoized. If initialization fails, the promise is cleared so a
later retry is possible. `doctor()` probes each binary with a 5 s timeout and
reports which LLM provider is active.

---

## Pipeline

`AnalyzeVideo.execute()` reports progress at every stage:

1. `init` — validate input and read the video.
2. `metadata` — ffprobe duration, resolution, fps, codecs.
3. `frames` — scene-based extraction with interval fallback.
4. `audio` — extract mono 16 kHz audio.
5. `transcription` — whisper.cpp with VAD and optional escalation.
6. `ocr` — Tesseract per frame.
7. `scenes` — PySceneDetect, or ffmpeg fallback.
8. `alignment` — pair frames and transcript segments by time.
9. `aggregation` — build sections.
10. `summarization`, `rendering` — summarise and write files.

Stages 5–7 are optional. A failure there records a warning and continues.

### Degradation contract

| Condition | Outcome |
| --- | --- |
| Tesseract missing | OCR warning; no on-screen bullets |
| Whisper or model missing | transcription warning; no transcript bullets |
| PySceneDetect missing | ffmpeg scene timestamps |
| LLM failure | extractive fallback per section |
| No aggregated sections | one overview section plus a warning |

Warnings are part of the result object and are surfaced by the CLI and by
`video_note_status`.

---

## DeepSeek Harness plugin

`src/plugin/index.ts` exports exactly the Cordis contract:

```ts
export const name = 'video-to-notes';
export const inject = ['tools'];
export { Config };
export async function apply(ctx, config) { ... }
```

- `Config` is a schemastery object with a default for every key.
- `apply` registers three tools and an `ctx.effect` teardown.
- Services are created lazily on the first tool call, so loading the bundle
  spawns nothing.
- The harness `llm` service is read through `ctx.reflect.get('llm')` and
  shape-checked (`listProviders`, `listModels`, `stream`) before use. If it is
  absent, the offline summariser is used.

Tools:

| Tool | Behaviour |
| --- | --- |
| `analyze_video` | validates paths, enqueues a job, returns `jobId` immediately |
| `video_note_status` | reports progress and returns the note preview when done |
| `video_notes_doctor` | reports binary availability and LLM provider |

`JobRegistry` bounds concurrency and tracks queued, running, completed, and
failed jobs. Tool output schemas use the dsh-tools value-schema DSL: an object
root declares `additionalProperties`, and required fields are marked
`required: true` per property.

---

## Configuration

Precedence is CLI/plugin option, then YAML, then defaults.

- `processing` controls frame extraction, OCR, transcription, note rendering,
  privacy, and batch behaviour.
- `llm` selects a provider and its parameters.

API keys are read from environment variables through `EnvSecretProvider`; no
key is written to disk or included in a note.

---

## Testing

`tests/unit` contains Vitest tests for the domain and the Whisper model
resolver. Tests import source TypeScript directly; the production build uses
NodeNext ESM with explicit `.js` specifiers.

```powershell
npm run build
npx vitest run
```
