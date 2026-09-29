[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if ($env:OS -ne 'Windows_NT') {
    throw 'This test requires native Windows, Python 3.12, and uv on PATH.'
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
# Construct non-ASCII text without relying on Windows PowerShell 5.1 source encoding.
$unicodeName = 'th' + [char]0x1EED + ' nghi' + [char]0x1EC7 + 'm'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('VieNeu Windows ' + $unicodeName + ' ' + [guid]::NewGuid().ToString('N'))
$oldExitCode = $env:VIENEU_LAUNCHER_TEST_EXIT
$oldOffline = $env:UV_OFFLINE
$utf8 = [Text.UTF8Encoding]::new($false)

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Write-FixtureFile([string]$Name, [string]$Content) {
    [IO.File]::WriteAllText((Join-Path $fixtureRoot $Name), $Content, $utf8)
}

function Get-RunCount {
    $counter = Join-Path $fixtureRoot 'server-runs.txt'
    if (-not (Test-Path -LiteralPath $counter)) { return 0 }
    return [int]([IO.File]::ReadAllText($counter))
}

function Invoke-Launcher([string]$Scenario, [bool]$ExpectSuccess = $true) {
    Write-Host "Testing: $Scenario"
    $launcher = Join-Path $fixtureRoot 'start-vieneu.bat'
    # cmd /s strips the outer quotes, leaving the quoted BAT path intact.
    $command = '""' + $launcher + '" --no-pause"'
    # Windows PowerShell 5.1 wraps redirected native stderr in ErrorRecords;
    # uv also uses stderr for normal progress. Judge this process by its exit code.
    $previousErrorPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & $env:ComSpec /d /s /c $command 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorPreference
    }
    $output | ForEach-Object { Write-Host $_ }
    if ($ExpectSuccess) {
        Assert-True ($exitCode -eq 0) "$Scenario failed with exit code $exitCode."
    } else {
        Assert-True ($exitCode -ne 0) "$Scenario unexpectedly returned success."
    }
    return $exitCode
}

try {
    Get-Command uv -ErrorAction Stop | Out-Null
    $version = & python -c "import sys; print(str(sys.version_info.major)+'.'+str(sys.version_info.minor))"
    Assert-True ($LASTEXITCODE -eq 0 -and $version -eq '3.12') 'Put Python 3.12 on PATH before running this test.'
    New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
    foreach ($name in @('start-vieneu.bat', 'start-vieneu.ps1')) {
        Copy-Item -LiteralPath (Join-Path $repositoryRoot "companion/$name") -Destination $fixtureRoot
    }
    # A real Windows venv exercises interpreter paths. Empty dependencies avoid
    # downloading VieNeu/model files while still executing the actual uv installer.
    Write-FixtureFile 'requirements.in' "# Launcher fixture: deliberately no model dependencies.`n"
    Write-FixtureFile 'speech_engine.py' "# Fixture: the dummy server does not import this module.`n"
    Write-FixtureFile 'model_cache.py' "# Fixture: the dummy server does not load models.`n"
    Write-FixtureFile 'server.py' @'
import os
from pathlib import Path
import sys

assert sys.version_info[:2] == (3, 12), sys.version
assert Path.cwd() == Path(__file__).resolve().parent, "Wrong working directory"
assert Path(sys.prefix).name == ".venv", "Server did not use the fixture venv"
counter = Path("server-runs.txt")
count = int(counter.read_text()) if counter.exists() else 0
counter.write_text(str(count + 1))
print("Fixture server started successfully; no model was loaded.", flush=True)
sys.exit(int(os.environ.get("VIENEU_LAUNCHER_TEST_EXIT", "0")))
'@
    & python -m venv (Join-Path $fixtureRoot '.venv')
    Assert-True ($LASTEXITCODE -eq 0) 'Failed to create fixture venv.'
    Remove-Item Env:VIENEU_LAUNCHER_TEST_EXIT -ErrorAction SilentlyContinue

    $marker = Join-Path $fixtureRoot '.venv/.vieneu-windows-requirements.sha256'
    $env:UV_OFFLINE = '1'
    Write-FixtureFile 'requirements.in' ('vieneu-launcher-fixture-' + [guid]::NewGuid().ToString('N') + "==0.0.0`n")
    foreach ($attempt in 1..2) {
        Invoke-Launcher "failed dependency installation retries (attempt $attempt)" $false | Out-Null
        Assert-True (-not (Test-Path -LiteralPath $marker)) 'Failed installation incorrectly wrote a success marker.'
        Assert-True ((Get-RunCount) -eq 0) 'Failed installation still launched the server.'
    }
    Write-FixtureFile 'requirements.in' "# Launcher fixture: deliberately no model dependencies.`n"

    Invoke-Launcher 'initial dependency installation in a Unicode path with spaces' | Out-Null
    Assert-True ((Get-RunCount) -eq 1) 'Initial launch did not run the server exactly once.'
    Assert-True (Test-Path -LiteralPath $marker) 'Successful installation did not write the requirements marker.'
    $firstHash = [IO.File]::ReadAllText($marker).Trim()
    $expectedHash = 'windows-v1:' + (Get-FileHash -LiteralPath (Join-Path $fixtureRoot 'requirements.in') -Algorithm SHA256).Hash
    Assert-True ($firstHash -ieq $expectedHash) 'Marker does not match requirements.in SHA-256.'

    # An old timestamp makes an unnecessary rewrite observable without sleeps.
    $stableTime = [datetime]::new(2020, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)
    [IO.File]::SetLastWriteTimeUtc($marker, $stableTime)
    Invoke-Launcher 'repeat launch skips unchanged dependency setup' | Out-Null
    Assert-True ((Get-RunCount) -eq 2) 'Repeat launch did not run the server.'
    Assert-True ([IO.File]::GetLastWriteTimeUtc($marker) -eq $stableTime) 'Repeat launch rewrote the marker for unchanged requirements.'

    Write-FixtureFile 'requirements.in' "# Changed fixture requirements: still no model dependencies.`n"
    Invoke-Launcher 'requirements change refreshes dependency setup' | Out-Null
    Assert-True ((Get-RunCount) -eq 3) 'Changed requirements prevented the server from running.'
    $updatedHash = [IO.File]::ReadAllText($marker).Trim()
    $expectedHash = 'windows-v1:' + (Get-FileHash -LiteralPath (Join-Path $fixtureRoot 'requirements.in') -Algorithm SHA256).Hash
    Assert-True ($updatedHash -ieq $expectedHash -and $updatedHash -ine $firstHash) 'Changed requirements did not refresh the marker.'
    Assert-True ([IO.File]::GetLastWriteTimeUtc($marker) -ne $stableTime) 'Changed requirements did not write a fresh marker.'

    $env:VIENEU_LAUNCHER_TEST_EXIT = '17'
    Invoke-Launcher 'server failure propagates a nonzero exit code' $false | Out-Null
    Assert-True ((Get-RunCount) -eq 4) 'Server failure fixture was not executed.'
    Remove-Item Env:VIENEU_LAUNCHER_TEST_EXIT

    foreach ($name in @('requirements.in', 'server.py', 'speech_engine.py', 'model_cache.py')) {
        $original = Join-Path $fixtureRoot $name
        $backup = "$original.fixture-backup"
        Move-Item -LiteralPath $original -Destination $backup
        try {
            Invoke-Launcher "missing $name fails before server startup" $false | Out-Null
            Assert-True ((Get-RunCount) -eq 4) "Missing $name still allowed the server to run."
        } finally {
            Move-Item -LiteralPath $backup -Destination $original
        }
    }
    Write-Host 'PASS: Windows BAT/PowerShell launcher setup, repeat start, requirements refresh, server failure, and missing-file checks.'
} finally {
    if ($null -eq $oldExitCode) {
        Remove-Item Env:VIENEU_LAUNCHER_TEST_EXIT -ErrorAction SilentlyContinue
    } else {
        $env:VIENEU_LAUNCHER_TEST_EXIT = $oldExitCode
    }
    if ($null -eq $oldOffline) {
        Remove-Item Env:UV_OFFLINE -ErrorAction SilentlyContinue
    } else {
        $env:UV_OFFLINE = $oldOffline
    }
    if (Test-Path -LiteralPath $fixtureRoot) {
        Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
    }
}
