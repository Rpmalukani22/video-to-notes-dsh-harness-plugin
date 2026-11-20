# Plan — separate transcript / OCR artifacts + LLM-composed notes with screenshots

**Status:** proposed (awaiting approval)
**Target:** `C:\src\ai_workspace\video-to-notes` — DSH plugin bundle `video-to-notes`
**Date:** 2026-11-20
**Method:** AAS review discipline — every acceptance criterion below is a command or a file assertion, not a claim.

---

## 1. Problem

Today one run produces one Markdown file. Inside it, OCR lines and transcript lines are
interleaved sentence by sentence (`ContentAggregator.buildContent()` emits
`**Visual Content:**` then `**Transcript:**` per aligned block, and the extractive
summariser flattens both into bullets). The result is partial, hard to audit, and there is
no way to tell what the instructor actually *said* from what was on the *slide*.

The user needs three separate, individually trustworthy outputs per run:

| # | Artifact | Content | Author |
|---|---|---|---|
| 1 | `<base>.transcript.md` | Every recognised speech segment, timestamped, verbatim | whisper.cpp, unmodified |
| 2 | `<base>.ocr.md` | Every on-screen text block, timestamped, with confidence | Tesseract, unmodified |
| 3 | `<base>.md` | Coherent notes merging 1 + 2, with screenshots and correction call-outs | LLM (fallback: deterministic) |

Plus: detect the "audio is fine but the transcript is empty" failure mode and tell the user
exactly what to do (VAD off / ffmpeg clean-up), and honour `vad off` when the user asks for it.

---

## 2. Design decisions

**D1 — Evidence files are raw, notes are composed.**
The transcript and OCR files must be reproducible from the same inputs and must not pass
through a model. They are rendered by dedicated renderers, not by `Summarizer`. This means a
bad LLM result can never damage the evidence.

**D2 — New ports, no change to existing ones except where unavoidable.**
`INoteRenderer` keeps its contract. Two new ports carry the new work:

```ts
// application/ports/Interfaces.ts
export interface IEvidenceRenderer {
  renderTranscript(video: Video, transcript: Transcript, outputPath: string): Promise<void>;
  renderOcr(video: Video, frames: Frame[], scenes: Scene[], outputPath: string): Promise<void>;
}

export interface IScreenshotStore {
  /** Writes the frame's JPEG bytes and returns a path relative to the note file. */
  save(frame: Frame, directory: string, noteDir: string): Promise<string>;
}
```

`IAudioExtractor.extract` gains an optional 4th parameter (`{ enhance?: boolean }`) — additive,
so existing callers and tests keep working.

**D3 — Composition is a port, the fallback is a strategy.**
`ISummarizer` stays as the deterministic fallback. A new `IComposer` owns the merge:

```ts
// application/services/NoteComposer.ts
export interface ComposeInput {
  video: Video;
  sections: NoteSection[];
  transcript: Transcript;
  frames: Frame[];
  screenshots: ScreenshotRef[];   // already persisted, paths relative to the note
  detailLevel: NoteConfig['detailLevel'];
  signal?: AbortSignal | undefined;
}

export interface ComposeResult {
  sections: NoteSection[];
  corrections: string[];
  degraded: boolean;      // true when the extractive fallback produced the body
}

export interface IComposer {
  compose(input: ComposeInput): Promise<ComposeResult>;
}
```

`LLMNoteComposer` uses `ILLMProvider.complete`. `ExtractiveNoteComposer` is the offline path
and keeps the two sources visibly separate (`**On screen**` / `**Spoken**`) instead of
interleaving them.

**D4 — Screenshots are selected deterministically, then persisted.**
`selectScreenshots(frames, sections, max)` (pure, domain layer):
1. For each note section, take the first OCR citation's `frameId` that still exists → section
   representative frame.
2. Fill remaining slots with the highest-OCR-confidence frames, spread evenly over time
   (one frame per 30 s bucket), dedupe by second.
