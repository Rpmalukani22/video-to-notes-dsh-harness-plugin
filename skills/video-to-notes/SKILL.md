---
name: video-to-notes
description: "Convert video files into structured Markdown notes with key screenshots, on-screen OCR text, and synchronized transcript. Supports multilingual (Hinglish/Hindi) transcription, VAD off, and audio enhancement."
category: productivity
risk: safe
tags: [video, notes, transcription, ocr, whisper, ffmpeg]
---

# Video to Notes

Converts local video files into 3 comprehensive outputs:
1. **Synthesized Notes (with screenshots):** `[video]_notes.md` — Complete study notes combining on-screen text and verbal discussion, concept validation callouts, and embedded screenshots.
2. **Full Raw Transcript:** `[video]_transcript.md` — Timestamped, paragraphed transcript.
3. **On-Screen Text (OCR):** `[video]_ocr.md` — Deduped text extracted from video frames.

## Tools Available

- `video_notes_doctor`: Checks binary availability (ffmpeg, tesseract, whisper-cli, scenedetect) and LLM status.
- `analyze_video`: Starts asynchronous analysis of a video file.
- `video_note_status`: Polls job progress and retrieves generated note paths.

## Usage Workflow

1. **Verify Environment:**
   Call `video_notes_doctor({ verbose: true })`.

2. **Run Analysis:**
   Call `analyze_video`:
   ```json
   {
     "videoPath": "C:/path/to/video.mp4",
     "preset": "lecture",
     "vadEnabled": true,
     "enhanceAudio": false
   }
   ```
   - If audio has heavy background noise, air conditioning, or fan noise that cuts off speech, or the user says "vad off", set `"vadEnabled": false`. Alternatively set `"enhanceAudio": true` to clean the audio with ffmpeg before transcription.

3. **Multilingual transcription (Hinglish / Hindi):**
   When the user mentions Hinglish, Hindi or another non-English language, pass the language and force a multilingual model:
   ```json
   { "videoPath": "C:/path/to/lecture.mp4", "language": "hinglish", "multilingual": true }
   ```
   - `language` accepts `hinglish`, `hi` (Hindi), `en`, or `auto`. Hinglish passes a romanized-Hindi vocabulary hint to Whisper.
   - `multilingual: true` selects a non-English `ggml-*.bin` model; an English-only `ggml-*.en.bin` will NOT be used. If no multilingual model is installed, the job reports the exact download path for `ggml-base.bin`.

4. **Check Status:**
   Poll `video_note_status` with the returned `jobId` until status is `completed`.
   The tool output will display paths to all 3 generated markdown files and screenshots folder.
