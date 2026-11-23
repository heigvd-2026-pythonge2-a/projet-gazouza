<#
.SYNOPSIS
    Build the standalone Windows desktop distribution of Psice.

.DESCRIPTION
    Builds the React/TypeScript frontend with pnpm, syncs the Python backend with uv,
    packages the application with PyInstaller (including frontend/dist, bundled ngspice,
    the component library, and license notices), verifies the executable offline, and
    creates dist/Psice.zip.
#>
[CmdletBinding()]
param(
    [switch]$SkipFrontendBuild,
    [switch]$SkipZip,
    [switch]$Verify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = $PSScriptRoot
$FrontendDir = Join-Path $RepoRoot "frontend"
$FrontendDist = Join-Path $FrontendDir "dist"
$BackendDir = Join-Path $RepoRoot "backend"
$EntryScript = Join-Path $BackendDir "app\engines\launcher.py"
$NgspiceDir = Join-Path $BackendDir "vendor\ngspice"
$LibraryDir = Join-Path $BackendDir "app\netlist\library"
$LicenseFile = Join-Path $RepoRoot "LICENSE"
$ThirdPartyLicensesFile = Join-Path $RepoRoot "THIRD_PARTY_LICENSES.md"
$NgspiceCopyingFile = Join-Path $NgspiceDir "COPYING"

$BuildRoot = Join-Path $RepoRoot "build"
$WorkRoot = Join-Path $BuildRoot "work"
$DistRoot = Join-Path $RepoRoot "dist"
$AppDistDir = Join-Path $DistRoot "Psice"
$ExePath = Join-Path $AppDistDir "Psice.exe"
$ZipPath = Join-Path $DistRoot "Psice.zip"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$StepName,
        [Parameter(Mandatory = $true)][scriptblock]$Action
    )

    Write-Host "==> $StepName" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "$StepName failed with exit code $LASTEXITCODE."
    }
}

