---
name: video-to-notes
description: "Convert a local video into three Markdown artifacts: combined LLM notes with screenshots, a full transcript, and OCR text. Supports Hinglish/Hindi, VAD off and audio enhancement. CRITICAL: analyze_video is ASYNC - you MUST poll video_note_status until status is completed before reporting results."
category: productivity
risk: safe
tags: [video, notes, transcription, ocr, whisper, ffmpeg]
---

# Video to Notes

Converts a local video into **three** Markdown files plus a supporting screenshots folder:

1. **Synthesized Notes (with screenshots):** `[video]_notes.md` — combined LLM notes with **bold** key points, screenshot embeds, vision validation callouts and a `## Validation & Accuracy` section.
2. **Full Raw Transcript:** `[video]_transcript.md` — timestamped, verbatim speech.
3. **On-Screen Text:** `[video]_ocr.md` — deduplicated, timestamped text read from frames.

Screenshots are saved to `[video]_frames/`. You (the harness) then create a fourth, reader-ready file **`[video]_CURATED_NOTES.md`** from all three reports plus the frames — see step 5 below.

## Tools Available

- `video_notes_doctor`: checks ffmpeg, ffprobe, tesseract, whisper-cli, scenedetect and LLM status.
- `analyze_video`: **starts** analysis and returns a `jobId` immediately. It does NOT return notes.
- `video_note_status`: reports progress and, when the job is `completed`, returns the note plus all three file paths.

## MANDATORY workflow — do not skip step 3

1. **(Optional) Verify environment:** call `video_notes_doctor({ verbose: true })`.

2. **Start the job** with `analyze_video`:
   ```json
   {
     "videoPath": "C:/path/to/video.mp4",
     "preset": "lecture",
     "vadEnabled": true,
     "enhanceAudio": false
   }
   ```
   - Save the returned `jobId`.

3. **WAIT UNTIL COMPLETE — THIS IS THE STEP THAT IS COMMONLY MISSED.**
   Preferred: one blocking call (the tool supports it):
   ```json
   { "jobId": "<jobId from step 2>", "wait": "true", "timeout_ms": "600000" }
   ```
   `wait: "true"` blocks until the job reaches `completed` or `failed`, or until `timeout_ms` elapses (max 3,600,000 ms). If the result says `timedOut: true`, call it again with the same `jobId`.
   - You may also poll without `wait`, but never answer the user while `status` is `queued` or `running`.
   - Stop only when `status` is `completed` or `failed`.
   - Never report success, paths, or "done" based only on the `analyze_video` response — that call only means the job was accepted.
   - If `status` is `failed`, report the `error` field and `warnings`. Do not claim notes were generated.
   - A model `429 Too Many Requests` from the harness is unrelated to this job; retry the status call after the indicated delay rather than assuming the video job failed.

4. **Verify the completed result before answering the user.** From the `video_note_status` output check that:
   - `notesPath`, `transcriptPath` and `ocrPath` are all present and non-empty;
   - `framesDir` is present and contains screenshots;
   - `warnings` does not contain an unresolved `VAD_EMPTY_TRANSCRIPT` or privacy/cost degradation;
   - the notes contain `## Validation & Accuracy` and at least one `![](...)` screenshot link. Image links are percent-encoded (e.g. `20%20Normal%20Distribution_frames/frame_01.jpg`) so spaces and parentheses in folder names do not break Markdown renderers — do not rewrite them to raw paths.
   If any check fails, say so explicitly and give the paths/warnings. Do not silently present a partial result.

5. **Generate the curated final notes (fourth artifact).** After the job is `completed`, read all four sources the plugin produced:
   - `[video]_notes.md` (LLM/extractive notes + existing screenshot links)
   - `[video]_transcript.md` (verbatim speech)
   - `[video]_ocr.md` (on-screen text)
   - `[video]_frames/` (the extracted screenshots)

   Write a separate file named **`[video]_CURATED_NOTES.md`** in the same output directory. This is the final, reader-ready version; do not modify the three raw artifacts.
   - Open with a title, source video, duration/language and a table of contents.
   - Organise into clear sections with **bold** key terms, tables, code blocks and short quotes from the transcript.
   - Attach relevant screenshots in every section: reuse the percent-encoded relative links from `[video]_notes.md` (for example `![Slide](20%20Normal%20Distribution_frames/frame_03_00-01-00-000.jpg)`), or build the same form from the `[video]_frames/` directory. Never use raw paths with spaces. Verify each link points to a real JPG.
   - Cross-check the curated text against both the transcript and the OCR. Nothing important from either may be omitted; add a short **Coverage** note listing anything intentionally skipped.
   - Where the instructor's statement is wrong or incomplete, add a callout: `> ⚠️ Instructor said "X", however the correct concept is Y.` Only flag what you can justify from the sources or established knowledge.
   - Keep mathematical notation readable (plain text or fenced blocks) and preserve timestamps where useful.

6. **Report all four artifacts** to the user: curated notes, notes, transcript, OCR, plus the screenshots folder.

Intermediate WAV files under `.work/` are deleted automatically after notes validation and rendering (also on failure/abort). No manual cleanup is needed. Long audio is transcribed in 10-minute chunks; that logic is unaffected by cleanup.

## Troubleshooting

- **Transcript missing/empty but the video clearly has speech:** background fan/AC noise can make Silero VAD strip speech. Re-run step 2 with `"vadEnabled": false`, or `"enhanceAudio": true` (ffmpeg cleans the audio first). If the user says "vad off", always pass `"vadEnabled": false`.
- **No screenshots in notes:** confirm `framesDir` exists and the notes contain `![...]` links before reporting. A job that never reached `status: completed` will have neither.
- **Notes look like raw OCR/transcript lines:** the LLM provider may be unavailable. The status warnings will say "LLM synthesis degraded"; in that case the notes fall back to the offline extractive format.

## Multilingual transcription (Hinglish / Hindi)

When the user mentions Hinglish, Hindi or another non-English language, pass the language and force a multilingual model:

```json
{ "videoPath": "C:/path/to/lecture.mp4", "language": "hinglish", "multilingual": true }
```

- `language` accepts `hinglish`, `hi` (Hindi), `en`, `auto`, or ISO codes. Hinglish passes a romanized-Hindi vocabulary hint.
- The plugin never guesses the language: it uses exactly what you pass. If the user did not name a language, `en` is the safe default for English-medium lectures. Do not leave a known Hindi/Hinglish video on `auto` with the English-only model — auto-detection can produce garbled, repeated text. Say `hinglish` / `hi` explicitly to select the installed multilingual `ggml-base.bin`.
- An explicit `en` run can look correct even on a Hinglish-medium lecture because it forces English decoding; it is not evidence that the audio is monolingual English.
- `multilingual: true` selects a non-English `ggml-*.bin` model; an English-only `ggml-*.en.bin` will NOT be used. If no multilingual model is installed, the job reports the exact download path for `ggml-base.bin`.

## Quick reference

```text
analyze_video(videoPath) -> jobId
video_note_status(jobId, wait: "true", timeout_ms: "600000") -> completed | failed  [BLOCKS]
completed -> notesPath + transcriptPath + ocrPath + framesDir + notes
then write [video]_CURATED_NOTES.md (curated final notes with embedded frames)
```
