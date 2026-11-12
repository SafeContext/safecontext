<#
.SYNOPSIS
Prepare this Windows PowerShell session for Safe Context development.
.DESCRIPTION
Requires PowerShell 7, Node 24, the repository's pinned pnpm, and Git for Windows.
Adds Git's shell utilities to this process PATH only. Does not install anything.
-StartAgent starts an isolated rules-only demo on the plugin's fixed port 4747:
existing SC_* settings are temporarily removed and restored when it stops.
See docs/windows-startup.md. Run in each terminal that will launch tests or Claude.
#>
#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$GitRoot,
    [switch]$StartAgent
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows) {
    throw 'This helper is for native Windows. Use the existing development commands on macOS/Linux.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$originalPath = $env:PATH
try {
    if (-not $GitRoot) {
        $git = Get-Command git.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $git) {
            throw 'Git for Windows was not found. Install it using your approved setup, or pass -GitRoot to its installation directory.'
        }
        # Git may resolve through cmd/, bin/, or mingw64/bin/ after preparation.
        $candidate = Split-Path -Parent $git.Source
        for ($depth = 0; $depth -lt 3; $depth++) {
            if (Test-Path -LiteralPath (Join-Path $candidate 'usr/bin/sh.exe') -PathType Leaf) {
                $GitRoot = $candidate
                break
            }
            $candidate = Split-Path -Parent $candidate
            if (-not $candidate) { break }
        }
        if (-not $GitRoot) {
            throw 'Cannot locate the Git for Windows shell beside git.exe. Pass -GitRoot to its installation directory.'
        }
    }
    $GitRoot = (Resolve-Path -LiteralPath $GitRoot).Path
    $shellBin = Join-Path $GitRoot 'usr/bin'
    $gitBin = Join-Path $GitRoot 'mingw64/bin'
    foreach ($utility in @('sh.exe', 'sed.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $shellBin $utility) -PathType Leaf)) {
            throw "Git for Windows utility $utility is missing. Pass -GitRoot to the Git installation directory (not git.exe)."
        }
    }
    $env:PATH = "$shellBin;$gitBin;$originalPath"
    foreach ($utility in @('node.exe', 'pnpm.cmd', 'curl.exe')) {
        if (-not (Get-Command $utility -CommandType Application -ErrorAction SilentlyContinue)) {
            throw "Required tool $utility is missing from PATH. See docs/windows-startup.md."
        }
    }
    $nodeVersion = & node.exe --version
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') {
        throw 'Use Node 24 for this repository; then rerun this helper.'
    }
    $expectedPnpm = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).packageManager -replace '^pnpm@', ''
    $pnpmVersion = & pnpm.cmd --version
    if ($LASTEXITCODE -ne 0 -or $pnpmVersion -ne $expectedPnpm) {
        throw "Use pnpm $expectedPnpm (pinned in package.json); then rerun this helper."
    }
    # Exercise the same PATH lookup used by the exec-form SessionStart hook.
    & sh.exe -c 'command -v sed >/dev/null && command -v curl >/dev/null'
    if ($LASTEXITCODE -ne 0) {
        throw 'Git shell cannot find sed and curl. Repair Git for Windows before running the plugin.'
    }
} catch {
    $env:PATH = $originalPath
    throw
}

Write-Host 'Windows prerequisites ready for this terminal and its child processes.'
if (-not $StartAgent) { return }

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'apps/agent/node_modules/tsx') -PathType Container)) {
    throw 'Agent dependencies are missing. Run pnpm install --frozen-lockfile using the approved dependency setup first.'
}

# A deliberately isolated, model-free demo. Never inherit model endpoints, dashboard
# credentials or a company policy by accident. Do not print their existing values.
$savedSettings = @{}
foreach ($item in Get-ChildItem Env: | Where-Object Name -Like 'SC_*') {
    $savedSettings[$item.Name] = $item.Value
    [Environment]::SetEnvironmentVariable($item.Name, $null, 'Process')
}
try {
    $env:SC_AGENT_PORT = '4747'
    Write-Host 'Starting rules-only demo at 127.0.0.1:4747 with the built-in default policy. Ctrl+C stops it.'
    Push-Location -LiteralPath $repoRoot
    try {
        & pnpm.cmd --filter '@safecontext/agent' exec tsx src/index.ts
        if ($LASTEXITCODE -ne 0) { throw "Rules-only agent stopped with exit code $LASTEXITCODE." }
    } finally {
        Pop-Location
    }
} finally {
    foreach ($item in Get-ChildItem Env: | Where-Object Name -Like 'SC_*') {
        [Environment]::SetEnvironmentVariable($item.Name, $null, 'Process')
    }
    foreach ($name in $savedSettings.Keys) {
        [Environment]::SetEnvironmentVariable($name, $savedSettings[$name], 'Process')
    }
}
