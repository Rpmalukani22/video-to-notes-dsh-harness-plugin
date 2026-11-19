# Status

**Version:** 0.1.0
**Date:** 2026-11-19
**Scope:** the TypeScript project at `C:\src\ai_workspace\video-to-notes`

This file replaces the earlier `REVIEW_SIGN_OFF.md`, which claimed 100/100 for
features that did not exist (web UI, embedding alignment, groundedness
validator, seven-provider parity). Nothing below is aspirational: each item is
either implemented and verified, degrades by design, or explicitly deferred.

---

## Verified

| Check | Command | Result |
| --- | --- | --- |
| Type check / build | `npm run build` | exit 0 |
| Unit tests | `npx vitest run` | 6 files, 85 tests passed |
| Plugin shape | `import('./dist/plugin/index.js')` | exports `name`, `inject`, `Config`, `apply`; no default export |
| Tool registration | plugin mounted on a real Cordis 4.1 context | registers `analyze_video`, `video_note_status`, `video_notes_doctor` with compiled schemas |
| Profile install | `dsh plugin --profile web add <repo>` | exit 0 against dsh 0.2.2-rc.5; bundle linked and listed in `dsh.profile.bundles` |
| Profile boot | `dsh --profile web --no-open --port 0` | starts and prints the UI URL; no bundle-skip or plugin error |
| CLI help | `node dist/cli.js --help` | exit 0 |
| Environment check | `node dist/cli.js doctor --verbose` | exit 0 with ffmpeg/ffprobe present |
| End-to-end | 6 s synthetic MP4 | note written in 2.8 s; warnings for missing Whisper and Tesseract |

The end-to-end run was performed on a machine with ffmpeg/ffprobe installed and
without Tesseract, `whisper-cli`, or a Whisper model. It confirms the degraded
path, not OCR or transcription quality.

---

## Implemented

**Pipeline**

- ffprobe metadata, ffmpeg frame extraction (scene filter + interval fallback),
  ffmpeg audio extraction.
- Whisper.cpp transcription with VAD, word timestamps, and optional model
  escalation.
- Tesseract OCR per frame.
- PySceneDetect scene analysis with an ffmpeg fallback.
- Timestamp alignment and section aggregation.
- Deterministic offline `ExtractiveSummarizer` (default) and an `LLMSummarizer`
  that falls back per section on any failure.
- Markdown, JSON, and HTML rendering.

**Interfaces**

- CLI: `analyze`, `batch`, `doctor`.
- DSH bundle: `name`, `inject: ['tools']`, schemastery `Config`, `apply`.
- Three tools with value-schema DSL output definitions verified at runtime.
- In-memory `JobRegistry` with bounded concurrency and immediate job ids.
- Library barrel at `./library`.

**Configuration**

- Plugin config: ffmpeg/ffprobe/tesseract/whisper paths, model directory,
  output directory, concurrency, log level, optional YAML file.
- YAML `processing` and `llm` blocks layered over defaults.
- LLM providers: `none`, `harness`, `deepseek`, `openai`, `anthropic`,
  `google`, `ollama`, `custom`.
- API keys read from the environment, never written to disk.

**Robustness**

- Every external binary is spawned with `spawn(bin, args)`, never a shell.
- Optional stages record warnings and continue instead of aborting.
- Batch checkpoints are per completed video.
- Absolute-path validation with actionable errors in plugin tools.
- Streamed LLM responses keep their timeout armed for the whole body and
  release the reader in `finally`.

---

## Degrades by design

| Condition | Behaviour |
| --- | --- |
| Tesseract missing | OCR stage warns; note has no on-screen bullets |
| `whisper-cli` or model missing | transcription stage warns; note has no transcript bullets |
| PySceneDetect missing or slow | ffmpeg scene timestamps are used |
| LLM absent or failing | extractive summariser is used |
| No content aggregated | a single overview section is emitted with a warning |

Degraded output is still a valid note. The warning strings are part of the
observable contract and appear in CLI output and `video_note_status`.

---

## Deliberately deferred

These were in the original plan or the review but are **not implemented**:

- Web UI or REST server.
- Embedding-based semantic alignment and vector search.
- Groundedness/citation validator beyond "summariser may only use supplied
  source text".
- Speaker diarization.
- Mid-pipeline checkpoint resume (only whole-video checkpoints exist).
- Batch execution inside the harness (CLI only).
- Native installers or prebuilt binaries.

The README lists these as limitations rather than features.

---

## Known environment caveats

- A cold PySceneDetect start can exceed the 5 s `doctor` probe timeout. Analysis
  falls back to ffmpeg scene timestamps, so a timeout is cosmetic. The timeout
  is set in `src/infrastructure/composition/createServices.ts`.
- `npm install` reports 14 audit vulnerabilities in the dev/build toolchain.
  They were not force-fixed because doing so would upgrade major versions of
  test/build dependencies; they do not affect the runtime pipeline.
- npm warns about the `esbuild@0.21.5` postinstall script. It is a transitive
  dependency of Vitest; the install was completed without approving the script.

---

## Review traceability

`REVIEW_AAS_2026-11-19.md` contains 44 findings. The code changes tied to them
fall into these groups:

1. **Dead or contradictory domain code** — fixed (`Confidence` comparisons,
   `Timestamp` constructors, `Video` mutators, `OCRResult`, aggregator imports).
2. **Missing adapters** — implemented (logger, metrics, checkpoints, secrets,
   renderer, resource pool, YAML config, ffmpeg, Tesseract, Whisper,
   PySceneDetect, cloud/local LLMs).
3. **Missing application layer** — implemented (`AnalyzeVideo`, `BatchProcess`,
   `Summarizer`).
4. **Broken DSH integration** — fixed (`"type": "module"`, `.js` specifiers,
   exports map, `cordis.patch.yml`, peer deps, plugin entry, tool schemas).
5. **Build/test configuration** — fixed (ESM-safe tests, dead path aliases,
   fixture intent, TS strictness).
6. **False documentation** — this file and the README replace it.

Items 1–5 are covered by the green build and test run above. Item 6 is this
document plus `README.md`.

---

## How to verify locally

```powershell
npm install
npm run build
npx vitest run
node dist/cli.js doctor --verbose
node dist/cli.js analyze "C:\path\to\video.mp4" --json
```

For the plugin (needs `pnpm` on `PATH`; `npx @deepseek-ai/dsh` is the same
launcher as `dsh`):

```powershell
npx @deepseek-ai/dsh plugin --profile web add C:\src\ai_workspace\video-to-notes
npx @deepseek-ai/dsh --profile web --dump-config   # must list video-to-notes
npx @deepseek-ai/dsh web
```

`package.json` declares `engines.dsh: ^0.2.2-rc.1`; without it the plugin manager
compares the `@deepseek-ai/dsh-tools` peer (`0.2.2-rc.1`) with the running
runtime and rejects the install.

Acceptance: the three tools appear in the model's tool list; a bad path returns
a readable error; a valid path produces a `.md` file whose sections carry
timestamps.
