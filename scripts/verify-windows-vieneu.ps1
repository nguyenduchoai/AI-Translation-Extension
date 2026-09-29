# Run the shipped BAT with the actual Windows dependencies and model, then request audio.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $root 'companion\start-vieneu.bat'
$output = Join-Path $env:RUNNER_TEMP 'vieneu-model-stdout.log'
$errors = Join-Path $env:RUNNER_TEMP 'vieneu-model-stderr.log'
$headers = @{ 'X-AI-Translator' = '1' }
$process = Start-Process -FilePath $env:ComSpec -ArgumentList ('/d /s /c ""' + $launcher + '" --no-pause"') -PassThru -RedirectStandardOutput $output -RedirectStandardError $errors
try {
    $ready = $false
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        if ($process.HasExited) { throw "Launcher exited early: $($process.ExitCode)" }
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:8001/health' -Headers $headers -TimeoutSec 2
            if ($health.status -eq 'ready' -and $health.sampleRate -eq 48000) { $ready = $true; break }
        } catch { }
        Start-Sleep -Seconds 5
    }
    if (-not $ready) { throw 'Actual VieNeu model did not become ready within 10 minutes.' }
    # PowerShell 5.1 may decode charset-less JSON as Latin-1. Voice IDs contain
    # Vietnamese accents; decode the response bytes explicitly, like browser fetch.
    $voiceResponse = Invoke-WebRequest 'http://127.0.0.1:8001/voices' -Headers $headers -UseBasicParsing -TimeoutSec 10
    $voices = [Text.Encoding]::UTF8.GetString($voiceResponse.RawContentStream.ToArray()) | ConvertFrom-Json
    if ($voices.voices.Count -lt 1) { throw 'No preset voices returned.' }
    # UTF-8 JSON avoids Windows PowerShell 5.1 request-body encoding ambiguity.
    $body = @{ text = ('Xin ch' + [char]0x00E0 + 'o.'); voice = $voices.voices[0].id } | ConvertTo-Json -Compress
    $audio = Join-Path $env:RUNNER_TEMP 'vieneu-windows-smoke.pcm'
    Invoke-WebRequest 'http://127.0.0.1:8001/speech' -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -OutFile $audio -UseBasicParsing -TimeoutSec 90
    $size = (Get-Item -LiteralPath $audio).Length
    if ($size -lt 9600 -or $size % 2 -ne 0) { throw "Invalid PCM length: $size" }
    Write-Host "Actual Windows model passed: $($voices.voices.Count) voices, $size PCM bytes at 48 kHz."
} finally {
    if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F | Out-Host }
    foreach ($log in @($output, $errors)) {
        if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 60 | Out-Host }
    }
}
