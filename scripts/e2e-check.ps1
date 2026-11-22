$ErrorActionPreference = 'Stop'
Set-Location "C:\src\ai_workspace\video-to-notes"

$tmp = "C:\Users\ruchi\AppData\Local\Temp\opencode\vtn-e2e3"
$sample = "C:\Users\ruchi\AppData\Local\Temp\opencode\vtn-e2e2\sample.mp4"
$ffmpegDir = "C:\ffmpeg-master-latest-win64-gpl-shared\bin"
$whisperDir = "C:\tools\whisper.cpp\Release"
$tesseractDir = "C:\Program Files\Tesseract-OCR"

$missing = @()
foreach ($path in @("$ffmpegDir\ffmpeg.exe", "$ffmpegDir\ffprobe.exe", "$whisperDir\whisper-cli.exe", "$tesseractDir\tesseract.exe", $sample)) {
  if (-not (Test-Path $path)) { $missing += $path }
}
if ($missing.Count -gt 0) {
  foreach ($path in $missing) { Write-Output "SKIPPED (missing tool): $path" }
  Add-Content docs\reviews\2026-11-21-accuracy-eval.md "SKIPPED (missing tool): $($missing -join ', ')"
  exit 0
}

$env:PATH = "$ffmpegDir;$whisperDir;$tesseractDir;$env:PATH"
$env:WHISPER_MODELS_DIR = "C:\src\ai_workspace\video-to-notes\models"

Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
  & node dist\cli.js --config "C:\src\ai_workspace\video-to-notes\custom-config.yaml" --ffmpeg "$ffmpegDir\ffmpeg.exe" -o $tmp analyze $sample --json
  if ($LASTEXITCODE -ne 0) { throw "CLI failed with $LASTEXITCODE" }

  $md = @(Get-ChildItem $tmp -Filter *.md -File | Sort-Object Name)
  if ($md.Count -ne 3) { throw "Expected 3 markdown files, got $($md.Count): $($md.Name -join ', ')" }
  foreach ($name in @('sample_notes.md','sample_ocr.md','sample_transcript.md')) {
    if (-not (Test-Path (Join-Path $tmp $name))) { throw "Missing $name" }
  }
  $framesDir = Join-Path $tmp 'sample_frames'
  if (-not (Test-Path $framesDir)) { throw 'Missing screenshots folder' }
  if (@(Get-ChildItem $framesDir -Filter *.jpg).Count -lt 1) { throw 'No screenshots saved' }

  $pattern = '\*\*Visual Content:\*\*|\*\*Transcript:\*\*|\*\*On screen\*\*|\*\*Transcript\*\*'
  $hits = @(Select-String -Path (Join-Path $tmp 'sample_notes.md') -Pattern $pattern)
  if ($hits.Count -ne 0) { throw "raw markers found: $($hits.Line -join '; ')" }

  $neg = Join-Path $tmp 'neg-marker.md'
  Set-Content -Path $neg -Value '**Visual Content:**'
  $negHits = @(Select-String -Path $neg -Pattern $pattern)
  if ($negHits.Count -eq 0) { throw 'negative control failed: marker not detected' }
  Remove-Item $neg -Force

  Write-Output "E2E OK: $($md.Name -join ', ')"
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
