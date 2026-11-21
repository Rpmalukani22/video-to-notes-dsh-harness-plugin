param(
  [ValidateSet('stub','real')]
  [string]$Provider = 'stub'
)
$ErrorActionPreference = 'Stop'
Set-Location "C:\src\ai_workspace\video-to-notes"

$evalDoc = "docs\reviews\2026-11-21-accuracy-eval.md"
$sample = "C:\Users\ruchi\AppData\Local\Temp\opencode\vtn-e2e2\sample.mp4"
$tmp = "C:\Users\ruchi\AppData\Local\Temp\opencode\vtn-e2e-llm"
$ffmpegDir = "C:\ffmpeg-master-latest-win64-gpl-shared\bin"
$whisperDir = "C:\tools\whisper.cpp\Release"
$tesseractDir = "C:\Program Files\Tesseract-OCR"
$env:PATH = "$ffmpegDir;$whisperDir;$tesseractDir;$env:PATH"
$env:WHISPER_MODELS_DIR = "C:\src\ai_workspace\video-to-notes\models"

if ($Provider -eq 'real' -and [string]::IsNullOrWhiteSpace($env:VTN_REAL_LLM_PROVIDER)) {
  throw 'REAL PROVIDER REQUIRED: set VTN_REAL_LLM_PROVIDER to run the real-provider evidence path'
}

$stubProcess = $null
try {
  $callLog = "test-results\stub-calls.log"
  Remove-Item $callLog -ErrorAction SilentlyContinue
  if ($Provider -eq 'stub') {
    $stubProcess = Start-Process -PassThru node -ArgumentList 'scripts\stub-llm-server.js' -WindowStyle Hidden
    Start-Sleep -Seconds 1
    $config = "C:\src\ai_workspace\video-to-notes\tests\fixtures\stub-llm.yaml"
  } else {
    $config = "C:\src\ai_workspace\video-to-notes\custom-config.yaml"
  }

  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $tmp | Out-Null
  & node dist\cli.js --config $config --ffmpeg "$ffmpegDir\ffmpeg.exe" -o $tmp analyze $sample --json
  if ($LASTEXITCODE -ne 0) { throw "LLM E2E CLI failed with $LASTEXITCODE" }

  $notes = Join-Path $tmp 'sample_notes.md'
  if (-not (Test-Path $notes)) { throw 'LLM E2E did not write sample_notes.md' }
  $content = Get-Content $notes -Raw
  if ($content -notmatch '\*\*') { throw 'LLM notes contain no bold formatting' }
  if ($content -notmatch '## Validation & Accuracy') { throw 'LLM notes contain no validation section' }
  if ($content -notmatch '!\[.*\]\(') { throw 'LLM notes contain no screenshot embeds' }
  if (@(Get-ChildItem $tmp -Filter *.md -File).Count -ne 3) { throw 'LLM E2E did not write exactly three markdown files' }
  $calls = if (Test-Path $callLog) { @(Get-Content $callLog) } else { @() }
  if ($Provider -eq 'stub' -and $calls.Count -lt 2) { throw "stub call count too low: $($calls.Count)" }
  if ($Provider -eq 'stub' -and -not (@($calls | Select-String -SimpleMatch 'validation').Count -gt 0)) {
    throw 'stub log has no validation call: independent validation did not reach the model'
  }

  $record = "LLM E2E OK ($Provider): three artifacts, validation section, embeds; stub calls=$($calls.Count)"
  Write-Output $record
  Add-Content $evalDoc $record
} finally {
  if ($stubProcess -ne $null -and -not $stubProcess.HasExited) { Stop-Process -Id $stubProcess.Id -Force }
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