3. Cap at `note.screenshotCount` (default 12).

Persisted to `<outputDir>/<base>.assets/` as
`frame-<index>-<HHmMMs>.jpg`, exposed to Markdown as `./<base>.assets/frame-0007-00m03s.jpg`
(POSIX separators, relative to the note file, so the folder can be moved as a unit).

**D5 — Corrections are prompt-enforced and then verified.**
The composer prompt instructs the model to emit, verbatim and on their own lines:

```
> ⚠️ Correction: The instructor said "<claim>". Actually, <correct statement> — <basis>.
> ❓ Check: <claim the model could not verify>.
```

`LLMNoteComposer` post-processes the response: it extracts every `⚠️ Correction:` line into
`ComposeResult.corrections`, and appends a `## Corrections & verification` section. If a
correction line is malformed (no `Actually,` clause) it is downgraded to `❓ Check:` rather
than passed through as an authoritative claim. No web access is assumed: "verification" means
cross-checking the transcript against the on-screen text and the model's own knowledge, and
the prompt forbids inventing a basis.

**D6 — Audio quality is measured, not guessed.**
`analyzeWavQuality(path)` reads ~100 sparse 8 KB windows from the extracted 16 kHz mono WAV
(never the whole file) and returns an SNR estimate, peak level, and silent ratio. Combined
with transcript coverage (`speechSeconds / audioSeconds`) it produces one actionable hint:

- `transcript empty or coverage < 5 %` → "VAD likely stripped speech"
- `SNR < 12 dB` → "audio is noisy"

Both hints carry the exact remediation: `--vad false`, or the ffmpeg clean-up command.

**D7 — `vad off` is honoured at the tool boundary.**
`analyze_video` gains `vad` (boolean) and `enhanceAudio` (boolean). The tool description states
plainly: *"If the user says 'vad off', pass vad=false."* That is how a natural-language request
reaches the pipeline. `enhanceAudio` switches the extractor to
`highpass=f=80,afftdn=nr=12:nf=-30,loudnorm=I=-16:TP=-1.5:LRA=11`.

**D8 — Output ordering is stable.**
`outputFiles` = `[notes…, transcript, ocr]` so `JobView.notePath` (which reads `[0]`) still
points at the human-facing note. A new `artifacts` object names all three explicitly.

---

## 3. File-by-file work breakdown

### 3.1 Domain

| File | Change |
|---|---|
| `src/domain/entities/Note.ts` | `NoteFrontmatter.artifacts?` optional `{ transcript?: string; ocr?: string }`. `sectionToMarkdown()` renders `metadata.screenshots` as `![caption](path)` with a typed guard (no `as any`). |
| `src/domain/services/ScreenshotSelector.ts` | **new** — `ScreenshotRef`, `selectScreenshots()`, `screenshotFileName()`. Pure, unit-tested. |

### 3.2 Application

| File | Change |
|---|---|
| `src/application/ports/Interfaces.ts` | `IEvidenceRenderer`, `IScreenshotStore`, `AudioExtractionOptions`; `NoteConfig` gains `includeScreenshots`, `screenshotCount`, `emitTranscript`, `emitOcr`. |
| `src/application/services/NoteComposer.ts` | **new** — `IComposer`, `ComposeInput/Result`, `LLMNoteComposer`, `ExtractiveNoteComposer`, `extractCorrections()`. |
| `src/application/services/AudioDiagnostics.ts` | **new** — `assessAudio(quality, transcript, audio)` → `{ hints: AudioHint[] }`; pure, unit-tested. |
| `src/application/use-cases/AnalyzeVideo.ts` | Stage 9 becomes compose (falls back to `summarizer` when no composer). New stage 9b/10 writes transcript + OCR + screenshots. `AnalyzeVideoOutput` gains `artifacts`. Pipeline order: metadata → frames → audio → transcribe → OCR → scenes → align → aggregate → **screenshots → compose → render**. |