function Assert-ToolAvailable {
    param([Parameter(Mandatory = $true)][string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required tool '$Name' was not found in PATH."
    }
}

function Invoke-PsiceSelfCheck {
    param([Parameter(Mandatory = $true)][string]$ExecutablePath)

    if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
        throw "Built executable not found: $ExecutablePath"
    }

    $tempId = [guid]::NewGuid().ToString("N")
    $stdoutFile = Join-Path ([System.IO.Path]::GetTempPath()) "psice-selfcheck-out-$tempId.txt"
    $stderrFile = Join-Path ([System.IO.Path]::GetTempPath()) "psice-selfcheck-err-$tempId.txt"
    $exeDir = Split-Path -Parent $ExecutablePath

    try {
        $proc = Start-Process `
            -FilePath $ExecutablePath `
            -ArgumentList "--self-check" `
            -WorkingDirectory $exeDir `
            -Wait `
            -PassThru `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdoutFile `
            -RedirectStandardError $stderrFile

        $stdoutText = if (Test-Path -LiteralPath $stdoutFile) {
            (Get-Content -LiteralPath $stdoutFile -Raw -Encoding UTF8)
        } else { "" }
        $stderrText = if (Test-Path -LiteralPath $stderrFile) {
            (Get-Content -LiteralPath $stderrFile -Raw -Encoding UTF8)
        } else { "" }

        if (-not [string]::IsNullOrWhiteSpace($stdoutText)) {
            Write-Host $stdoutText.TrimEnd()
        }
        if (-not [string]::IsNullOrWhiteSpace($stderrText)) {
            Write-Host $stderrText.TrimEnd() -ForegroundColor Yellow
        }

        if ($proc.ExitCode -ne 0) {
            throw "Psice.exe --self-check failed with exit code $($proc.ExitCode)."
        }
        if ($stdoutText -notmatch "Self-check OK:") {
            throw "Psice.exe --self-check did not emit expected confirmation output."
        }
    }
    finally {
        Remove-Item -LiteralPath $stdoutFile, $stderrFile -Force -ErrorAction SilentlyContinue
    }
}

Assert-ToolAvailable -Name "uv"
if (-not $SkipFrontendBuild) {
    Assert-ToolAvailable -Name "pnpm"
}

foreach ($requiredPath in @($EntryScript, $LibraryDir, $LicenseFile, $ThirdPartyLicensesFile, $NgspiceCopyingFile)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required source asset not found: $requiredPath"
    }
}

$ngspiceBin = Join-Path $NgspiceDir "bin\ngspice_con.exe"
if (-not (Test-Path -LiteralPath $ngspiceBin -PathType Leaf)) {
    throw "Bundled ngspice executable not found: $ngspiceBin"
}

if (-not $SkipFrontendBuild) {
    Push-Location $FrontendDir
    try {
        if (-not (Test-Path -LiteralPath (Join-Path $FrontendDir "node_modules") -PathType Container)) {
            Invoke-Checked -StepName "Installing frontend dependencies (pnpm install --frozen-lockfile)" -Action {
                pnpm install --frozen-lockfile
            }
        }
        Invoke-Checked -StepName "Building frontend (pnpm build)" -Action {
            pnpm build
        }
    }
    finally {
        Pop-Location
    }
}

$frontendIndex = Join-Path $FrontendDist "index.html"
if (-not (Test-Path -LiteralPath $frontendIndex -PathType Leaf)) {
    throw "Built frontend entry point not found: $frontendIndex"
}

Push-Location $BackendDir
try {
    Invoke-Checked -StepName "Syncing backend environment (uv sync --locked --all-extras --dev)" -Action {
        uv sync --locked --all-extras --dev
    }

    if (Test-Path -LiteralPath $AppDistDir) {
        Remove-Item -LiteralPath $AppDistDir -Recurse -Force
    }
    if (Test-Path -LiteralPath $ZipPath) {
        Remove-Item -LiteralPath $ZipPath -Force
    }
    New-Item -ItemType Directory -Path $BuildRoot, $WorkRoot, $DistRoot -Force | Out-Null

    $pyinstallerArgs = @(
        "run", "pyinstaller",
        "--noconfirm",
        "--clean",
        "--onedir",
        "--windowed",
        "--name", "Psice",
        "--distpath", $DistRoot,
        "--workpath", $WorkRoot,
        "--specpath", $BuildRoot,
        "--paths", $BackendDir,
        "--add-data", "$FrontendDist;frontend/dist",
        "--add-data", "$NgspiceDir;vendor/ngspice",
        "--add-data", "$LibraryDir;app/netlist/library",
        "--add-data", "$LicenseFile;.",
        "--add-data", "$ThirdPartyLicensesFile;.",
        "--collect-submodules", "app",
        "--collect-submodules", "uvicorn",
        "--collect-submodules", "starlette",
        "--collect-submodules", "fastapi",
        "--collect-submodules", "pydantic",
        "--collect-submodules", "webview",
        "--collect-data", "webview",
        "--collect-binaries", "webview",
        "--collect-submodules", "clr_loader",
        "--collect-binaries", "clr_loader",
        "--collect-submodules", "pythonnet",
        "--collect-binaries", "pythonnet",
        "--hidden-import", "clr",
        $EntryScript
    )

    Invoke-Checked -StepName "Packaging desktop application with PyInstaller" -Action {
        & uv @pyinstallerArgs
    }
}
finally {
    Pop-Location
}

Write-Host "==> Copying license notices into $AppDistDir" -ForegroundColor Cyan
Copy-Item -LiteralPath $LicenseFile -Destination (Join-Path $AppDistDir "LICENSE") -Force
Copy-Item -LiteralPath $ThirdPartyLicensesFile -Destination (Join-Path $AppDistDir "THIRD_PARTY_LICENSES.md") -Force
Copy-Item -LiteralPath $NgspiceCopyingFile -Destination (Join-Path $AppDistDir "COPYING") -Force

Write-Host "==> Verifying built executable ($ExePath)" -ForegroundColor Cyan
Invoke-PsiceSelfCheck -ExecutablePath $ExePath

if (-not $SkipZip) {
    Write-Host "==> Creating distribution archive ($ZipPath)" -ForegroundColor Cyan
    Compress-Archive -Path $AppDistDir -DestinationPath $ZipPath -CompressionLevel Optimal -Force

    if ($Verify) {
        $verifyDir = Join-Path ([System.IO.Path]::GetTempPath()) ("psice-zip-verify-" + [guid]::NewGuid().ToString("N"))
        try {
            Write-Host "==> Verifying extracted archive offline in $verifyDir" -ForegroundColor Cyan
            New-Item -ItemType Directory -Path $verifyDir -Force | Out-Null
            Expand-Archive -LiteralPath $ZipPath -DestinationPath $verifyDir -Force
            $extractedExe = Join-Path $verifyDir "Psice\Psice.exe"
            Invoke-PsiceSelfCheck -ExecutablePath $extractedExe
        }
        finally {
            Remove-Item -LiteralPath $verifyDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

$distFiles = Get-ChildItem -LiteralPath $AppDistDir -Recurse -File
$distBytes = ($distFiles | Measure-Object -Property Length -Sum).Sum
$exeBytes = (Get-Item -LiteralPath $ExePath).Length
Write-Host ""
Write-Host "Build completed successfully:" -ForegroundColor Green
Write-Host ("  Executable : {0} ({1:N2} MiB)" -f $ExePath, ($exeBytes / 1MB))
Write-Host ("  App folder : {0} ({1:N2} MiB, {2} files)" -f $AppDistDir, ($distBytes / 1MB), $distFiles.Count)
if (-not $SkipZip -and (Test-Path -LiteralPath $ZipPath)) {
    $zipBytes = (Get-Item -LiteralPath $ZipPath).Length
    Write-Host ("  Archive    : {0} ({1:N2} MiB)" -f $ZipPath, ($zipBytes / 1MB))
}
