# Configure an optional Codex CLI profile on Windows without storing credentials.
# Run from a LOCAL repo clone: .\scripts\setup-codex-freellmapi.ps1
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$providerSource = Join-Path $repo "tools\codex\freellmapi-provider.config.toml.example"
$profileSource = Join-Path $repo "tools\codex\svoi-freellmapi.config.toml.example"
$codexHome = Join-Path $HOME ".codex"
$mainConfig = Join-Path $codexHome "config.toml"
$profileConfig = Join-Path $codexHome "svoi-freellmapi.config.toml"

if (!(Test-Path -LiteralPath $providerSource) -or !(Test-Path -LiteralPath $profileSource)) {
    throw "Missing source templates. Run from the repository clone."
}
New-Item -ItemType Directory -Force -Path $codexHome | Out-Null

if (Test-Path -LiteralPath $mainConfig) {
    $existing = Get-Content -LiteralPath $mainConfig -Raw
    if ($existing -match '(?m)^\s*\[model_providers\.svoi_freellmapi\]\s*$') {
        if ($existing -notmatch 'https://freellmapi-production-3129\.up\.railway\.app/v1' -or
            $existing -notmatch 'SVOI_FREELLMAPI_UNIFIED_KEY') {
            throw "Existing provider differs from expected template. No changes made."
        }
        Write-Host "Provider section already exists; keeping it unchanged."
    } else {
        $backup = $mainConfig + ".backup-" + (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + $PID
        Copy-Item -LiteralPath $mainConfig -Destination $backup -ErrorAction Stop
        $providerText = Get-Content -LiteralPath $providerSource -Raw
        Add-Content -LiteralPath $mainConfig -Value ([Environment]::NewLine + $providerText) -Encoding UTF8
        Write-Host "Provider added; existing config.toml backed up."
    }
} else {
    Copy-Item -LiteralPath $providerSource -Destination $mainConfig
    Write-Host "Created user config.toml with opt-in provider; no default changed."
}
if (Test-Path -LiteralPath $profileConfig) {
    Write-Host "Profile already exists and was not overwritten."
} else {
    Copy-Item -LiteralPath $profileSource -Destination $profileConfig
    Write-Host "Created opt-in profile: $profileConfig"
}
Write-Host "No credentials were stored."
Write-Host "Next: supply the unified FreeLLMAPI key through an environment variable, run the smoke test and then codex --profile svoi-freellmapi."