Pipeline detail (revised stages):

```
 8  aggregation            (unchanged)
 8b screenshot selection   selectScreenshots() → persist via IScreenshotStore
 9  composition            IComposer.compose()  (LLM, else extractive)
 9b audio diagnostics      analyzeWavQuality() + coverage → warnings/hints
10  rendering              notes (md/json/html) + transcript.md + ocr.md
```

### 3.3 Infrastructure

| File | Change |
|---|---|
| `src/infrastructure/adapters/MarkdownEvidenceRenderer.ts` | **new** — transcript + OCR Markdown. |
| `src/infrastructure/adapters/FileScreenshotStore.ts` | **new** — `writeFile` JPEG bytes, relative path out. |
| `src/infrastructure/audio/WavQualityAnalyzer.ts` | **new** — sparse-window WAV analysis. |
| `src/infrastructure/adapters/FfmpegAudioExtractor.ts` | optional `enhance` filter chain. |
| `src/infrastructure/composition/createServices.ts` | wire the three new adapters + `IComposer`; `DelegatingComposer` mirrors `DelegatingSummarizer` so `init()` can still choose LLM vs offline. |

### 3.4 Plugin

| File | Change |
|---|---|
| `src/plugin/tools/analyzeVideo.ts` | `vad`, `enhanceAudio` params; description mentions 3 artifacts and the `vad off` phrase. |
| `src/plugin/tools/getNote.ts` | expose `artifacts` + `audioHints` in the status result/render. |
| `src/plugin/service/VideoNotesService.ts` | carry `vad`/`enhanceAudio`; `JobView.artifacts`, `JobView.audioHints`. |
| `src/plugin/config.ts` | `includeScreenshots`, `screenshotCount`, `emitTranscript`, `emitOcr`. |
| `src/infrastructure/adapters/YamlConfigProvider.ts` | defaults for the new `NoteConfig` fields. |

---

## 4. Artifact formats

### 4.1 `<base>.transcript.md`

```markdown
---
schemaVersion: "1.0"
videoId: 6f1c…
sourcePath: C:\videos\lecture.mp4
duration: "00:42:11.400"
language: en
model: base.int8
vad: true
segments: 512
generatedAt: 2026-11-20T09:12:44.001Z
---

# Transcript — lecture

> Raw speech recognition output. Not edited, not summarised.

- `[00:00:01.240 → 00:00:06.880]` Welcome back. Today we cover indexing.
- `[00:00:06.880 → 00:00:11.320]` The first thing to understand is the B-tree.
```

### 4.2 `<base>.ocr.md`

```markdown
---
schemaVersion: "1.0"
videoId: 6f1c…
frames: 214
framesWithText: 96
generatedAt: 2026-11-20T09:12:44.001Z
---

# On-screen text — lecture

> Raw OCR output, grouped by scene. Duplicate consecutive text is collapsed.

## Scene 1 — 00:00:00.000 → 00:02:14.000

### `[00:00:03.000]` confidence 0.91
SELECT * FROM orders WHERE customer_id = 42;

### `[00:01:40.000]` confidence 0.88
Index scan vs. sequential scan
```

### 4.3 `<base>.md` (notes)

```markdown
# Indexing in PostgreSQL

## 1. Why indexes exist  `[00:00:01]`

- Sequential scan reads every row; an index turns that into a bounded lookup.
- Cost model prefers the index only when selectivity is high.

![Slide: index vs. sequential scan](./lecture.assets/frame-0002-00m01s.jpg)

### Corrections & verification

> ⚠️ Correction: The instructor said "an index always makes a query faster".
> Actually, an index adds write cost and is ignored for low-selectivity predicates — the planner
> chooses the cheaper plan.
```

---

## 5. Validation plan (each item is a command or an assertion)

### 5.1 Static

