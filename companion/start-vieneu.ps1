# Windows PowerShell 5.1 compatible. The BAT wrapper keeps errors visible.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Find-Uv {
    $command = Get-Command uv.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $localUv = Join-Path $env:USERPROFILE '.local\bin\uv.exe'
    if (Test-Path -LiteralPath $localUv -PathType Leaf) { return $localUv }
    return $null
}

function Require-Uv {
    $uvPath = Find-Uv
    if ($uvPath) { return $uvPath }
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw 'uv is missing. Install it from https://docs.astral.sh/uv/getting-started/installation/ then open this BAT again.'
    }
    Write-Host 'Installing uv with Windows Package Manager. Follow any installer prompts.'
    & $winget.Source install --id astral-sh.uv -e --source winget | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'uv installation did not finish. Reopen this BAT after installing uv.' }
    # WinGet may update user PATH without changing this running process.
    $env:Path += ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $uvPath = Find-Uv
    if (-not $uvPath) { throw 'uv was installed. Close this window and open the BAT again to refresh PATH.' }
    return $uvPath
}

Push-Location -LiteralPath $PSScriptRoot
try {
    foreach ($file in @('server.py', 'speech_engine.py', 'model_cache.py', 'requirements.in')) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            throw "Missing $file. Extract the WHOLE VieNeu ZIP before opening start-vieneu.bat."
        }
    }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'VieNeu requires 64-bit Windows.' }
    $env:PYTHONUNBUFFERED = '1'
    $env:PYTHONUTF8 = '1'
    $env:HF_HOME = Join-Path $PSScriptRoot '.cache\huggingface'
    $python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
        if (Test-Path -LiteralPath '.venv') {
            throw 'The .venv folder is incomplete or belongs to another OS. Extract a fresh copy of the ZIP into a new folder and try again.'
        }
        $uvPath = Require-Uv
        Write-Host 'Preparing Python 3.12. Internet is required on first launch.'
        & $uvPath venv --python 3.12 .venv
        if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python environment. Check the error above.' }
    }
    & $python -c "import sys,struct; sys.exit(0 if sys.version_info[:2] == (3,12) and struct.calcsize('P') == 8 else 1)"
    if ($LASTEXITCODE -ne 0) { throw 'The existing environment needs Python 3.12 (64-bit). Use a freshly extracted ZIP folder.' }

    # Resolve Windows dependencies from direct pins, not the macOS environment snapshot.
    # Write the marker only after a successful install; a failed setup retries next launch.
    $fingerprint = 'windows-v1:' + (Get-FileHash -LiteralPath 'requirements.in' -Algorithm SHA256).Hash
    $marker = Join-Path $PSScriptRoot '.venv\.vieneu-windows-requirements.sha256'
    $installed = if (Test-Path -LiteralPath $marker) { (Get-Content -LiteralPath $marker -Raw).Trim() } else { '' }
    if ($installed -ne $fingerprint) {
        $uvPath = Require-Uv
        Write-Host 'Installing VieNeu dependencies. This may take several minutes.'
        & $uvPath pip install --python $python -r requirements.in
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check the error above; the next launch will retry.' }
        Set-Content -LiteralPath $marker -Value $fingerprint -Encoding ASCII
    }
    Write-Host ''
    Write-Host 'VieNeu is starting at http://127.0.0.1:8001'
    Write-Host 'First launch downloads around 580 MiB of models, then warms up the voice.'
    Write-Host 'Wait for: Application startup complete'
    Write-Host 'Keep this window open. In the extension: VieNeu local > Connect > Test voice.'
    Write-Host 'Press Ctrl+C to stop.'
    & $python server.py
    if ($LASTEXITCODE -ne 0) { throw "VieNeu stopped with exit code $LASTEXITCODE. Check the error above." }
} catch {
    Write-Host ''
    Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
exit 0