```powershell
npx tsc --noEmit -p tsconfig.json          # 0 errors
npm run build                              # exit 0
npx vitest run                             # all suites pass
```

No `@ts-ignore`, no `as any`, no `eslint-disable` added.

### 5.2 New unit tests

| Test | Asserts |
|---|---|
| `ScreenshotSelector.test.ts` | caps at N; one per section; time-spread fill; dedupe by second |
| `NoteComposer.test.ts` | correction extraction; malformed correction downgraded to `Check:`; LLM failure → extractive, `degraded === true`; transcript and OCR never interleaved line-by-line |
| `AudioDiagnostics.test.ts` | empty transcript + long audio → VAD hint; SNR < 12 → noise hint; healthy input → no hint |
| `WavQualityAnalyzer.test.ts` | synthesised WAV: pure tone reports high SNR, white noise reports low SNR |
| `MarkdownEvidenceRenderer.test.ts` | timestamp format, duplicate collapse, frontmatter counts |

### 5.3 End-to-end

Input: `C:\Users\ruchi\AppData\Local\Temp\opencode\vtn-e2e2\sample.mp4` (3 slides + speech).

```powershell
node dist/cli.js analyze "<sample>" --output "C:\Users\ruchi\AppData\Local\Temp\opencode\vtn-e2e3"
Get-ChildItem "...\vtn-e2e3"
```

Acceptance:
- `sample.transcript.md`, `sample.ocr.md`, `sample.md` all exist and are non-empty.
- `sample.md` does **not** contain the literal `**Visual Content:**` (the old interleaved markers).
- `sample.assets\` exists with ≥ 1 `.jpg`, every `![](...)` in `sample.md` resolves to a real file.
- `sample.transcript.md` segment count equals the whisper segment count.
- `sample.ocr.md` frame count equals the OCR-processed frame count.

### 5.4 Degradation checks

| Scenario | Expected |
|---|---|
| Tesseract absent | `ocr.md` written with a "no OCR available" note; run succeeds |
| No LLM configured | `sample.md` produced by extractive composer, `degraded: true` surfaced in warnings |
| Audio track present, transcript empty | warning contains `vad off` **and** the ffmpeg command |
| `vad=false` passed | whisper args contain no `--vad`; frontmatter `vad: false` |

### 5.5 Plugin contract

```powershell
node -e "import('video-to-notes').then(m => console.log(Object.keys(m)))"
# -> [ 'Config', 'apply', 'inject', 'name' ]
& "$env:APPDATA\npm\dsh.cmd" web --port 0 --no-open   # boots, no failed-plugin warning
```

---

## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| LLM drops or rewrites evidence | Notes never replace the evidence files; corrections are separately listed; fallback keeps raw material |
| Prompt-injection from video content | Composer system prompt explicitly marks transcript/OCR as untrusted data, not instructions |
| Huge videos blow the context window | Compose per section when source > 12 k chars; per-section calls are bounded |
| Screenshot folder breaks portability | Relative POSIX links; assets folder named after the note |
| `NoteFrontmatter` change breaks JSON consumers | New fields are optional; schema version unchanged (additive) |
| Longer runs | One extra ffmpeg pass only when `enhanceAudio`; WAV analysis is sparse read |

## 7. Rollback

Single commit, no schema migration. Reverting the commit restores the previous single-file
behaviour; generated notes are data, not code, so old outputs stay readable.

---

## 8. AAS status

The Agentic Awesome Skills **runtime** (`compose_stack`, `inspect_stack`, `open_workbench`) is
not reachable: no MCP server is registered in this session (`list_mcp_resources` → empty), and
only `SKILL.md` metadata exists under `~/.dsh/skills`. What *is* available — and what this plan
uses — is the AAS review discipline applied directly: reproduce before claiming, one command
per claim, evidence table before verdict. Implementation will follow that, and the final review
will state exactly which command backs each line.
